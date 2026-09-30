import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
/* The shared redaction rules: the very file the browser loads. G4 depends on the
   server and the client agreeing exactly, and TypeScript infers its real shape
   through the UMD wrapper, so there is no hand-written copy of it to drift. */
import redact from '../../core/redact.js';
import { redeemEnrollment } from './enroll.ts';

export const K_ANON = Number(process.env.COPILOT_K_ANON ?? 5);
export const MAX_BATCH = 100;

/* ---------- shape ---------- */

export const Label = z.object({ hash: z.string().max(64), text: z.string().max(400).optional() });
export const Region = z.enum(['chrome', 'content']);

/* Zod strips unknown keys by default, which is exactly right here: a `value` or a
   `rect` a client should never have sent is removed before anything is stored. */
const Node = z.object({
  role: z.string().max(40),
  name: Label.nullable(),
  within: Label.nullable().optional(),
  region: Region.optional(),
  state: z.record(z.string(), z.boolean()).optional(),
});
export const Obs = z.object({
  url: z.string().max(1000).nullable(),
  title: Label.nullable(),
  heading: Label.nullable(),
  nodes: z.array(Node).max(400),
  truncated: z.boolean().optional(),
});
const Action = z.object({
  type: z.enum(['click', 'setChecked', 'setValue']),
  target: z.object({
    role: z.string().max(40).nullable(),
    name: Label.nullable(),
    within: Label.nullable().optional(),
    region: Region.nullable().optional(),
  }),
  /* Accepted as anything and then discarded unless it is a checkbox's boolean.
     Rejecting the whole transition over a forbidden field would be safe too, but it
     throws away good learning data because of one bad field. Strip, keep the rest. */
  value: z.unknown().optional(),
});
const Transition = z.object({
  at: z.number().int().positive(),
  episode: z.string().min(1).max(64),
  seq: z.number().int().min(0),
  source: z.enum(['user', 'copilot']),
  before: Obs,
  action: Action,
  after: Obs,
  crossedNavigation: z.boolean().optional(),
  /* Dev-only ground truth from the fixture's data-screen markers. Stored in its own
     table, only for localhost products, and never inside an observation. */
  truth: z.object({ before: z.string().max(64).nullable(), after: z.string().max(64).nullable() }).optional(),
});
const Batch = z.object({
  productId: z.string().min(1).max(64),
  install: z.object({
    id: z.string().min(8).max(64),
    mode: z.enum(['vendor', 'customer']),
    attested: z.boolean().optional(),
    enrollment: z.string().max(64).optional(),
  }),
  transitions: z.array(z.unknown()).max(MAX_BATCH),
});

export type Obs = z.infer<typeof Obs>;
type Transition = z.infer<typeof Transition>;
export type Policy = { mode: 'vendor' | 'customer'; attested: boolean; promoted: Set<string> };

/* ---------- products and installs ---------- */

/* Ground truth and other test instruments are accepted only for a product served
   from this machine, whatever a client says. *.localhost always resolves to this
   machine (RFC 6761). */
export function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/((?:[a-z0-9-]+\.)*localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/* Phase M: a vendor install of a product on a real web origin must enroll. */
export function needsEnrollment(origin: string): boolean {
  return /^https?:\/\//.test(origin) && !isLocalOrigin(origin);
}

export function productForOrigin(db: DatabaseSync, origin: string) {
  const found = db.prepare('SELECT id, key FROM products WHERE origin = ?').get(origin) as
    | { id: string; key: string }
    | undefined;
  if (found) return found;
  const id = `p_${randomBytes(6).toString('hex')}`;
  const key = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO products (id, origin, key, created_at) VALUES (?, ?, ?, ?)').run(id, origin, key, Date.now());
  return { id, key };
}

export function promotedLabels(db: DatabaseSync, productId: string, k = K_ANON): Set<string> {
  const rows = db
    .prepare(
      `SELECT label_hash FROM label_sightings WHERE product_id = ?
       GROUP BY label_hash HAVING COUNT(DISTINCT install_id) >= ?`
    )
    .all(productId, k) as Array<{ label_hash: string }>;
  return new Set(rows.map((r) => r.label_hash));
}

/* Privilege only ratchets down. The first registration is taken at its word (in
   production that registration must be authenticated), but after that an install
   can never claim vendor mode, or an attestation, that it did not already have. A
   buggy or hostile client cannot talk its way into sending clear text. */
export function upsertInstall(
  db: DatabaseSync,
  productId: string,
  claim: { id: string; mode: 'vendor' | 'customer'; attested?: boolean; enrollment?: string }
): { mode: 'vendor' | 'customer'; attested: boolean } | { error: string } {
  const now = Date.now();
  const existing = db.prepare('SELECT product_id, mode, attested FROM installs WHERE id = ?').get(claim.id) as
    | { product_id: string; mode: 'vendor' | 'customer'; attested: number }
    | undefined;

  if (!existing) {
    /* The first registration is the only moment a claim can raise privilege, so that
       is where vendor mode has to be earned (Phase M). */
    if (claim.mode === 'vendor') {
      const product = db.prepare('SELECT origin FROM products WHERE id = ?').get(productId) as { origin: string } | undefined;
      if (product && needsEnrollment(product.origin)) {
        if (!claim.enrollment) return { error: "vendor mode needs an enrollment code from the product's admin" };
        const spent = redeemEnrollment(db, productId, claim.enrollment, claim.id, now);
        if (!spent.ok) return { error: `enrollment refused: ${spent.reason}` };
      }
    }
    const attested = claim.mode === 'vendor' && !!claim.attested;
    db.prepare(
      'INSERT INTO installs (id, product_id, mode, attested, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(claim.id, productId, claim.mode, attested ? 1 : 0, now, now);
    return { mode: claim.mode, attested };
  }
  if (existing.product_id !== productId) return { error: 'install belongs to a different product' };

  const mode = existing.mode === 'customer' || claim.mode === 'customer' ? 'customer' : 'vendor';
  const attested = mode === 'vendor' && existing.attested === 1 && !!claim.attested;
  db.prepare('UPDATE installs SET mode = ?, attested = ?, last_seen = ? WHERE id = ?').run(
    mode,
    attested ? 1 : 0,
    now,
    claim.id
  );
  return { mode, attested };
}

/* ---------- the G4 re-check ---------- */

export function recheck(label: unknown, role: string | null | undefined, region: string | null | undefined, p: Policy) {
  return redact.recheckLabel(label, { role: role ?? undefined, region: region ?? undefined, ...p });
}

export function cleanObs(obs: Obs, p: Policy): Obs {
  return {
    url: obs.url ? redact.normalizeUrl(obs.url) : null,
    title: recheck(obs.title, 'heading', 'chrome', p),
    heading: recheck(obs.heading, 'heading', 'chrome', p),
    nodes: obs.nodes.map((n) => {
      const out: z.infer<typeof Node> = { role: n.role, name: recheck(n.name, n.role, n.region, p) };
      if (n.within) out.within = recheck(n.within, 'heading', n.region, p);
      if (n.region) out.region = n.region;
      if (n.state) out.state = n.state;
      return out;
    }),
    truncated: !!obs.truncated,
  };
}

function cleanTransition(t: Transition, p: Policy): Transition {
  const tgt = t.action.target;
  const action: z.infer<typeof Action> = {
    type: t.action.type,
    target: {
      role: tgt.role,
      name: recheck(tgt.name, tgt.role, tgt.region, p),
      within: tgt.within ? recheck(tgt.within, 'heading', tgt.region, p) : null,
      region: tgt.region ?? null,
    },
  };
  /* A checkbox's intended state is structure. Anything else under `value` is not. */
  if (t.action.type === 'setChecked' && typeof t.action.value === 'boolean') action.value = t.action.value;
  /* `truth` is deliberately not carried into the cleaned transition. */
  const { truth: _truth, ...rest } = t;
  return { ...rest, before: cleanObs(t.before, p), after: cleanObs(t.after, p), action };
}

/* ---------- storage ---------- */

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function storeObs(db: DatabaseSync, productId: string, obs: Obs): string {
  const json = canonical(obs);
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 32);
  db.prepare('INSERT OR IGNORE INTO observations (hash, product_id, json, first_seen) VALUES (?, ?, ?, ?)').run(
    hash,
    productId,
    json,
    Date.now()
  );
  return hash;
}

function labelHashes(t: Transition): string[] {
  const out: string[] = [];
  const add = (l: { hash: string } | null | undefined) => l && out.push(l.hash);
  for (const obs of [t.before, t.after]) {
    add(obs.title);
    add(obs.heading);
    for (const n of obs.nodes) {
      add(n.name);
      add(n.within);
    }
  }
  add(t.action.target.name);
  add(t.action.target.within);
  return out;
}

/* ---------- entry point ---------- */

export type IngestResult = {
  accepted: number;
  duplicate: number;
  rejected: Array<{ index: number; reason: string }>;
  promoted: string[];
};

export function ingestBatch(db: DatabaseSync, raw: unknown): IngestResult | { error: string; status: number } {
  const parsed = Batch.safeParse(raw);
  if (!parsed.success) return { error: `bad batch: ${parsed.error.issues[0]?.message ?? 'invalid'}`, status: 400 };
  const batch = parsed.data;

  const product = db.prepare('SELECT id, origin FROM products WHERE id = ?').get(batch.productId) as
    | { id: string; origin: string }
    | undefined;
  if (!product) return { error: 'unknown product', status: 404 };
  /* Ground truth is a test instrument. A real product that happened to carry
     data-screen attributes must never have them stored, so this is gated on the
     product being local, independently of whatever the client says. */
  const acceptsTruth = isLocalOrigin(product.origin);

  const install = upsertInstall(db, batch.productId, batch.install);
  if ('error' in install) return { error: install.error, status: 403 };

  const policy: Policy = { ...install, promoted: promotedLabels(db, batch.productId) };
  const result: IngestResult = { accepted: 0, duplicate: 0, rejected: [], promoted: [] };
  const now = Date.now();

  /* One bad item is rejected on its own. It does not cost the rest of the batch. */
  db.exec('BEGIN');
  try {
    batch.transitions.forEach((item, index) => {
      const t = Transition.safeParse(item);
      if (!t.success) {
        result.rejected.push({ index, reason: t.error.issues[0]?.message ?? 'invalid transition' });
        return;
      }
      const clean = cleanTransition(t.data, policy);
      const before = storeObs(db, batch.productId, clean.before);
      const after = storeObs(db, batch.productId, clean.after);
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO transitions
             (product_id, install_id, episode, seq, at, source, before_hash, after_hash, action_json,
              crossed_navigation, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          batch.productId,
          batch.install.id,
          clean.episode,
          clean.seq,
          clean.at,
          clean.source,
          before,
          after,
          canonical(clean.action),
          clean.crossedNavigation ? 1 : 0,
          now
        );
      if (info.changes === 0) {
        result.duplicate++;
        return;
      }
      result.accepted++;

      if (acceptsTruth && t.data.truth) {
        db.prepare(
          `INSERT OR IGNORE INTO dev_truth (install_id, episode, seq, product_id, before_screen, after_screen)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(batch.install.id, clean.episode, clean.seq, batch.productId, t.data.truth.before, t.data.truth.after);
      }

      /* Only independent customer installs count as k-anonymity evidence. A vendor's
         own demo tenant says nothing about what is safe in a customer's data. */
      if (install.mode === 'customer') {
        const stmt = db.prepare(
          'INSERT OR IGNORE INTO label_sightings (product_id, label_hash, install_id) VALUES (?, ?, ?)'
        );
        for (const h of labelHashes(clean)) stmt.run(batch.productId, h, batch.install.id);
      }
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return { error: `storage failed: ${err instanceof Error ? err.message : String(err)}`, status: 500 };
  }

  result.promoted = [...promotedLabels(db, batch.productId)];
  return result;
}
