import type { DatabaseSync } from 'node:sqlite';
/* The same verdict the eval runner prints, so what is printed is what is enforced. */
import { compareModes } from '../../../eval/compare.mjs';
import { recordRouteEvent } from './events.ts';

/* G9, enforced: learning can only add, never subtract.
 *
 * A with/without comparison that finds a regression holds back every route that was
 * offered where planning got worse. Which of them did the harm cannot be told from
 * one run, so all of them are held: a held route costs some help, a kept bad one
 * costs correctness. Held routes are never offered in normal use.
 *
 * A hold is released only by a later comparison, run with held routes included, that
 * finds no regression and no unanswered scenario, and in which that route was
 * actually offered. Nothing else releases it. Passing verification again does not:
 * passing verification is what the route had already done before it made planning
 * worse. */

type Row = { id: string; status: string; label: string | null };
export type G9Plan = {
  verdict: ReturnType<typeof compareModes>;
  refused: string | null;
  hold: Array<{ id: string; label: string | null; was: string }>;
  release: Array<{ id: string; label: string | null }>;
  keep: Array<{ id: string; label: string | null; why: string }>;
};

export function planG9(db: DatabaseSync, productId: string, results: unknown[]): G9Plan {
  const verdict = compareModes(results);
  if (!verdict.complete) {
    return { verdict, refused: 'not a with/without comparison: every scenario must have run both ways (eval/run.mjs --compare)', hold: [], release: [], keep: [] };
  }
  const rows = db.prepare('SELECT id, status, label FROM routes WHERE product_id = ? ORDER BY id').all(productId) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const hold: G9Plan['hold'] = [];
  if (verdict.regressed.length) {
    for (const id of verdict.implicated) {
      const r = byId.get(id);
      /* Only a route that could have been offered: anything else has already been
         taken out of use for another reason, which stands. */
      if (r && (r.status === 'verified' || r.status === 'held')) hold.push({ id, label: r.label, was: r.status });
    }
  }
  const holding = new Set(hold.map((h) => h.id));

  const release: G9Plan['release'] = [];
  const keep: G9Plan['keep'] = [];
  for (const r of rows) {
    if (r.status !== 'held' || holding.has(r.id)) continue;
    const why = verdict.regressed.length
      ? 'the comparison found a regression'
      : verdict.inconclusive.length
        ? `some scenarios got no answer (${verdict.inconclusive.join(', ')}); re-run them first`
        : !verdict.tested.includes(r.id)
          ? 'it was not offered in this comparison (run the eval with --include-held)'
          : null;
    if (why) keep.push({ id: r.id, label: r.label, why });
    else release.push({ id: r.id, label: r.label });
  }
  return { verdict, refused: null, hold, release, keep };
}

export function applyG9(db: DatabaseSync, plan: G9Plan, source: string, now = Date.now()): void {
  if (plan.refused) throw new Error(plan.refused);
  const reason = `offering it made planning worse in the with/without comparison ${source} (${plan.verdict.regressed.join(', ')})`;
  const holdStmt = db.prepare("UPDATE routes SET status = 'held', status_reason = ?, held_at = ?, updated_at = ? WHERE id = ?");
  const releaseStmt = db.prepare("UPDATE routes SET status = 'verified', status_reason = NULL, updated_at = ? WHERE id = ? AND status = 'held'");
  const productOf = db.prepare('SELECT product_id FROM routes WHERE id = ?');
  const productId = (id: string) => (productOf.get(id) as { product_id: string } | undefined)?.product_id ?? '';
  db.exec('BEGIN');
  try {
    for (const h of plan.hold) {
      holdStmt.run(reason, now, now, h.id);
      recordRouteEvent(db, { productId: productId(h.id), routeId: h.id, kind: 'held', at: now, detail: reason });
    }
    for (const r of plan.release) {
      if (releaseStmt.run(now, r.id).changes) {
        recordRouteEvent(db, { productId: productId(r.id), routeId: r.id, kind: 'released', at: now, detail: `a clean with/without comparison (${source}) in which it was offered` });
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
