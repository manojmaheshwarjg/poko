import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import redact from '../../core/redact.js';
import { Label, promotedLabels, recheck, upsertInstall, type Policy } from './ingest.ts';

/* Phase L: copilot decisions. Accepted from any install that captures, customer mode
   included: customers are where the copilot is actually wrong. Everything is re-checked
   as for capture (G4). No goal, intent or reasoning text is accepted at all: the schema
   has nowhere to put it. */

const Decision = z.object({
  at: z.number().int().positive(),
  runId: z.string().min(1).max(64),
  stepId: z.string().min(1).max(64),
  kind: z.enum(redact.DECISIONS as [string, ...string[]]),
  url: z.string().max(1000).nullable(),
  heading: Label.nullable(),
  planned: z.object({ role: z.string().max(40).nullable(), name: Label.nullable(), within: Label.nullable().optional() }).nullable(),
  located: z.object({ role: z.string().max(40).nullable(), name: Label.nullable() }).nullable(),
  action: z.object({ type: z.enum(['click', 'setChecked', 'setValue']), value: z.boolean().optional() }).nullable(),
  route: z.string().max(64).nullable(),
});
const Batch = z.object({
  productId: z.string().min(1).max(64),
  install: z.object({ id: z.string().min(8).max(64), mode: z.enum(['vendor', 'customer']), attested: z.boolean().optional(), enrollment: z.string().max(64).optional() }),
  decisions: z.array(z.unknown()).max(50),
});

export type DecisionResult = { accepted: number; duplicate: number; rejected: Array<{ index: number; reason: string }> };

export function ingestDecisions(db: DatabaseSync, raw: unknown): DecisionResult | { error: string; status: number } {
  const parsed = Batch.safeParse(raw);
  if (!parsed.success) return { error: `bad batch: ${parsed.error.issues[0]?.message ?? 'invalid'}`, status: 400 };
  const batch = parsed.data;
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(batch.productId) as { id: string } | undefined;
  if (!product) return { error: 'unknown product', status: 404 };
  const install = upsertInstall(db, batch.productId, batch.install);
  if ('error' in install) return { error: install.error, status: 403 };
  const policy: Policy = { mode: install.mode, attested: install.attested, promoted: promotedLabels(db, batch.productId) };

  const result: DecisionResult = { accepted: 0, duplicate: 0, rejected: [] };
  const ins = db.prepare(
    `INSERT OR IGNORE INTO decisions (product_id, install_id, run_id, step_id, at, kind, url, heading_json, planned_json, located_json, action_json, route_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  db.exec('BEGIN');
  try {
    batch.decisions.forEach((item, index) => {
      const d = Decision.safeParse(item);
      if (!d.success) {
        result.rejected.push({ index, reason: d.error.issues[0]?.message ?? 'invalid decision' });
        return;
      }
      const x = d.data;
      const planned = x.planned
        ? { role: x.planned.role, name: recheck(x.planned.name, x.planned.role ?? 'button', undefined, policy), within: x.planned.within ? recheck(x.planned.within, 'heading', undefined, policy) : null }
        : null;
      const located = x.located ? { role: x.located.role, name: recheck(x.located.name, x.located.role, undefined, policy) } : null;
      const info = ins.run(
        batch.productId, batch.install.id, x.runId, x.stepId, x.at, x.kind,
        x.url ? redact.normalizeUrl(x.url) : null,
        JSON.stringify(recheck(x.heading, 'heading', 'chrome', policy)),
        planned ? JSON.stringify(planned) : null,
        located ? JSON.stringify(located) : null,
        x.action ? JSON.stringify(x.action) : null,
        x.route, now
      );
      if (info.changes === 0) result.duplicate++;
      else result.accepted++;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return { error: `storage failed: ${err instanceof Error ? err.message : String(err)}`, status: 500 };
  }
  return result;
}

/* Which struggle each decision is evidence of. Approvals are not struggles. */
export const DECISION_STRUGGLE: Record<string, string | null> = {
  approved: null,
  failed: 'copilotFailed',
  skipped: 'copilotRejected',
  repaired: 'copilotMissed',
  'repair-failed': 'copilotMissed',
  wrongScreen: 'copilotWrongScreen',
};
