/* Mining: from human sessions to routes worth offering and places people struggle.
 *
 * Only human transitions are mined (G6). An episode is split wherever the copilot
 * acted, because a stretch the copilot drove is not evidence of what a person knew
 * how to do, and mining it would let the system learn from its own output.
 *
 * Every transition is classified by what it observably did, from a diff of the
 * screen before and after, never from what the control is called. Attempts are then
 * normalised: detours, peeks, dead clicks and undone changes are cut out and kept as
 * struggle signals, leaving the route the person actually needed. That is what lets
 * a hesitant user and an expert count as evidence for the same route. */

import { createHash } from 'node:crypto';
import { nodeKey, TRANSIENT_ROLES, type StoredObs } from './screens.ts';
import { actionKey, type StoredAction } from './graph.ts';

export type Effect = 'navigate' | 'open' | 'close' | 'mutate' | 'none';

export type Step = {
  at: number;
  source: 'user' | 'copilot';
  install: string;
  episode: string;
  seq: number;
  from: string;
  to: string;
  action: StoredAction;
  before: StoredObs;
  after: StoredObs;
};

export type ClassifiedStep = Step & { effect: Effect; key: string };

export type Signal = {
  kind: 'backtrack' | 'loop' | 'peek' | 'deadClick' | 'undo' | 'abandon';
  screen: string;
  control: string | null;
  action: StoredAction | null;
};

export type Attempt = {
  install: string;
  episode: string;
  steps: ClassifiedStep[];
  clean: ClassifiedStep[];
  signals: Signal[];
  kind: 'effect' | 'destination' | 'browse';
};

export type RouteCandidate = {
  id: string;
  kind: 'effect' | 'destination';
  goal: { screen: string; actions: string[] };
  goalActions: StoredAction[];
  path: Array<{ screen: string; key: string; action: StoredAction; effect: Effect }>;
  endScreen: string;
  pathHash: string;
  variants: Array<{ pathHash: string; attempts: number; start: string; length: number }>;
  attempts: number;
  installs: number;
  firstSeen: number;
  lastSeen: number;
  status: 'candidate' | 'blocked';
  blockedReason: string | null;
};

export type StrugglePoint = {
  screen: string;
  kind: Signal['kind'];
  control: string | null;
  action: StoredAction | null;
  attempts: number;
  installs: number;
};

export type MineOptions = {
  minSupport?: number;
  gapMs?: number;
  effectRunMs?: number;
  loopVisits?: number;
  ambiguousScreens?: Set<string>;
};

const DEFAULTS = { minSupport: 2, gapMs: 90_000, effectRunMs: 20_000, loopVisits: 3 };

/* ---------- what did a transition do? ---------- */

type NodeView = { key: string; transient: boolean; checked?: boolean; expanded?: boolean };

function view(obs: StoredObs): Map<string, NodeView> {
  const out = new Map<string, NodeView>();
  for (const n of obs.nodes) {
    const key = nodeKey(n);
    if (!key || out.has(key)) continue;
    out.set(key, { key, transient: TRANSIENT_ROLES.has(n.role), checked: n.state?.checked, expanded: n.state?.expanded });
  }
  return out;
}

export function classifyEffect(step: Step): Effect {
  /* Typed text is never stored, so a text change cannot be seen in the diff. The
     action itself is the only evidence, and it is taken at its word. */
  if (step.action.type === 'setValue') return 'mutate';
  if (step.from !== step.to) return 'navigate';

  const b = view(step.before);
  const a = view(step.after);
  let persistentChanged = false;
  let opened = false;
  let closed = false;

  for (const [k, nb] of b) {
    const na = a.get(k);
    if (!na) {
      if (nb.transient) closed = true;
      else persistentChanged = true;
      continue;
    }
    /* Only `checked` counts as a change to the product. `expanded` is a menu or
       disclosure opening, which changes what is visible, not what is stored. */
    if (!nb.transient && nb.checked !== undefined && nb.checked !== na.checked) persistentChanged = true;
    if (nb.expanded === false && na.expanded === true) opened = true;
    if (nb.expanded === true && na.expanded === false) closed = true;
  }
  for (const [k, na] of a) {
    if (b.has(k)) continue;
    if (na.transient) opened = true;
    else persistentChanged = true;
  }

  if (persistentChanged) return 'mutate';
  if (opened) return 'open';
  if (closed) return 'close';
  return 'none';
}

/* ---------- sessions into attempts ---------- */

/* An attempt is one try at one task: navigation, then the change that was the
   point of it. Several changes in a row on the same screen are one task ("remove
   this permission and grant that one"). A long pause, or a new navigation after a
   change, starts a new attempt. The copilot acting breaks human continuity. */
export function segment(steps: ClassifiedStep[], opts: Required<Pick<MineOptions, 'gapMs' | 'effectRunMs'>>): ClassifiedStep[][] {
  const sorted = [...steps].sort((a, b) => a.seq - b.seq);
  const out: ClassifiedStep[][] = [];
  let cur: ClassifiedStep[] = [];
  const close = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const s of sorted) {
    if (s.source !== 'user') {
      close();
      continue;
    }
    const prev = cur[cur.length - 1];
    if (prev && s.at - prev.at > opts.gapMs) close();
    const last = cur[cur.length - 1];
    if (last && last.effect === 'mutate') {
      const sameRun = s.effect === 'mutate' && s.from === last.to && s.at - last.at <= opts.effectRunMs;
      if (!sameRun) close();
    }
    cur.push(s);
  }
  close();
  return out;
}

/* ---------- normalise one attempt ---------- */

/* The control itself, without the direction of the change. actionKey includes the
   value, so "untick X" and "tick X" have different keys; spotting that one undoes the
   other needs a key that is the same for both. */
function controlOf(a: StoredAction): string {
  const t = a.target;
  return [t.role ?? '', t.name?.hash ?? '', t.within?.hash ?? ''].join('|');
}

export function normalize(steps: ClassifiedStep[], loopVisits = DEFAULTS.loopVisits): { clean: ClassifiedStep[]; signals: Signal[] } {
  const signals: Signal[] = [];
  let path = [...steps];

  /* Undone changes cancel. A box ticked and then unticked again is a mistake
     corrected, not part of the task, and the correction is itself a signal. */
  const netState = new Map<string, { first: boolean | undefined; last: boolean | undefined; step: ClassifiedStep }>();
  for (const s of path) {
    if (s.action.type !== 'setChecked') continue;
    const c = controlOf(s.action);
    const e = netState.get(c);
    if (!e) netState.set(c, { first: s.action.value === undefined ? undefined : !s.action.value, last: s.action.value, step: s });
    else e.last = s.action.value;
  }
  const undone = new Set<string>();
  for (const [c, e] of netState) {
    if (e.first !== undefined && e.first === e.last) {
      undone.add(c);
      signals.push({ kind: 'undo', screen: e.step.from, control: c, action: e.step.action });
    }
  }
  path = path.filter((s) => !(s.action.type === 'setChecked' && undone.has(controlOf(s.action))));

  /* Dead clicks: something was clicked and nothing at all happened. */
  for (const s of path) if (s.effect === 'none') signals.push({ kind: 'deadClick', screen: s.from, control: s.key, action: s.action });
  path = path.filter((s) => s.effect !== 'none');

  /* Peeks: a menu opened and closed with nothing chosen from it. */
  const unpeeked: ClassifiedStep[] = [];
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    const next = path[i + 1];
    if (s.effect === 'open' && next && next.effect === 'close' && next.from === s.to) {
      signals.push({ kind: 'peek', screen: s.from, control: s.key, action: s.action });
      i++;
      continue;
    }
    unpeeked.push(s);
  }
  path = unpeeked;

  /* Loops: the same screen reached again and again in one attempt. Counted before
     detours are removed, since removing them is what would hide it. */
  const visits = new Map<string, number>();
  if (path.length) visits.set(path[0].from, 1);
  for (const s of path) if (s.effect === 'navigate') visits.set(s.to, (visits.get(s.to) ?? 0) + 1);
  for (const [screen, n] of visits) if (n >= loopVisits) signals.push({ kind: 'loop', screen, control: null, action: null });

  /* Detours: arriving back at a screen already visited in this attempt means the
     steps in between went somewhere and came back. They are cut, and the screen
     the person wandered into is recorded as a wrong turn. Repeated until no screen
     is revisited, so nested detours unwind fully. */
  for (let guard = 0; guard < 50; guard++) {
    const firstAt = new Map<string, number>();
    if (path.length) firstAt.set(path[0].from, -1);
    let cut: [number, number] | null = null;
    for (let i = 0; i < path.length; i++) {
      const s = path[i];
      if (s.effect !== 'navigate') continue;
      const seen = firstAt.get(s.to);
      if (seen !== undefined) {
        cut = [seen + 1, i];
        break;
      }
      firstAt.set(s.to, i);
    }
    if (!cut) break;
    const [from, to] = cut;
    const detour = path.slice(from, to + 1);
    const wrongTurn = detour.find((d) => d.effect === 'navigate');
    if (wrongTurn) signals.push({ kind: 'backtrack', screen: wrongTurn.to, control: wrongTurn.key, action: wrongTurn.action });
    path = [...path.slice(0, from), ...path.slice(to + 1)];
  }

  return { clean: path, signals };
}

function kindOf(clean: ClassifiedStep[], signals: Signal[]): Attempt['kind'] {
  if (clean.some((s) => s.effect === 'mutate')) return 'effect';
  const struggled = signals.some((s) => s.kind !== 'undo');
  if (!struggled && clean.filter((s) => s.effect === 'navigate').length >= 2) return 'destination';
  return 'browse';
}

/* ---------- attempts into routes ---------- */

function hash(x: unknown): string {
  return createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);
}

export function buildAttempts(steps: Step[], opts: MineOptions = {}): Attempt[] {
  const o = { ...DEFAULTS, ...opts };
  const classified: ClassifiedStep[] = steps.map((s) => ({ ...s, effect: classifyEffect(s), key: actionKey(s.action) }));
  const byEpisode = new Map<string, ClassifiedStep[]>();
  for (const s of classified) {
    const k = `${s.install}\u0000${s.episode}`;
    if (!byEpisode.has(k)) byEpisode.set(k, []);
    byEpisode.get(k)!.push(s);
  }
  const attempts: Attempt[] = [];
  for (const [, epSteps] of [...byEpisode.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const raw of segment(epSteps, o)) {
      const { clean, signals } = normalize(raw, o.loopVisits);
      const kind = kindOf(clean, signals);
      if (kind === 'browse' && signals.some((s) => s.kind !== 'undo')) {
        const last = raw[raw.length - 1];
        signals.push({ kind: 'abandon', screen: last.to, control: null, action: null });
      }
      attempts.push({ install: raw[0].install, episode: raw[0].episode, steps: raw, clean, signals, kind });
    }
  }
  return attempts;
}

export function mineRoutes(attempts: Attempt[], opts: MineOptions = {}): RouteCandidate[] {
  const o = { ...DEFAULTS, ...opts };
  type Group = {
    kind: 'effect' | 'destination';
    goal: { screen: string; actions: string[] };
    goalActions: StoredAction[];
    variants: Map<string, { path: RouteCandidate['path']; end: string; attempts: number; start: string }>;
    installs: Set<string>;
    attempts: number;
    firstSeen: number;
    lastSeen: number;
  };
  const groups = new Map<string, Group>();

  for (const a of attempts) {
    if (a.kind === 'browse' || !a.clean.length) continue;
    const mutates = a.clean.filter((s) => s.effect === 'mutate');
    const end = a.clean[a.clean.length - 1].to;
    const goal =
      a.kind === 'effect'
        ? { screen: mutates[mutates.length - 1].from, actions: [...new Set(mutates.map((m) => m.key))].sort() }
        : { screen: end, actions: [] };
    const gid = hash({ kind: a.kind, goal });
    const path = a.clean.map((s) => ({ screen: s.from, key: s.key, action: s.action, effect: s.effect }));
    const ph = hash(path.map((p) => [p.screen, p.key]));

    const g =
      groups.get(gid) ??
      ({
        kind: a.kind,
        goal,
        goalActions: mutates.map((m) => m.action),
        variants: new Map(),
        installs: new Set<string>(),
        attempts: 0,
        firstSeen: Infinity,
        lastSeen: 0,
      } as Group);
    const v = g.variants.get(ph) ?? { path, end, attempts: 0, start: path[0].screen };
    v.attempts++;
    g.variants.set(ph, v);
    g.attempts++;
    g.installs.add(a.install);
    g.firstSeen = Math.min(g.firstSeen, a.steps[0].at);
    g.lastSeen = Math.max(g.lastSeen, a.steps[a.steps.length - 1].at);
    groups.set(gid, g);
  }

  const routes: RouteCandidate[] = [];
  for (const [gid, g] of groups) {
    /* The canonical path is the one most people took; ties go to the shorter, then
       to a stable order, so the same evidence always yields the same route. */
    const ranked = [...g.variants.entries()].sort(
      ([ha, a], [hb, b]) => b.attempts - a.attempts || a.path.length - b.path.length || (ha < hb ? -1 : 1)
    );
    const [canonHash, canon] = ranked[0];
    const screens = new Set([...canon.path.map((p) => p.screen), canon.end]);
    const ambiguous = [...screens].filter((sc) => o.ambiguousScreens?.has(sc));

    let status: RouteCandidate['status'] = 'candidate';
    let blockedReason: string | null = null;
    if (ambiguous.length) {
      status = 'blocked';
      blockedReason = `passes through a screen that cannot be told apart from others (${ambiguous.join(', ')})`;
    } else if (g.attempts < o.minSupport) {
      status = 'blocked';
      blockedReason = `seen ${g.attempts} time${g.attempts === 1 ? '' : 's'}, needs ${o.minSupport}`;
    }

    routes.push({
      id: `r_${gid}`,
      kind: g.kind,
      goal: g.goal,
      goalActions: g.goalActions,
      path: canon.path,
      endScreen: canon.end,
      pathHash: canonHash,
      variants: ranked.map(([h, v]) => ({ pathHash: h, attempts: v.attempts, start: v.start, length: v.path.length })),
      attempts: g.attempts,
      installs: g.installs.size,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      status,
      blockedReason,
    });
  }
  return routes.sort((a, b) => b.attempts - a.attempts || (a.id < b.id ? -1 : 1));
}

export function aggregateStruggles(attempts: Attempt[]): StrugglePoint[] {
  const agg = new Map<string, { p: StrugglePoint; attempts: Set<Attempt>; installs: Set<string> }>();
  for (const a of attempts) {
    for (const s of a.signals) {
      const k = `${s.screen}\u0000${s.kind}\u0000${s.control ?? ''}`;
      const e = agg.get(k) ?? { p: { screen: s.screen, kind: s.kind, control: s.control, action: s.action, attempts: 0, installs: 0 }, attempts: new Set(), installs: new Set() };
      e.attempts.add(a);
      e.installs.add(a.install);
      agg.set(k, e);
    }
  }
  return [...agg.values()]
    .map((e) => ({ ...e.p, attempts: e.attempts.size, installs: e.installs.size }))
    .sort((a, b) => b.attempts - a.attempts || (a.screen + a.kind < b.screen + b.kind ? -1 : 1));
}
