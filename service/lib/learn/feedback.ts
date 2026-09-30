/* Demotion (G7): a verified route that fails in real use stops being offered.
 *
 * Signals are not equal. A REPAIR (its target was not where the route said) and a
 * failed SCREEN CHECK (the page was not the screen the route expects) both mean the
 * route no longer matches the product: one is enough. A SKIP is a person's choice and
 * can mean many things, so it takes several, from more than one person. COMPLETED is
 * positive evidence and is only counted.
 *
 * Feedback applies to the exact path it was given for. Feedback about an older path
 * of a route whose path has since changed says nothing about the current one and is
 * recorded but not acted on. */

import type { DatabaseSync } from 'node:sqlite';
import { recordRouteEvent } from './events.ts';

export type FeedbackKind = 'completed' | 'skipped' | 'repaired' | 'wrongScreen';
export const SKIPS_TO_DEMOTE = 3;
export const SKIP_INSTALLS_TO_DEMOTE = 2;

export type FeedbackResult = { recorded: boolean; demoted: boolean; status: string | null; reason: string | null };

export function recordFeedback(
  db: DatabaseSync,
  f: { productId: string; routeId: string; pathHash: string; installId: string; kind: FeedbackKind; step?: number | null }
): FeedbackResult {
  const route = db.prepare('SELECT status, path_hash, verified_path_hash FROM routes WHERE id = ? AND product_id = ?').get(f.routeId, f.productId) as
    | { status: string; path_hash: string; verified_path_hash: string | null }
    | undefined;
  if (!route) return { recorded: false, demoted: false, status: null, reason: 'unknown route' };

  const now = Date.now();
  db.prepare('INSERT INTO route_feedback (product_id, route_id, path_hash, install_id, kind, step, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    f.productId, f.routeId, f.pathHash, f.installId, f.kind, f.step ?? null, now
  );

  const current = route.status === 'verified' && route.path_hash === f.pathHash && route.verified_path_hash === f.pathHash;
  if (!current) return { recorded: true, demoted: false, status: route.status, reason: 'feedback is about a path that is no longer the verified one' };

  let reason: string | null = null;
  if (f.kind === 'repaired') reason = 'in use, a step could not be found where the route said and had to be repaired';
  if (f.kind === 'wrongScreen') reason = 'in use, the page was not the screen the route expects';
  if (f.kind === 'skipped') {
    const s = db
      .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT install_id) AS people FROM route_feedback WHERE route_id = ? AND path_hash = ? AND kind = 'skipped'")
      .get(f.routeId, f.pathHash) as { n: number; people: number };
    if (s.n >= SKIPS_TO_DEMOTE && s.people >= SKIP_INSTALLS_TO_DEMOTE) reason = `in use, people declined its steps ${s.n} times`;
  }
  if (!reason) return { recorded: true, demoted: false, status: route.status, reason: null };

  db.prepare("UPDATE routes SET status = 'demoted', status_reason = ?, updated_at = ? WHERE id = ?").run(reason, now, f.routeId);
  recordRouteEvent(db, { productId: f.productId, routeId: f.routeId, kind: 'demoted', at: now, detail: reason });
  return { recorded: true, demoted: true, status: 'demoted', reason };
}
