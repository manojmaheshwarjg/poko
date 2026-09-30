/* The transition graph: from a screen, this action leads to that screen.
 *
 * Built from every transition, the copilot's included, because an edge is a fact
 * about the product: the copilot clicked, the page really did change. But counts
 * are kept per source, so anything that MINES the graph for routes can use human
 * evidence alone (G6) while still seeing everything that happened. */

import type { Label } from './screens.ts';

export type StoredAction = {
  type: 'click' | 'setChecked' | 'setValue';
  target: { role: string | null; name: Label; within?: Label; region?: string | null };
  value?: boolean;
};

export type TransitionRow = {
  beforeHash: string;
  afterHash: string;
  source: 'user' | 'copilot';
  at: number;
  action: StoredAction;
};

export type Edge = {
  from: string;
  to: string;
  actionKey: string;
  action: StoredAction;
  users: number;
  copilot: number;
  firstSeen: number;
  lastSeen: number;
};

export function actionKey(a: StoredAction): string {
  const t = a.target;
  return [a.type, t.role ?? '', t.name?.hash ?? '', t.within?.hash ?? '', a.value === undefined ? '' : String(a.value)].join('|');
}

export function buildGraph(rows: TransitionRow[], screenOf: Map<string, string>): { edges: Edge[]; unplaced: number } {
  const edges = new Map<string, Edge>();
  let unplaced = 0;
  for (const r of rows) {
    const from = screenOf.get(r.beforeHash);
    const to = screenOf.get(r.afterHash);
    /* Every observation should belong to a screen. If one does not, the transition
       is counted rather than silently dropped, so the gap is visible. */
    if (!from || !to) {
      unplaced++;
      continue;
    }
    const key = actionKey(r.action);
    const id = `${from}\u0000${key}\u0000${to}`;
    const e = edges.get(id) ?? { from, to, actionKey: key, action: r.action, users: 0, copilot: 0, firstSeen: r.at, lastSeen: r.at };
    if (r.source === 'user') e.users++;
    else e.copilot++;
    e.firstSeen = Math.min(e.firstSeen, r.at);
    e.lastSeen = Math.max(e.lastSeen, r.at);
    /* Keep the richest example of the action: one that carries clear text. */
    if (!e.action.target.name?.text && r.action.target.name?.text) e.action = r.action;
    edges.set(id, e);
  }
  return { edges: [...edges.values()].sort((a, b) => (a.from + a.actionKey < b.from + b.actionKey ? -1 : 1)), unplaced };
}
