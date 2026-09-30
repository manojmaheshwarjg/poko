import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { compareModes } from '../../../eval/compare.mjs';
import { planG9 } from '../learn/g9.ts';

/* Evaluations: the with/without comparisons (G9), read like code diffs.
 *
 * A comparison is one eval run with every scenario planned twice, with learned routes
 * offered and without. The console shows the scenarios where learning changed the
 * outcome first, worst first, and each plan as a diff of the other. Everything comes
 * from the results file the eval wrote and the verdict eval/compare.mjs computes from
 * it, the same verdict G9 enforces.
 *
 * Which product a run belongs to is recorded in it. Runs from before that was recorded
 * are attributed by the routes they offered, since route ids belong to one product;
 * the console says when it did that. */

export type PlanStep = { intent?: string; target?: { role?: string; name?: string }; action?: { type?: string; value?: unknown } };
export type ResultRow = {
  id: string;
  goal: string;
  from: string;
  why?: string;
  expect?: Record<string, unknown>;
  useRoutes: boolean;
  origin?: string | null;
  includeHeld?: boolean;
  followedRoute?: string | null;
  problems: string[];
  ms?: number;
  result: {
    error?: string;
    outcome?: string;
    limitation?: string | null;
    understood?: string | null;
    plan?: { steps?: PlanStep[]; route?: { id: string } | null } | null;
    knownOffered?: string[];
  };
};

export const resultsDir = () => join(process.cwd(), '..', 'eval', 'results');

export function readResults(file: string): ResultRow[] | null {
  if (!/^[\w.-]+\.json$/.test(file)) return null;
  const path = join(resultsDir(), file);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? (parsed as ResultRow[]) : null;
  } catch {
    return null;
  }
}

/* 2026-09-24T17-06-20.json -> the moment it was written. The eval stamps in UTC. */
export function stampOf(file: string): number {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : 0;
}

export type ComparisonSummary = {
  file: string;
  at: number;
  inferred: boolean;
  includeHeld: boolean;
  verdict: ReturnType<typeof compareModes>;
};

export function comparisonsFor(db: DatabaseSync, productId: string, origin: string, limit = 20): ComparisonSummary[] {
  const dir = resultsDir();
  if (!existsSync(dir)) return [];
  const routeIds = new Set((db.prepare('SELECT id FROM routes WHERE product_id = ?').all(productId) as Array<{ id: string }>).map((r) => r.id));
  const out: ComparisonSummary[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse()) {
    if (out.length >= limit) break;
    const rows = readResults(file);
    if (!rows || !rows.some((r) => r.useRoutes === false) || !rows.some((r) => r.useRoutes === true)) continue;
    const recorded = rows.some((r) => r.origin);
    let inferred = false;
    if (recorded) {
      if (!rows.some((r) => r.origin === origin)) continue;
    } else {
      const offered = rows.flatMap((r) => r.result?.knownOffered ?? []);
      if (!offered.length || !offered.some((id) => routeIds.has(id))) continue;
      inferred = true;
    }
    out.push({ file, at: stampOf(file), inferred, includeHeld: rows.some((r) => r.includeHeld), verdict: compareModes(rows) });
  }
  return out;
}

export type Change = 'regressed' | 'inconclusive' | 'still-failing' | 'improved' | 'same';
export type ScenarioDiff = {
  id: string;
  goal: string;
  from: string;
  why: string | null;
  change: Change;
  docsOnly: Side | null;
  withRoutes: Side | null;
  offered: string[];
  followed: string | null;
  lines: DiffLine[];
};
export type Side = { outcome: string; problems: string[]; limitation: string | null; steps: string[]; error: string | null };
export type DiffLine = { op: ' ' | '-' | '+'; text: string };

/* What a step does, by control name only: plans that name the same control with and
   without its role are doing the same thing, and should not show up as a difference. */
function describeStep(s: PlanStep): string {
  const name = s.target?.name ?? '';
  const a = s.action ?? {};
  const act = a.type === 'setChecked' ? (a.value === false ? 'untick' : 'tick') : a.type === 'setValue' ? `set to ${JSON.stringify(a.value)}` : 'click';
  return `${act} "${name}"`;
}

function side(r: ResultRow | undefined): Side | null {
  if (!r) return null;
  const err = r.result?.error ?? null;
  return {
    outcome: err ? 'no answer' : r.result?.outcome ?? 'unknown',
    problems: r.problems ?? [],
    limitation: r.result?.limitation ?? null,
    steps: (r.result?.plan?.steps ?? []).map(describeStep),
    error: err,
  };
}

/* Line diff by longest common subsequence: plans are short, so the quadratic table is
   nothing. Lines only in the docs-only plan are "-", only with routes "+". */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i] });
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) out.push({ op: '-', text: a[i++] });
    else out.push({ op: '+', text: b[j++] });
  }
  while (i < n) out.push({ op: '-', text: a[i++] });
  while (j < m) out.push({ op: '+', text: b[j++] });
  return out;
}

const RANK: Record<Change, number> = { regressed: 0, inconclusive: 1, 'still-failing': 2, improved: 3, same: 4 };

export function comparisonDetail(db: DatabaseSync, productId: string, file: string) {
  const rows = readResults(file);
  if (!rows) return null;
  const verdict = compareModes(rows);
  const withR = new Map(rows.filter((r) => r.useRoutes).map((r) => [r.id, r]));
  const without = new Map(rows.filter((r) => !r.useRoutes).map((r) => [r.id, r]));
  const scenarios: ScenarioDiff[] = [...withR.keys()].map((id) => {
    const w = withR.get(id);
    const d = without.get(id);
    const change: Change = verdict.regressed.includes(id)
      ? 'regressed'
      : verdict.inconclusive.includes(id)
        ? 'inconclusive'
        : verdict.improved.includes(id)
          ? 'improved'
          : (w?.problems.length ?? 0) > 0
            ? 'still-failing'
            : 'same';
    const docsOnly = side(d);
    const withRoutes = side(w);
    return {
      id,
      goal: (w ?? d)!.goal,
      from: (w ?? d)!.from,
      why: (w ?? d)!.why ?? null,
      change,
      docsOnly,
      withRoutes,
      offered: w?.result?.knownOffered ?? [],
      followed: w?.followedRoute ?? null,
      lines: diffLines(docsOnly?.steps ?? [], withRoutes?.steps ?? []),
    };
  });
  scenarios.sort((a, b) => RANK[a.change] - RANK[b.change] || (a.id < b.id ? -1 : 1));
  return { file, at: stampOf(file), verdict, scenarios, g9: planG9(db, productId, rows) };
}

/* The compare overlay on the map: where planning with a route and without it went
   their separate ways, for one scenario the route was offered in. Plans say which
   control to use, not which screen it is on, so each is walked over the links people
   actually use: a step whose control is a known way from the current screen moves
   along it; any other stays where it is. A control never seen in use is reported as
   such, which is how a step known only from the docs shows up. */
export type Walk = { screens: string[]; unseen: string[] };
export type Split = {
  file: string;
  scenario: string;
  goal: string;
  change: Change;
  docsOnly: Walk & { outcome: string; problems: string[] };
  withRoute: Walk & { outcome: string; problems: string[] };
  /* The last screen both plans share: they part here. */
  splitAt: string | null;
};

export function walkPlan(start: string, steps: PlanStep[], links: Array<{ from: string; to: string; name: string | null }>): Walk {
  const screens = [start];
  const unseen: string[] = [];
  let at = start;
  for (const s of steps) {
    const name = (s.target?.name ?? '').trim().toLowerCase();
    if (!name) continue;
    const here = links.filter((l) => l.from === at && (l.name ?? '').trim().toLowerCase() === name);
    const move = here.find((l) => l.to !== at);
    if (move) {
      at = move.to;
      screens.push(at);
    } else if (!here.length) {
      unseen.push(s.target?.name ?? name);
    }
  }
  return { screens, unseen };
}

export function splitFor(
  db: DatabaseSync,
  productId: string,
  file: string,
  routeId: string,
  startScreen: (fixtureKey: string) => string | null
): Split | null {
  const rows = readResults(file);
  if (!rows) return null;
  const verdict = compareModes(rows);
  const offeredIn = rows.filter((r) => r.useRoutes && (r.result?.knownOffered ?? []).includes(routeId));
  if (!offeredIn.length) return null;
  const links = (
    db.prepare('SELECT from_screen, to_screen, action_json FROM edges WHERE product_id = ?').all(productId) as Array<{ from_screen: string; to_screen: string; action_json: string }>
  ).map((e) => ({ from: e.from_screen, to: e.to_screen, name: (JSON.parse(e.action_json) as { target?: { name?: { text?: string } } }).target?.name?.text ?? null }));
  /* The scenario that shows most: one where the route made planning worse, and among
     those one where the two plans actually went different ways. */
  const rank = (id: string) => (verdict.regressed.includes(id) ? 0 : verdict.improved.includes(id) ? 1 : verdict.inconclusive.includes(id) ? 3 : 2);
  const walked = offeredIn
    .map((w) => {
      const d = rows.find((r) => !r.useRoutes && r.id === w.id);
      const start = startScreen(w.from);
      if (!start) return null;
      const ww = walkPlan(start, w.result?.plan?.steps ?? [], links);
      const dd = walkPlan(start, d?.result?.plan?.steps ?? [], links);
      const differ = ww.screens.join('>') !== dd.screens.join('>') || ww.unseen.join('|') !== dd.unseen.join('|');
      return { w, d, ww, dd, differ };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => rank(a.w.id) - rank(b.w.id) || Number(b.differ) - Number(a.differ) || (a.w.id < b.w.id ? -1 : 1));
  if (!walked.length) return null;
  const { w: pick, d: docs, ww: w, dd: d } = walked[0];
  let i = 0;
  while (i < w.screens.length && i < d.screens.length && w.screens[i] === d.screens[i]) i++;
  const same = w.screens.length === d.screens.length && i === w.screens.length;
  const change: Change = verdict.regressed.includes(pick.id) ? 'regressed' : verdict.improved.includes(pick.id) ? 'improved' : verdict.inconclusive.includes(pick.id) ? 'inconclusive' : 'same';
  return {
    file,
    scenario: pick.id,
    goal: pick.goal,
    change,
    docsOnly: { ...d, outcome: docs?.result?.error ? 'no answer' : docs?.result?.outcome ?? 'unknown', problems: docs?.problems ?? [] },
    withRoute: { ...w, outcome: pick.result?.error ? 'no answer' : pick.result?.outcome ?? 'unknown', problems: pick.problems ?? [] },
    /* No split when both went through the same screens: they differ only in what they
       claimed, which the strip says in words. */
    splitAt: !same && i > 0 ? w.screens[i - 1] : null,
  };
}

/* The eval starts each scenario on a recorded screen of the dev fixture, named by a key
   ("permissions"). Its heading is the screen's name on the map. */
export function fixtureStart(db: DatabaseSync, productId: string): (key: string) => string | null {
  let fixture: Record<string, { screen?: { heading?: string } }> = {};
  try {
    fixture = JSON.parse(readFileSync(join(process.cwd(), '..', 'eval', 'screens.json'), 'utf8'));
  } catch {
    fixture = {};
  }
  const byName = new Map(
    (db.prepare('SELECT id, display_name FROM screens WHERE product_id = ?').all(productId) as Array<{ id: string; display_name: string }>).map((s) => [
      s.display_name.trim().toLowerCase(),
      s.id,
    ])
  );
  return (key) => {
    const heading = fixture[key]?.screen?.heading;
    return heading ? byName.get(heading.trim().toLowerCase()) ?? null : null;
  };
}

/* Screens the eval can start a scenario on, for adding one from the console. */
export function fixtureScreens(): Array<{ key: string; heading: string }> {
  try {
    const fixture = JSON.parse(readFileSync(join(process.cwd(), '..', 'eval', 'screens.json'), 'utf8')) as Record<string, { screen?: { heading?: string } }>;
    return Object.entries(fixture).map(([key, v]) => ({ key, heading: v.screen?.heading ?? key }));
  } catch {
    return [];
  }
}
