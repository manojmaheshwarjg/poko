import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import redact from '../../core/redact.js';
/* The same rules the explorer ran in the browser. The server uses them only to
   check that what a client reports is in their vocabulary. */
import rules from '../../core/explore-rules.js';
import {
  Label, Obs, Region, cleanObs, isLocalOrigin, promotedLabels, recheck, storeObs, upsertInstall, type Policy,
} from './ingest.ts';

/* Phase G: what read-only exploration found.
 *
 * Accepted only from a vendor install that attests its tenant holds no real data.
 * Exploration opens pages on its own, and that is acceptable only on a demo tenant;
 * the server cannot see the tenant, but it can refuse anyone who has not said so,
 * and the privilege ratchet means an install cannot say so later than it first did.
 *
 * Everything is re-checked on arrival as for capture (G4): labels are re-redacted,
 * URLs re-normalised, reasons and words must come from the rules' fixed vocabulary.
 * Explored pages become observations, so clustering sees them. They never become
 * transitions, so mining never does (G6). */

export const MAX_PAGES_PER_BATCH = 50;

const Page = z.object({
  url: z.string().max(1000),
  from: z.string().max(1000).nullable(),
  via: Label.nullable(),
  viaRegion: Region.nullable().optional(),
  at: z.number().int().positive(),
  observation: Obs,
  truth: z.string().max(64).nullable().optional(),
});
const STOPS = ['done', 'limit', 'stopped', 'left', 'signed-out', 'error'] as const;
const Run = z.object({
  id: z.string().regex(/^x_[0-9a-f]{8,32}$/),
  startUrl: z.string().max(1000).nullable(),
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive().optional(),
  stopped: z.enum(STOPS).optional(),
  skipped: z
    .array(z.object({ url: z.string().max(1000).nullable(), reason: z.string().max(40), word: z.string().max(40).nullable().optional() }))
    .max(500)
    .optional(),
  failures: z
    .array(z.object({ url: z.string().max(1000).nullable(), reason: z.enum(['timeout', 'http', 'left', 'error']), status: z.number().int().optional() }))
    .max(200)
    .optional(),
});
const Batch = z.object({
  productId: z.string().min(1).max(64),
  install: z.object({ id: z.string().min(8).max(64), mode: z.enum(['vendor', 'customer']), attested: z.boolean().optional(), enrollment: z.string().max(64).optional() }),
  run: Run,
  pages: z.array(z.unknown()).max(MAX_PAGES_PER_BATCH),
});

export type ExploreResult = { accepted: number; duplicate: number; rejected: Array<{ index: number; reason: string }> };

const normal = (url: string | null | undefined) => (url ? redact.normalizeUrl(url) : null);

/* Same-origin links are kept as their pattern; anything else as its origin only. */
function cleanSkipUrl(url: string | null, origin: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin === origin ? redact.normalizeUrl(u.toString()) : u.origin;
  } catch {
    return null;
  }
}

export function ingestExploration(db: DatabaseSync, raw: unknown): ExploreResult | { error: string; status: number } {
  const parsed = Batch.safeParse(raw);
  if (!parsed.success) return { error: `bad batch: ${parsed.error.issues[0]?.message ?? 'invalid'}`, status: 400 };
  const batch = parsed.data;

  const product = db.prepare('SELECT id, origin FROM products WHERE id = ?').get(batch.productId) as
    | { id: string; origin: string }
    | undefined;
  if (!product) return { error: 'unknown product', status: 404 };

  const install = upsertInstall(db, batch.productId, batch.install);
  if ('error' in install) return { error: install.error, status: 403 };
  if (install.mode !== 'vendor' || !install.attested) {
    return { error: 'exploration is accepted only from a vendor install that attests its tenant holds no real data', status: 403 };
  }

  const policy: Policy = { ...install, promoted: promotedLabels(db, batch.productId) };
  const acceptsTruth = isLocalOrigin(product.origin);
  const result: ExploreResult = { accepted: 0, duplicate: 0, rejected: [] };
  const run = batch.run;
  const now = Date.now();

  db.exec('BEGIN');
  try {
    const existing = db.prepare('SELECT product_id, install_id FROM explorations WHERE id = ?').get(run.id) as
      | { product_id: string; install_id: string }
      | undefined;
    if (existing && (existing.product_id !== batch.productId || existing.install_id !== batch.install.id)) {
      db.exec('ROLLBACK');
      return { error: 'that run belongs to another install', status: 403 };
    }
    if (!existing) {
      db.prepare(
        'INSERT INTO explorations (id, product_id, install_id, start_url, started_at, received_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(run.id, batch.productId, batch.install.id, normal(run.startUrl), run.startedAt, now);
    }

    const insPage = db.prepare(
      `INSERT OR IGNORE INTO explore_pages (run_id, product_id, url, obs_hash, from_url, via_json, at, truth, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    batch.pages.forEach((item, index) => {
      const p = Page.safeParse(item);
      if (!p.success) {
        result.rejected.push({ index, reason: p.error.issues[0]?.message ?? 'invalid page' });
        return;
      }
      const url = normal(p.data.url);
      if (!url || !url.startsWith(product.origin + '/')) {
        result.rejected.push({ index, reason: 'page is not on this product' });
        return;
      }
      const obs = cleanObs(p.data.observation, policy);
      const hash = storeObs(db, batch.productId, obs);
      const via = p.data.via ? recheck(p.data.via, 'link', p.data.viaRegion ?? undefined, policy) : null;
      const info = insPage.run(
        run.id, batch.productId, url, hash, normal(p.data.from), via ? JSON.stringify(via) : null, p.data.at,
        acceptsTruth ? p.data.truth ?? null : null, now
      );
      if (info.changes === 0) result.duplicate++;
      else result.accepted++;
    });

    if (run.finishedAt) {
      const skipped = (run.skipped ?? [])
        .filter((s) => Object.hasOwn(rules.REASONS, s.reason))
        .map((s) => ({
          url: cleanSkipUrl(s.url, product.origin),
          reason: s.reason,
          word: s.word && rules.DANGEROUS.includes(s.word) ? s.word : null,
        }));
      const failures = (run.failures ?? []).map((f) => ({
        url: cleanSkipUrl(f.url, product.origin),
        reason: f.reason,
        ...(f.status !== undefined ? { status: f.status } : {}),
      }));
      const pages = (db.prepare('SELECT COUNT(*) AS n FROM explore_pages WHERE run_id = ?').get(run.id) as { n: number }).n;
      db.prepare(
        'UPDATE explorations SET finished_at = ?, stopped = ?, pages = ?, skipped_json = ?, failures_json = ? WHERE id = ?'
      ).run(run.finishedAt, run.stopped ?? 'done', pages, JSON.stringify(skipped), JSON.stringify(failures), run.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return { error: `storage failed: ${err instanceof Error ? err.message : String(err)}`, status: 500 };
  }
  return result;
}

export type ExplorationRow = {
  id: string; start_url: string | null; started_at: number; finished_at: number | null; stopped: string | null;
  pages: number; skipped_json: string; failures_json: string;
};

export function explorationsFor(db: DatabaseSync, productId: string): ExplorationRow[] {
  return db
    .prepare(
      `SELECT e.id, e.start_url, e.started_at, e.finished_at, e.stopped,
              (SELECT COUNT(*) FROM explore_pages p WHERE p.run_id = e.id) AS pages,
              e.skipped_json, e.failures_json
         FROM explorations e WHERE e.product_id = ? ORDER BY e.started_at DESC`
    )
    .all(productId) as ExplorationRow[];
}

export const STOP_TEXT: Record<string, string> = {
  done: 'no more links to open',
  limit: 'reached the page limit',
  stopped: 'stopped by the person running it',
  left: 'a page moved to another site (signed out, or the product refuses to be framed)',
  'signed-out': 'a sign-in page appeared, so the session had ended',
  error: 'an error in the explorer',
};
