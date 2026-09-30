import type { DatabaseSync } from 'node:sqlite';

/* "Take me there": the way from the screen a person is on to the screen a step needs,
 * along the links people actually use. No model is involved: it is a shortest path
 * over the learned graph, fewest steps first and the most used link where there is a
 * choice.
 *
 * A link that is a menu item needs its menu opened first, so the button people open
 * on that screen is put in front of it. Only links whose labels are known in clear
 * can be followed: a private label (customer mode, not yet promoted) cannot be found
 * on the page by name, so a way through one is refused rather than guessed.
 *
 * Every step is navigation. That is what lets one approval cover all of them (the
 * person pressed "Take me there, N steps"); anything that changes something still
 * waits for its own approval. */

export type WayStep = { from: string; to: string; target: { role: string; name: string }; action: { type: 'click' } };
export type Way = { ok: true; steps: WayStep[]; screens: string[] } | { ok: false; reason: string };

type Edge = { from_screen: string; to_screen: string; action_json: string; users: number };
type Action = { type: string; target?: { role?: string | null; name?: { text?: string } | null } };

const NAV_ROLES = new Set(['link', 'menuitem', 'tab', 'button', 'option']);

export function screensForWayfinding(db: DatabaseSync, productId: string) {
  return (db.prepare('SELECT id, display_name, core_keys_json FROM screens WHERE product_id = ?').all(productId) as Array<{
    id: string;
    display_name: string;
    core_keys_json: string;
  }>).map((s) => ({ id: s.id, name: s.display_name, keys: JSON.parse(s.core_keys_json) as string[] }));
}

export function wayfind(db: DatabaseSync, productId: string, from: string, to: string): Way {
  if (from === to) return { ok: true, steps: [], screens: [from] };
  const edges = db.prepare('SELECT from_screen, to_screen, action_json, users FROM edges WHERE product_id = ? ORDER BY users DESC, action_json').all(productId) as Edge[];
  const act = (e: Edge) => JSON.parse(e.action_json) as Action;
  const moves = edges.filter((e) => e.from_screen !== e.to_screen && act(e).type === 'click' && NAV_ROLES.has(act(e).target?.role ?? ''));

  /* Breadth first; edges are already in order of use, so the first way found to a
     screen is the most used of the shortest. */
  const via = new Map<string, Edge>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length && !seen.has(to)) {
    const v = queue.shift()!;
    for (const e of moves) {
      if (e.from_screen !== v || seen.has(e.to_screen)) continue;
      seen.add(e.to_screen);
      via.set(e.to_screen, e);
      queue.push(e.to_screen);
    }
  }
  if (!seen.has(to)) return { ok: false, reason: 'nobody has gone from this screen to that one yet' };

  const path: Edge[] = [];
  for (let at = to; at !== from; ) {
    const e = via.get(at)!;
    path.unshift(e);
    at = e.from_screen;
  }
  const steps: WayStep[] = [];
  for (const e of path) {
    const a = act(e);
    if (a.target?.role === 'menuitem' || a.target?.role === 'option') {
      /* The menu on this screen people open before choosing from it. */
      const opener = edges.find(
        (x) => x.from_screen === e.from_screen && x.to_screen === e.from_screen && act(x).type === 'click' && act(x).target?.role === 'button'
      );
      if (!opener) return { ok: false, reason: 'the way goes through a menu nobody has been seen opening' };
      const o = act(opener);
      if (!o.target?.name?.text) return { ok: false, reason: 'the way uses a control whose label is private' };
      steps.push({ from: e.from_screen, to: e.from_screen, target: { role: 'button', name: o.target.name.text }, action: { type: 'click' } });
    }
    const name = a.target?.name?.text;
    if (!name) return { ok: false, reason: 'the way uses a control whose label is private' };
    steps.push({ from: e.from_screen, to: e.to_screen, target: { role: a.target!.role!, name }, action: { type: 'click' } });
  }
  return { ok: true, steps, screens: [from, ...path.map((e) => e.to_screen)] };
}

/* What a person can ask for in this product: routes that passed verification and are
   offered to the planner now. Held routes are not suggested; they are not offered. */
export function suggestions(db: DatabaseSync, productId: string, limit = 6) {
  return db
    .prepare("SELECT id, label, title, installs FROM routes WHERE product_id = ? AND status = 'verified' AND label IS NOT NULL ORDER BY installs DESC LIMIT ?")
    .all(productId, limit) as Array<{ id: string; label: string; title: string | null; installs: number }>;
}
