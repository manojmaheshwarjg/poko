import type { DatabaseSync } from 'node:sqlite';

/* A route's history, newest first: mined, verified, held, released, demoted, stale.
 *
 * Read from three places. Every verification attempt is a row of its own. Changes
 * made since route events existed are events. Routes that predate events still show
 * when they were first mined and last held, from the route row itself, so older
 * routes are not shown as having no past. */

export type HistoryItem = { at: number; kind: string; text: string; detail: string | null };

type Verification = { at: number; outcome: string; reason: string | null; label: string | null; calls: number };

const short = (s: string | null, n = 140) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function routeHistory(db: DatabaseSync, routeId: string): HistoryItem[] {
  const route = db.prepare('SELECT first_seen, installs, attempts, held_at, status, status_reason FROM routes WHERE id = ?').get(routeId) as
    | { first_seen: number; installs: number; attempts: number; held_at: number | null; status: string; status_reason: string | null }
    | undefined;
  if (!route) return [];
  const items: HistoryItem[] = [];

  const events = db.prepare('SELECT at, kind, detail FROM route_events WHERE route_id = ? ORDER BY at').all(routeId) as Array<{ at: number; kind: string; detail: string | null }>;
  const text: Record<string, string> = {
    mined: 'Mined from real use',
    status: 'Status changed',
    stale: 'Went stale',
    held: 'Held back',
    released: 'Released',
    demoted: 'Demoted',
  };
  for (const e of events) items.push({ at: e.at, kind: e.kind, text: text[e.kind] ?? e.kind, detail: short(e.detail) });

  if (!events.some((e) => e.kind === 'mined')) {
    items.push({ at: route.first_seen, kind: 'mined', text: `Mined from ${route.installs} ${route.installs === 1 ? 'person' : 'people'}`, detail: null });
  }
  if (route.held_at && !events.some((e) => e.kind === 'held' && e.at === route.held_at)) {
    items.push({ at: route.held_at, kind: 'held', text: 'Held back', detail: short(route.status_reason) });
  }

  const checks = db.prepare('SELECT at, outcome, reason, label, calls FROM verifications WHERE route_id = ? ORDER BY at').all(routeId) as Verification[];
  let lastLabel: string | null = null;
  for (const v of checks) {
    const calls = `${v.calls} ${v.calls === 1 ? 'call' : 'calls'}`;
    const relabelled = v.outcome === 'verified' && lastLabel !== null && v.label !== null && v.label !== lastLabel;
    const verb: Record<string, string> = { verified: relabelled ? 'Re-checked, new label' : 'Verified', rejected: 'Rejected', gap: 'Found a gap', skipped: 'Not checked' };
    items.push({ at: v.at, kind: `verify-${v.outcome}`, text: `${verb[v.outcome] ?? v.outcome}, ${calls}`, detail: short(v.outcome === 'verified' ? v.label : v.reason) });
    if (v.label) lastLabel = v.label;
  }
  return items.sort((a, b) => b.at - a.at);
}
