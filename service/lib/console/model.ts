import type { DatabaseSync } from 'node:sqlite';
import { verificationPreview } from '../onboard.ts';
import { docsCoverage, type DocsHit } from './docs.ts';
import { comparisonsFor, type ComparisonSummary } from './evaluations.ts';
import { routeHistory, type HistoryItem } from './history.ts';
import { layoutMap } from './layout.ts';
import { counts, needsAttention, setupSteps, type Attention, type Counts, type SetupStep } from './setup.ts';
import { readableSteps, routeScreens, type PathAction, type PathStep, type ReadableStep } from './steps.ts';
import { listStruggles } from './struggles.ts';
import { thumbFor, type ThumbKind } from './thumbs.ts';

/* Everything the map draws, read from stored rows and laid out once on the server.
 * The client only toggles layers and selects: it never computes a number. */

export type MapNode = {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  thumb: ThumbKind;
  controls: number;
  seen: number;
  people: number;
  exploredOnly: boolean;
  docs: DocsHit[];
  struggles: Array<{ id: string; kind: string; chip: string; title: string; people: number }>;
  signals: number;
};
export type MapLink = {
  from: string;
  to: string;
  people: number;
  explored: boolean;
  used: boolean;
  back: boolean;
  d: string;
  label: { x: number; y: number };
};
export type MapRoute = {
  id: string;
  name: string;
  label: string | null;
  kind: string;
  status: string;
  reason: string | null;
  people: number;
  attempts: number;
  screens: string[];
  steps: ReadableStep[];
  compareFile: string | null;
  history: HistoryItem[];
};
export type MapModel = {
  product: { id: string; origin: string; tool: string };
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  nodes: MapNode[];
  links: MapLink[];
  routes: MapRoute[];
  counts: Counts;
  attention: Attention[];
  setup: SetupStep[];
  latest: ComparisonSummary | null;
  verifyCalls: number;
};

const ROUTE_ORDER: Record<string, number> = { held: 0, candidate: 1, verified: 2, demoted: 3, rejected: 4, gap: 5, stale: 6, blocked: 7 };

export function pathOf(pattern: string): string {
  try {
    const u = new URL(pattern);
    return u.pathname + (u.hash.startsWith('#/') ? u.hash : '');
  } catch {
    return pattern;
  }
}

function routeName(r: { title: string | null; label: string | null; goal_actions_json: string; end_screen: string }, screenName: (id: string) => string): string {
  if (r.title) return r.title;
  if (r.label) return r.label;
  const actions = JSON.parse(r.goal_actions_json) as PathAction[];
  const steps = readableSteps(actions.map((a) => ({ screen: r.end_screen, action: a, effect: a.type === 'click' ? 'mutate' : undefined })));
  return steps.length ? `${steps.map((s) => s.text).join(', ')} (unnamed)` : `Go to ${screenName(r.end_screen)} (unnamed)`;
}

export function loadMap(db: DatabaseSync, productId: string, base: string): MapModel | null {
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(productId) as MapModel['product'] | undefined;
  if (!product) return null;

  const screens = db
    .prepare('SELECT id, display_name, url_pattern, count, core_keys_json FROM screens WHERE product_id = ? ORDER BY id')
    .all(productId) as Array<{ id: string; display_name: string; url_pattern: string; count: number; core_keys_json: string }>;
  const names = new Map(screens.map((s) => [s.id, s.display_name]));
  const screenName = (id: string) => names.get(id) ?? id;

  /* People, not events: distinct browsers, from real use only (G6). */
  const peopleOn = new Map(
    (
      db
        .prepare(
          `SELECT m.screen_id AS id, COUNT(DISTINCT t.install_id) AS n
             FROM transitions t JOIN screen_members m ON m.obs_hash = t.before_hash OR m.obs_hash = t.after_hash
            WHERE t.product_id = ? AND t.source = 'user' GROUP BY m.screen_id`
        )
        .all(productId) as Array<{ id: string; n: number }>
    ).map((r) => [r.id, r.n])
  );
  const used = db
    .prepare(
      `SELECT bm.screen_id AS a, am.screen_id AS b, COUNT(DISTINCT t.install_id) AS n
         FROM transitions t
         JOIN screen_members bm ON bm.obs_hash = t.before_hash
         JOIN screen_members am ON am.obs_hash = t.after_hash
        WHERE t.product_id = ? AND t.source = 'user' AND bm.screen_id <> am.screen_id
        GROUP BY bm.screen_id, am.screen_id`
    )
    .all(productId) as Array<{ a: string; b: string; n: number }>;
  /* Links exploration followed: from the page it came from to the page it opened. */
  const explored = db
    .prepare(
      `SELECT DISTINCT fm.screen_id AS a, pm.screen_id AS b
         FROM explore_pages p
         JOIN explore_pages f ON f.run_id = p.run_id AND f.url = p.from_url
         JOIN screen_members pm ON pm.obs_hash = p.obs_hash
         JOIN screen_members fm ON fm.obs_hash = f.obs_hash
        WHERE p.product_id = ? AND fm.screen_id <> pm.screen_id`
    )
    .all(productId) as Array<{ a: string; b: string }>;
  const usedScreens = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT m.screen_id AS id FROM screen_members m
             JOIN transitions t ON t.before_hash = m.obs_hash OR t.after_hash = m.obs_hash
            WHERE m.product_id = ?`
        )
        .all(productId) as Array<{ id: string }>
    ).map((r) => r.id)
  );

  /* Where people start: the screen most episodes begin on; failing that, where
     exploration began. */
  const start =
    (
      db
        .prepare(
          `SELECT m.screen_id AS id, COUNT(*) AS n FROM transitions t
             JOIN screen_members m ON m.obs_hash = t.before_hash
            WHERE t.product_id = ? AND t.seq = (SELECT MIN(seq) FROM transitions u WHERE u.install_id = t.install_id AND u.episode = t.episode)
            GROUP BY m.screen_id ORDER BY n DESC, m.screen_id LIMIT 1`
        )
        .get(productId) as { id: string } | undefined
    )?.id ??
    (
      db
        .prepare(
          `SELECT m.screen_id AS id FROM explore_pages p JOIN screen_members m ON m.obs_hash = p.obs_hash
            WHERE p.product_id = ? AND p.from_url IS NULL ORDER BY p.at LIMIT 1`
        )
        .get(productId) as { id: string } | undefined
    )?.id;

  const linkKey = (a: string, b: string) => `${a}\u0000${b}`;
  const usedBy = new Map(used.map((u) => [linkKey(u.a, u.b), u.n]));
  const exploredSet = new Set(explored.map((e) => linkKey(e.a, e.b)));
  const layout = layoutMap(
    screens.map((s) => ({ id: s.id, weight: s.count })),
    [...used.map((u) => ({ from: u.a, to: u.b, weight: u.n })), ...explored.filter((e) => !usedBy.has(linkKey(e.a, e.b))).map((e) => ({ from: e.a, to: e.b, weight: 0.5 }))],
    { entries: start ? [start] : [] }
  );

  const struggles = listStruggles(db, productId, screenName);
  const docs = docsCoverage(product.tool, screens.map((s) => ({ id: s.id, name: s.display_name })));
  const placed = new Map(layout.nodes.map((n) => [n.id, n]));
  const nodes: MapNode[] = screens.map((s) => {
    const p = placed.get(s.id)!;
    const t = thumbFor(JSON.parse(s.core_keys_json) as string[]);
    const mine = struggles.filter((x) => x.screen_id === s.id);
    return {
      id: s.id,
      name: s.display_name,
      path: pathOf(s.url_pattern),
      x: p.x,
      y: p.y,
      thumb: t.kind,
      controls: t.controls,
      seen: s.count,
      people: peopleOn.get(s.id) ?? 0,
      exploredOnly: !usedScreens.has(s.id),
      docs: docs.get(s.id) ?? [],
      struggles: mine.map((x) => ({ id: x.id, kind: x.kind, chip: x.chip, title: x.title, people: x.installs })),
      signals: mine.reduce((sum, x) => sum + x.installs, 0),
    };
  });
  const links: MapLink[] = layout.links.map((l) => ({
    from: l.from,
    to: l.to,
    people: usedBy.get(linkKey(l.from, l.to)) ?? 0,
    explored: exploredSet.has(linkKey(l.from, l.to)),
    used: usedBy.has(linkKey(l.from, l.to)),
    back: l.back,
    d: l.d,
    label: l.label,
  }));

  const comparisons = comparisonsFor(db, productId, product.origin);
  const latest = comparisons[0] ?? null;
  const routeRows = db
    .prepare(
      'SELECT id, kind, status, status_reason, label, title, installs, attempts, path_json, end_screen, goal_actions_json FROM routes WHERE product_id = ?'
    )
    .all(productId) as Array<{
    id: string; kind: string; status: string; status_reason: string | null; label: string | null; title: string | null; installs: number; attempts: number;
    path_json: string; end_screen: string; goal_actions_json: string;
  }>;
  const routes: MapRoute[] = routeRows
    .map((r) => {
      const path = JSON.parse(r.path_json) as PathStep[];
      return {
        id: r.id,
        name: routeName(r, screenName),
        label: r.label,
        kind: r.kind,
        status: r.status,
        reason: r.status_reason,
        people: r.installs,
        attempts: r.attempts,
        screens: routeScreens(path, r.end_screen).filter((id) => names.has(id)),
        steps: readableSteps(path),
        /* The comparison that shows most about this route: the newest one that found
           it made planning worse, else the newest it was offered in at all. */
        compareFile:
          (comparisons.find((c) => c.verdict.implicated.includes(r.id)) ?? comparisons.find((c) => c.verdict.tested.includes(r.id)))?.file ?? null,
        history: routeHistory(db, r.id),
      };
    })
    .sort((a, b) => (ROUTE_ORDER[a.status] ?? 9) - (ROUTE_ORDER[b.status] ?? 9) || b.people - a.people || (a.id < b.id ? -1 : 1));

  const c = counts(db, productId);
  const verifyCalls = verificationPreview(db, productId, product.tool).calls;
  return {
    product,
    width: layout.width,
    height: layout.height,
    nodeW: layout.nodeW,
    nodeH: layout.nodeH,
    nodes,
    links,
    routes,
    counts: c,
    attention: needsAttention(base, c, product.tool, latest, verifyCalls),
    setup: setupSteps(base, c, product.tool, latest, verifyCalls),
    latest,
    verifyCalls,
  };
}

/* Setup and attention without the whole map, for pages that only need those. */
export function productState(db: DatabaseSync, productId: string, base: string) {
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(productId) as MapModel['product'] | undefined;
  if (!product) return null;
  const c = counts(db, productId);
  const latest = comparisonsFor(db, productId, product.origin)[0] ?? null;
  const verifyCalls = verificationPreview(db, productId, product.tool).calls;
  return {
    product,
    counts: c,
    latest,
    verifyCalls,
    setup: setupSteps(base, c, product.tool, latest, verifyCalls),
    attention: needsAttention(base, c, product.tool, latest, verifyCalls),
  };
}
