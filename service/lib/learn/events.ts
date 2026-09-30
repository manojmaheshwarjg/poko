import type { DatabaseSync } from 'node:sqlite';

/* A route's history, beyond what the verifications table already records: when mining
   first produced it, when its status changed and why, and every hold and release.
   Written inside the same transaction as the change it describes, so the history can
   never claim something the route table does not show. */

export type RouteEventKind = 'mined' | 'status' | 'stale' | 'held' | 'released' | 'demoted';

export function recordRouteEvent(
  db: DatabaseSync,
  e: { productId: string; routeId: string; kind: RouteEventKind; detail?: string | null; at?: number }
): void {
  db.prepare('INSERT INTO route_events (product_id, route_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)').run(
    e.productId, e.routeId, e.at ?? Date.now(), e.kind, e.detail ?? null
  );
}
