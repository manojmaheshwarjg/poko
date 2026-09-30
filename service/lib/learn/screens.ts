/* Screen identity: which observations are the same screen.
 *
 * Everything learned later sits on this. Two error types, deliberately not treated
 * as equals:
 *
 *   a MERGE (two different screens treated as one) corrupts every route through
 *   them, because a step learned on one gets replayed on the other;
 *
 *   a SPLIT (one screen treated as two) only reduces sharing: a route learned on
 *   one half does not transfer to the other.
 *
 * So wherever the algorithm has to choose, it chooses the split. And a screen it
 * cannot tell apart from others is flagged `ambiguous` rather than trusted.
 *
 * Operates on stored, redacted observations and uses label hashes only, never clear
 * text, so it behaves identically in vendor and customer mode.
 */

export type Label = { hash: string; text?: string } | null | undefined;
export type StoredNode = {
  role: string;
  name: Label;
  within?: Label;
  region?: 'chrome' | 'content';
  state?: Record<string, boolean>;
};
export type StoredObs = { url: string | null; title: Label; heading: Label; nodes: StoredNode[]; truncated?: boolean };
export type ObsRecord = { hash: string; obs: StoredObs; count: number };

export type ClusterOptions = {
  threshold?: number;
  globalShare?: number;
};

export type Screen = {
  key: string;
  members: string[];
  count: number;
  urlPattern: string;
  displayName: string;
  coreKeys: string[];
  /* Core keys that are neither global chrome nor transient: what makes this screen
     THIS screen. The browser checks a live page against these before acting on a
     learned step (G8). The full core set would not do: a nav rail present on every
     screen would "confirm" any of them. */
  distinctiveKeys: string[];
  informativeWeight: number;
  ambiguous: boolean;
};

const DEFAULT_THRESHOLD = 0.5;

/* Roles that identify a screen. Containers and list items are structure; their
   names echo their children and would double count. */
export const IDENTIFYING_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
  'option', 'combobox', 'textbox', 'heading',
]);

/* Base weights. The main heading is the strongest single signal when a page has
   one, because two screens rarely share it. A content-region label is worth less
   than chrome because it may be data. */
const W_MAIN_HEADING = 5;
const W_HEADING = 2;
const W_CHROME = 1;
const W_CONTENT = 0.5;
const W_TRANSIENT = 0.3;
const W_GLOBAL = 0.1;

/* Menu items and listbox options usually live in popups. They count toward
   identity, but lightly: a screen is its persistent page, not whichever menu
   happened to be open. Without this, on a page with no heading to anchor it, an
   open menu outweighed the page it sat on and split off as a screen of its own. */
export const TRANSIENT_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'option']);

type Kind = 'main' | 'heading' | 'chrome' | 'content' | 'transient';

/* One definition of "the same control", shared with mining so that a control
   means the same thing when clustering screens and when diffing them. */
export function nodeKey(n: StoredNode): string | null {
  if (!n.name?.hash) return null;
  return `${n.role}:${n.name.hash}@${n.within?.hash ?? ''}`;
}

function featureKeys(obs: StoredObs): Map<string, Kind> {
  const keys = new Map<string, Kind>();
  if (obs.heading?.hash) keys.set(`H:${obs.heading.hash}`, 'main');
  for (const n of obs.nodes) {
    if (!IDENTIFYING_ROLES.has(n.role) || !n.name?.hash) continue;
    /* The section is part of a control's identity: the same button under two
       headings is two controls (the lesson from the Groq console). */
    const key = `${n.role}:${n.name.hash}@${n.within?.hash ?? ''}`;
    if (keys.has(key)) continue;
    keys.set(
      key,
      n.role === 'heading' ? 'heading' : TRANSIENT_ROLES.has(n.role) ? 'transient' : n.region === 'content' ? 'content' : 'chrome'
    );
  }
  return keys;
}

function urlPattern(obs: StoredObs): string {
  return obs.url ?? '(no url)';
}

type Weigher = (key: string, kind: Kind) => number;

function weightedJaccard(a: Map<string, Kind>, b: Map<string, Kind>, weigh: Weigher): number {
  let inter = 0;
  let union = 0;
  for (const [k, kind] of a) {
    const w = weigh(k, kind);
    union += w;
    if (b.has(k)) inter += w;
  }
  for (const [k, kind] of b) if (!a.has(k)) union += weigh(k, kind);
  return union === 0 ? 0 : inter / union;
}

/* Average-linkage agglomerative clustering, run separately inside each URL pattern.
   Average rather than single linkage because single linkage chains: A resembles B,
   B resembles C, so A and C merge even when they share nothing. Chaining is how two
   distinct screens end up merged through a state that looks a bit like both.

   Different URL patterns are never merged. That can split one screen whose URL
   carries a slug the normaliser does not recognise as an id, and that is the
   intended trade: a split is the safe error. */
function agglomerate(items: ObsRecord[], feats: Map<string, Map<string, Kind>>, weigh: Weigher, threshold: number) {
  type Cluster = { members: ObsRecord[]; size: number };
  const clusters: (Cluster | null)[] = items.map((r) => ({ members: [r], size: r.count }));
  const n = clusters.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = weightedJaccard(feats.get(items[i].hash)!, feats.get(items[j].hash)!, weigh);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  for (;;) {
    let best = -1;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!clusters[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!clusters[j]) continue;
        /* Ties broken by index, so the result never depends on hash-map order. */
        if (sim[i][j] > best) {
          best = sim[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < threshold) break;

    const a = clusters[bi]!;
    const b = clusters[bj]!;
    /* Lance-Williams update for average linkage, weighted by how often each
       observation was actually seen. */
    for (let k = 0; k < n; k++) {
      if (k === bi || k === bj || !clusters[k]) continue;
      const s = (a.size * sim[bi][k] + b.size * sim[bj][k]) / (a.size + b.size);
      sim[bi][k] = s;
      sim[k][bi] = s;
    }
    clusters[bi] = { members: [...a.members, ...b.members], size: a.size + b.size };
    clusters[bj] = null;
  }
  return clusters.filter((c): c is Cluster => !!c).map((c) => c.members);
}

function baseWeight(kind: Kind): number {
  switch (kind) {
    case 'main': return W_MAIN_HEADING;
    case 'heading': return W_HEADING;
    case 'chrome': return W_CHROME;
    case 'content': return W_CONTENT;
    case 'transient': return W_TRANSIENT;
  }
}

export function clusterScreens(records: ObsRecord[], opts: ClusterOptions = {}): Screen[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const globalShare = opts.globalShare ?? 0.9;
  if (!records.length) return [];

  /* Deterministic input order: the same data always produces the same screens. */
  const items = [...records].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const feats = new Map(items.map((r) => [r.hash, featureKeys(r.obs)]));

  /* Document frequency over DISTINCT observations. A content label seen in only one
     observation is almost certainly data (a record's title, a row's value): it can
     only dilute similarity, never create it, so it carries no weight. */
  const df = new Map<string, number>();
  for (const f of feats.values()) for (const k of f.keys()) df.set(k, (df.get(k) ?? 0) + 1);

  const byUrl = new Map<string, ObsRecord[]>();
  for (const r of items) {
    const u = urlPattern(r.obs);
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u)!.push(r);
  }

  const globals = new Set<string>();
  const weigh: Weigher = (key, kind) => {
    if (kind === 'content' && (df.get(key) ?? 0) < 2) return 0;
    return baseWeight(kind) * (globals.has(key) ? W_GLOBAL : 1);
  };

  /* Global chrome (a nav rail on every screen) is found two ways, because each one
     alone has a blind spot. By share of observations: present in nearly all of
     them. By spread across a first-pass clustering: present in most screens. The
     second catches a rail even when one screen dominates the traffic. */
  const N = items.length;
  if (N >= 5) {
    for (const [k, count] of df) if (count >= globalShare * N) globals.add(k);
  }
  const firstPass: ObsRecord[][] = [];
  for (const group of byUrl.values()) firstPass.push(...agglomerate(group, feats, weigh, threshold));
  if (firstPass.length >= 3) {
    const spread = new Map<string, number>();
    for (const cluster of firstPass) {
      const present = new Set<string>();
      for (const r of cluster) for (const k of feats.get(r.hash)!.keys()) present.add(k);
      for (const k of present) spread.set(k, (spread.get(k) ?? 0) + 1);
    }
    for (const [k, c] of spread) if (c >= Math.max(3, 0.5 * firstPass.length)) globals.add(k);
  }

  const finalClusters: ObsRecord[][] = [];
  for (const group of byUrl.values()) finalClusters.push(...agglomerate(group, feats, weigh, threshold));

  return finalClusters.map((members) => describe(members, feats, weigh));
}

function describe(members: ObsRecord[], feats: Map<string, Map<string, Kind>>, weigh: Weigher): Screen {
  const total = members.reduce((s, r) => s + r.count, 0);
  const presence = new Map<string, { kind: Kind; seen: number }>();
  for (const r of members) {
    for (const [k, kind] of feats.get(r.hash)!) {
      const e = presence.get(k) ?? { kind, seen: 0 };
      e.seen += r.count;
      presence.set(k, e);
    }
  }
  const core = [...presence.entries()].filter(([, e]) => e.seen >= 0.5 * total);
  const coreKeys = core.map(([k]) => k).sort();

  /* How much of this screen's identity comes from things that are NOT global.
     A screen made only of global chrome cannot be told apart from another screen
     made only of global chrome: that is not a guess this should make silently. */
  const informativeWeight = core.reduce((s, [k, e]) => {
    const w = weigh(k, e.kind);
    return s + (w >= W_CONTENT ? w : 0);
  }, 0);

  const pick = (fn: (o: StoredObs) => string | undefined) => {
    for (const r of members) {
      const v = fn(r.obs);
      if (v) return v;
    }
    return undefined;
  };
  /* With no heading, name the screen after what is distinctive about it rather than
     its URL, since on a single-URL app every screen shares one. A coverage page
     listing six screens all called "/app" tells nobody anything. */
  /* Chrome controls first. Failing that, stable content labels: text stored in the
     clear has already passed redaction, so showing it on the coverage page reveals
     nothing new. That is what names a screen whose identity lives in a table. */
  const distinctive = () => {
    for (const minWeight of [W_CHROME, W_CONTENT]) {
      const texts: string[] = [];
      for (const [k, e] of core) {
        if (e.kind === 'transient' || weigh(k, e.kind) < minWeight) continue;
        const hash = k.split(':')[1]?.split('@')[0];
        const text = pick((o) => o.nodes.find((n) => n.name?.hash === hash)?.name?.text);
        if (text && !texts.includes(text)) texts.push(text);
        if (texts.length === 2) break;
      }
      if (texts.length) return texts.join(', ');
    }
    return undefined;
  };
  const path = pick((o) => (o.url ? new URL(o.url).pathname : undefined));
  const displayName =
    pick((o) => o.heading?.text) ??
    pick((o) => o.nodes.find((n) => n.role === 'heading' && n.name?.text)?.name?.text) ??
    distinctive() ??
    (path ? `${path} (nothing distinctive)` : 'unnamed screen');

  const distinctiveKeys = core
    .filter(([k, e]) => e.kind !== 'transient' && weigh(k, e.kind) >= W_CONTENT)
    .map(([k]) => k)
    .sort();
  const memberHashes = members.map((r) => r.hash).sort();
  return {
    key: memberHashes[0],
    members: memberHashes,
    count: total,
    urlPattern: urlPattern(members[0].obs),
    displayName,
    coreKeys,
    distinctiveKeys,
    informativeWeight,
    ambiguous: informativeWeight < 1,
  };
}

/* ---------- scoring against ground truth ---------- */

export type Score = {
  pairs: number;
  precision: number;
  recall: number;
  merges: Array<{ key: string; screen: string; ambiguous: boolean; truths: string[] }>;
  splits: Array<{ truth: string; screens: number }>;
  indistinguishable: string[];
};

/* Pairwise precision and recall over observation instances. Precision falls when
   screens are merged, recall when they are split. `truth` maps an observation hash
   to every ground-truth screen it was seen on: more than one means the redacted
   observations of two different screens were byte-identical, which no algorithm
   could separate and which is reported as its own finding. */
export function scoreScreens(screens: Screen[], truth: Map<string, Set<string>>): Score {
  const assigned = new Map<string, string>();
  for (const s of screens) for (const m of s.members) assigned.set(m, s.key);

  const indistinguishable = [...truth.entries()].filter(([, t]) => t.size > 1).map(([h]) => h);
  const labelled = [...truth.entries()]
    .filter(([h, t]) => t.size === 1 && assigned.has(h))
    .map(([h, t]) => ({ hash: h, truth: [...t][0], screen: assigned.get(h)! }));

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < labelled.length; i++) {
    for (let j = i + 1; j < labelled.length; j++) {
      const sameTruth = labelled[i].truth === labelled[j].truth;
      const sameScreen = labelled[i].screen === labelled[j].screen;
      if (sameTruth && sameScreen) tp++;
      else if (!sameTruth && sameScreen) fp++;
      else if (sameTruth && !sameScreen) fn++;
    }
  }

  const merges = screens
    .map((s) => ({
      key: s.key,
      screen: s.displayName,
      ambiguous: s.ambiguous,
      truths: [...new Set(labelled.filter((l) => l.screen === s.key).map((l) => l.truth))],
    }))
    .filter((m) => m.truths.length > 1);
  const splitCount = new Map<string, Set<string>>();
  for (const l of labelled) {
    if (!splitCount.has(l.truth)) splitCount.set(l.truth, new Set());
    splitCount.get(l.truth)!.add(l.screen);
  }
  const splits = [...splitCount.entries()].filter(([, s]) => s.size > 1).map(([t, s]) => ({ truth: t, screens: s.size }));

  return {
    pairs: tp + fp + fn,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    merges,
    splits,
    indistinguishable,
  };
}
