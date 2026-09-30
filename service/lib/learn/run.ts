import type { DatabaseSync } from 'node:sqlite';
import { clusterScreens, scoreScreens, type ObsRecord, type Score, type StoredObs } from './screens.ts';
import { buildGraph, type StoredAction, type TransitionRow } from './graph.ts';
import { assignIds } from './ids.ts';
import { aggregateStruggles, buildAttempts, mineRoutes, type RouteCandidate, type Step } from './mine.ts';
import { DECISION_STRUGGLE } from '../decisions.ts';
import { recordRouteEvent } from './events.ts';

/* One learning run for one product: cluster every observation into screens, carry
   screen ids over from the previous run, rebuild the graph, score against ground
   truth where it exists, and write it all in a single transaction. Re-running with
   no new data changes nothing, and a failure part-way leaves the last good run in
   place rather than a half-written one. */

export type RunSummary = {
  productId: string;
  observations: number;
  transitions: number;
  screens: number;
  ambiguous: number;
  edges: number;
  unplaced: number;
  idsKept: number;
  idsNew: number;
  score: Score | null;
  truthLabelled: number;
  humanAttempts: number;
  /* Transitions older than the decay window: kept, but no longer evidence for edges or
     routes. A product ships, and what people did before it no longer shows the path. */
  decayed: number;
  windowDays: number;
  /* Phase G: observations known only from exploration (no transition refers to them),
     and screens made only of those. Seen to exist; never used by anyone yet. */
  exploredOnly: number;
  screensExploredOnly: number;
  routes: { candidate: number; blocked: number; verified: number; rejected: number; gap: number; demoted: number; held: number; stale: number };
  struggles: number;
  /* Phase L: copilot decisions inside the window, and how many could be placed on a
     screen. An unplaced one is kept but not shown: guessing its screen would be worse. */
  copilotDecisions: number;
  copilotUnplaced: number;
};

/* Carrying a route's status across runs. Mining only ever says candidate or blocked;
   verification (Phase D) is the only thing that can say verified or rejected. Three
   rules keep a verification from outliving what it verified:
     - blocked by mining always wins: lost evidence or an ambiguous screen means the
       route is not trusted, whatever happened before;
     - verified, rejected, gap, demoted or held survives only while the canonical path is
       the one that was checked; any change sends it back to candidate, so a new path
       is always checked afresh and a settled one is never paid for twice. For a
       demoted route this is what prevents a loop: re-verifying the same path would
       only promote it again to fail again, so it waits for behaviour to change;
     - a route mining no longer produces is kept as stale, not deleted, so the history
       of what was learned is not lost. */
export function nextStatus(
  mined: Pick<RouteCandidate, 'status' | 'blockedReason' | 'pathHash'>,
  prior: { status: string; verified_path_hash: string | null } | undefined
): { status: string; reason: string | null; verifiedPathHash: string | null } {
  if (mined.status === 'blocked') return { status: 'blocked', reason: mined.blockedReason, verifiedPathHash: null };
  if (prior && ['verified', 'rejected', 'gap', 'demoted', 'held'].includes(prior.status)) {
    if (prior.verified_path_hash === mined.pathHash) return { status: prior.status, reason: null, verifiedPathHash: prior.verified_path_hash };
    return { status: 'candidate', reason: 'the path people take has changed since it was checked', verifiedPathHash: null };
  }
  return { status: 'candidate', reason: null, verifiedPathHash: null };
}

export const DEFAULT_WINDOW_DAYS = Number(process.env.COPILOT_DECAY_DAYS ?? 90);

export function runLearning(db: DatabaseSync, productId: string, opts: { threshold?: number; windowDays?: number; now?: number } = {}): RunSummary {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const cutoff = (opts.now ?? Date.now()) - windowDays * 86_400_000;
  const obsRows = db
    .prepare(
      `SELECT o.hash, o.json,
              (SELECT COUNT(*) FROM transitions t WHERE t.before_hash = o.hash OR t.after_hash = o.hash) AS refs
         FROM observations o WHERE o.product_id = ?`
    )
    .all(productId) as Array<{ hash: string; json: string; refs: number }>;
  const records: ObsRecord[] = obsRows.map((r) => ({ hash: r.hash, obs: JSON.parse(r.json) as StoredObs, count: Math.max(1, r.refs) }));

  const screens = clusterScreens(records, { threshold: opts.threshold });

  const prior = new Map<string, Set<string>>();
  for (const row of db.prepare('SELECT screen_id, obs_hash FROM screen_members WHERE product_id = ?').all(productId) as Array<{ screen_id: string; obs_hash: string }>) {
    if (!prior.has(row.screen_id)) prior.set(row.screen_id, new Set());
    prior.get(row.screen_id)!.add(row.obs_hash);
  }
  const ids = assignIds(screens, prior);

  const screenOf = new Map<string, string>();
  for (const s of screens) for (const m of s.members) screenOf.set(m, ids.get(s.key)!);

  const trRows = db
    .prepare(
      'SELECT install_id, episode, seq, before_hash, after_hash, source, at, action_json FROM transitions WHERE product_id = ? ORDER BY at'
    )
    .all(productId) as Array<{
      install_id: string; episode: string; seq: number; before_hash: string; after_hash: string;
      source: 'user' | 'copilot'; at: number; action_json: string;
    }>;
  /* Decay. Old transitions stay stored (and their screens stay known), but only those
     inside the window are evidence. A route nobody has taken within it stops being
     produced and is marked stale by the step below, so it is no longer offered. */
  const recentRows = trRows.filter((r) => r.at >= cutoff);
  const decayed = trRows.length - recentRows.length;
  const transitions: TransitionRow[] = recentRows.map((r) => ({
    beforeHash: r.before_hash, afterHash: r.after_hash, source: r.source, at: r.at, action: JSON.parse(r.action_json) as StoredAction,
  }));
  const { edges, unplaced } = buildGraph(transitions, screenOf);

  /* Mining. Steps whose screens could not be placed are left out rather than
     guessed at, and are already counted in `unplaced`. */
  const obsByHash = new Map(records.map((r) => [r.hash, r.obs]));
  const steps: Step[] = [];
  recentRows.forEach((r, i) => {
    const from = screenOf.get(r.before_hash);
    const to = screenOf.get(r.after_hash);
    const before = obsByHash.get(r.before_hash);
    const after = obsByHash.get(r.after_hash);
    if (!from || !to || !before || !after) return;
    steps.push({ at: r.at, source: r.source, install: r.install_id, episode: r.episode, seq: r.seq, from, to, action: transitions[i].action, before, after });
  });
  const ambiguousScreens = new Set(screens.filter((s) => s.ambiguous).map((s) => ids.get(s.key)!));
  const attempts = buildAttempts(steps);
  const mined = mineRoutes(attempts, { ambiguousScreens });
  const struggles = aggregateStruggles(attempts);

  /* Phase L. The copilot's own mistakes, as struggle points. A decision carries the
     page's normalised URL and heading, and is placed on the screen whose observations
     most often have that URL and heading: how a person would recognise the page. */
  const pages = new Map<string, Map<string, number>>();
  for (const r of records) {
    const id = screenOf.get(r.hash);
    if (!id) continue;
    const key = `${r.obs.url ?? ''}|${r.obs.heading?.hash ?? ''}`;
    if (!pages.has(key)) pages.set(key, new Map());
    const m = pages.get(key)!;
    m.set(id, (m.get(id) ?? 0) + r.count);
  }
  const screenForPage = (url: string | null, heading: string | undefined) => {
    const m = pages.get(`${url ?? ''}|${heading ?? ''}`);
    if (!m) return null;
    return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  };
  const decisionRows = db
    .prepare('SELECT install_id, kind, url, heading_json, planned_json, action_json FROM decisions WHERE product_id = ? AND at >= ?')
    .all(productId, cutoff) as Array<{ install_id: string; kind: string; url: string | null; heading_json: string | null; planned_json: string | null; action_json: string | null }>;
  const copilotStruggles = new Map<string, { screen: string; kind: string; control: string; action: unknown; attempts: number; installs: Set<string> }>();
  let copilotUnplaced = 0;
  for (const d of decisionRows) {
    const kind = DECISION_STRUGGLE[d.kind];
    if (!kind) continue;
    const heading = d.heading_json ? (JSON.parse(d.heading_json) as { hash?: string } | null) : null;
    const screen = screenForPage(d.url, heading?.hash);
    if (!screen) {
      copilotUnplaced++;
      continue;
    }
    const planned = d.planned_json ? (JSON.parse(d.planned_json) as { role: string | null; name: { hash: string; text?: string } | null } | null) : null;
    const action = d.action_json ? (JSON.parse(d.action_json) as { type: string; value?: boolean }) : { type: 'click' };
    const control = planned?.name?.hash ?? '';
    const key = `${screen}|${kind}|${control}`;
    const entry = copilotStruggles.get(key) ?? { screen, kind, control, action: { ...action, target: { role: planned?.role ?? null, name: planned?.name ?? null } }, attempts: 0, installs: new Set<string>() };
    entry.attempts++;
    entry.installs.add(d.install_id);
    copilotStruggles.set(key, entry);
  }
  const priorRoutes = new Map(
    (db.prepare('SELECT id, status, verified_path_hash FROM routes WHERE product_id = ?').all(productId) as Array<{ id: string; status: string; verified_path_hash: string | null }>).map((x) => [x.id, x])
  );

  /* Ground truth, if the fixture supplied any. Joined through transitions, never
     through observations, so clustering could not have seen it. */
  const truth = new Map<string, Set<string>>();
  const truthRows = db
    .prepare(
      `SELECT t.before_hash, t.after_hash, d.before_screen, d.after_screen
         FROM dev_truth d JOIN transitions t
           ON t.install_id = d.install_id AND t.episode = d.episode AND t.seq = d.seq
        WHERE d.product_id = ?`
    )
    .all(productId) as Array<{ before_hash: string; after_hash: string; before_screen: string | null; after_screen: string | null }>;
  const addTruth = (h: string, t: string | null) => {
    if (!t) return;
    if (!truth.has(h)) truth.set(h, new Set());
    truth.get(h)!.add(t);
  };
  for (const r of truthRows) {
    addTruth(r.before_hash, r.before_screen);
    addTruth(r.after_hash, r.after_screen);
  }
  /* Explored pages carry their own, stored only for local products. */
  const exploreTruth = db
    .prepare('SELECT obs_hash, truth FROM explore_pages WHERE product_id = ? AND truth IS NOT NULL')
    .all(productId) as Array<{ obs_hash: string; truth: string }>;
  for (const r of exploreTruth) addTruth(r.obs_hash, r.truth);
  const score = truth.size ? scoreScreens(screens, truth) : null;

  const unused = new Set(obsRows.filter((r) => r.refs === 0).map((r) => r.hash));
  const now = Date.now();
  const kept = [...ids.values()].filter((id) => prior.has(id)).length;
  const summary: RunSummary = {
    productId,
    observations: records.length,
    transitions: transitions.length,
    screens: screens.length,
    ambiguous: screens.filter((s) => s.ambiguous).length,
    edges: edges.length,
    unplaced,
    idsKept: kept,
    idsNew: screens.length - kept,
    score,
    truthLabelled: truth.size,
    humanAttempts: attempts.length,
    decayed,
    windowDays,
    exploredOnly: obsRows.filter((r) => r.refs === 0).length,
    screensExploredOnly: screens.filter((s) => s.members.every((m) => unused.has(m))).length,
    routes: { candidate: 0, blocked: 0, verified: 0, rejected: 0, gap: 0, demoted: 0, held: 0, stale: 0 },
    struggles: struggles.length + copilotStruggles.size,
    copilotDecisions: decisionRows.length,
    copilotUnplaced,
  };

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM edges WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM screen_members WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM screens WHERE product_id = ?').run(productId);
    const insScreen = db.prepare(
      `INSERT INTO screens (id, product_id, display_name, url_pattern, count, informative_weight, ambiguous, core_keys_json, distinctive_keys_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insMember = db.prepare('INSERT INTO screen_members (obs_hash, screen_id, product_id) VALUES (?, ?, ?)');
    for (const s of screens) {
      const id = ids.get(s.key)!;
      insScreen.run(id, productId, s.displayName, s.urlPattern, s.count, s.informativeWeight, s.ambiguous ? 1 : 0, JSON.stringify(s.coreKeys), JSON.stringify(s.distinctiveKeys), now);
      for (const m of s.members) insMember.run(m, id, productId);
    }
    const insEdge = db.prepare(
      `INSERT INTO edges (product_id, from_screen, action_key, to_screen, action_json, users, copilot, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of edges) insEdge.run(productId, e.from, e.actionKey, e.to, JSON.stringify(e.action), e.users, e.copilot, e.firstSeen, e.lastSeen);
    const upsertRoute = db.prepare(
      `INSERT INTO routes (id, product_id, kind, goal_json, goal_actions_json, path_json, path_hash, end_screen, variants_json,
                           attempts, installs, status, status_reason, verified_path_hash, first_seen, last_seen, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, goal_json = excluded.goal_json, goal_actions_json = excluded.goal_actions_json,
         path_json = excluded.path_json, path_hash = excluded.path_hash, end_screen = excluded.end_screen,
         variants_json = excluded.variants_json, attempts = excluded.attempts, installs = excluded.installs,
         status = excluded.status, status_reason = excluded.status_reason, verified_path_hash = excluded.verified_path_hash,
         first_seen = excluded.first_seen, last_seen = excluded.last_seen, updated_at = excluded.updated_at`
    );
    const seen = new Set<string>();
    for (const m of mined) {
      const prior = priorRoutes.get(m.id);
      const next = nextStatus(m, prior);
      seen.add(m.id);
      summary.routes[next.status as keyof RunSummary['routes']]++;
      upsertRoute.run(
        m.id, productId, m.kind, JSON.stringify(m.goal), JSON.stringify(m.goalActions), JSON.stringify(m.path), m.pathHash, m.endScreen,
        JSON.stringify(m.variants), m.attempts, m.installs, next.status, next.reason, next.verifiedPathHash, m.firstSeen, m.lastSeen, now
      );
      if (!prior) {
        recordRouteEvent(db, { productId, routeId: m.id, kind: 'mined', at: now, detail: `${m.installs} ${m.installs === 1 ? 'person' : 'people'}, ${m.attempts} ${m.attempts === 1 ? 'attempt' : 'attempts'}${next.status === 'blocked' && next.reason ? `; ${next.reason}` : ''}` });
      } else if (prior.status !== next.status) {
        recordRouteEvent(db, { productId, routeId: m.id, kind: 'status', at: now, detail: `${prior.status} to ${next.status}${next.reason ? `: ${next.reason}` : ''}` });
      }
    }
    const markStale = db.prepare("UPDATE routes SET status = 'stale', status_reason = ?, updated_at = ? WHERE id = ?");
    for (const [id, prior] of priorRoutes) {
      if (seen.has(id) || prior.status === 'stale') continue;
      const reason = decayed ? `no longer produced by mining (evidence older than ${windowDays} days no longer counts)` : 'no longer produced by mining';
      markStale.run(reason, now, id);
      recordRouteEvent(db, { productId, routeId: id, kind: 'stale', at: now, detail: reason });
      summary.routes.stale++;
    }

    db.prepare('DELETE FROM struggles WHERE product_id = ?').run(productId);
    const insStruggle = db.prepare(
      'INSERT INTO struggles (product_id, screen_id, kind, control, action_json, attempts, installs) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const x of struggles) insStruggle.run(productId, x.screen, x.kind, x.control ?? '', x.action ? JSON.stringify(x.action) : null, x.attempts, x.installs);
    for (const x of copilotStruggles.values()) insStruggle.run(productId, x.screen, x.kind, x.control, JSON.stringify(x.action), x.attempts, x.installs.size);

    db.prepare('INSERT INTO learn_runs (product_id, at, summary_json) VALUES (?, ?, ?)').run(productId, now, JSON.stringify(summary));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return summary;
}
