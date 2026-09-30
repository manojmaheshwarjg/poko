/* Verification tests. No real model is ever called: every model-backed function is
   a fake, and the ones that must never run throw if they do. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning } from '../service/lib/learn/run.ts';
import {
  nameMatches, lintLabel, observationForPlanner, compareToRoute, planVerification, runVerification,
  type RouteRow, type PlannerPlan, type Deps, type LabelInput,
} from '../service/lib/learn/verify.ts';
import { session, click, tick } from './sim.mts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

/* ---- 1. names ---- */
check('1. equal names match', nameMatches('Edit issues for Contractors', 'edit  issues for contractors'));
check('1. quotes and case are ignored', nameMatches('“Permissions”', 'permissions'));
check('1. close containment matches', nameMatches('Remove Developers', 'Remove Developers role'));
check('1. a fragment does not match the whole control', !nameMatches('Edit', 'Edit issues for Contractors'));
check('1. a different control does not match', !nameMatches('Edit issues for Developers', 'Edit issues for Contractors'));

/* ---- 2. label lint ---- */
check('2. an outcome passes', lintLabel({ goal: 'Stop contractors from editing issues in this project', title: 'x' }) === null);
check('2. clicks are refused', !!lintLabel({ goal: 'Click Permissions and untick Edit issues', title: 'x' }));
check('2. checkbox talk is refused', !!lintLabel({ goal: 'Clear the Edit issues checkbox for Contractors', title: 'x' }));
check('2. a numbered recipe is refused', !!lintLabel({ goal: 'Do this: 1. open settings 2. pick permissions', title: 'x' }));
check('2. too short is refused', !!lintLabel({ goal: 'perms', title: 'x' }));

/* ---- 3. observation for the planner ---- */
{
  const o = observationForPlanner({
    url: 'http://x/app', title: { hash: 't', text: 'App' }, heading: { hash: 'h', text: 'Edit permissions' },
    nodes: [
      { role: 'checkbox', name: { hash: 'a', text: 'Edit issues for Contractors' }, state: { checked: true }, within: { hash: 'w', text: 'Matrix' } },
      { role: 'button', name: { hash: 'private-only' } },
    ],
  });
  check('3. clear labels reach the planner with state and section', o.nodes.length === 1 && o.nodes[0].state?.checked === true && o.nodes[0].within === 'Matrix');
  check('3. a private (hash-only) label never reaches the planner', !JSON.stringify(o).includes('private-only'));
}

/* ---- build a real product through the whole stack ---- */
const toPerms = [click('link', 'Project settings'), click('link', 'Permissions')];
const intoEdit = [click('button', 'Actions'), click('menuitem', 'Edit permissions')];
const readOnly = tick('Edit issues for Contractors', false);
function seed(db: any, origin: string) {
  const p = productForOrigin(db, origin);
  const groups: Array<[string[], any[]]> = [
    [['a', 'b', 'c'], [...toPerms, ...intoEdit, readOnly]],
    [['d', 'e'], [...toPerms, ...intoEdit, readOnly, tick('Delete issues for Contractors', true)]],
    [['f', 'g'], [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Remove Developers')]],
    [['h', 'i'], toPerms],
  ];
  for (const [who, acts] of groups) for (const w of who) {
    const steps = session(w, `ep-${w}`, acts);
    ingestBatch(db, { productId: p.id, install: { id: `install-${w}-verify`, mode: 'vendor', attested: true }, transitions: steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action })) });
  }
  runLearning(db, p.id);
  return p.id;
}
const routes = (db: any, pid: string) => db.prepare('SELECT * FROM routes WHERE product_id = ? ORDER BY attempts DESC, id').all(pid) as any[];
const routeBy = (db: any, pid: string, pred: (r: any) => boolean) => routes(db, pid).find(pred) as RouteRow & Record<string, any>;
const isUntick = (r: any) => r.kind === 'effect' && JSON.parse(r.goal_actions_json).length === 1 && /Edit issues for Contractors/.test(r.goal_actions_json);

/* A faithful planner: replays a route exactly. Variants of it test each outcome. */
function replay(route: RouteRow, tweak?: (steps: PlannerPlan['steps']) => PlannerPlan['steps']): PlannerPlan {
  const path = JSON.parse(route.path_json) as Array<{ action: any }>;
  let steps: PlannerPlan['steps'] = path.map((s) => ({
    intent: 'x', reasoning: 'x',
    target: { role: s.action.target.role, name: s.action.target.name.text, within: null },
    action: { type: s.action.type, text: null, checked: s.action.type === 'setChecked' ? s.action.value : null },
  }));
  if (tweak) steps = tweak(steps);
  return { understood: 'x', outcome: 'plan', limitation: null, steps };
}
const box = (name: string, checked: boolean) => ({ intent: 'x', reasoning: 'x', target: { role: 'checkbox', name, within: null }, action: { type: 'setChecked' as const, text: null, checked } });

/* ---- 4. the judgement ---- */
{
  const db = openDb(':memory:');
  const pid = seed(db, 'http://verify.localhost');
  const r = routeBy(db, pid, isUntick);
  check('4. an exact replay is verified', compareToRoute(replay(r), r).outcome === 'verified');
  const extra = compareToRoute(replay(r, (s) => [...s, box('Browse projects for Contractors', false)]), r);
  check('4. an extra change is rejected, and named', extra.outcome === 'rejected' && /Browse projects/.test(extra.reason), extra.reason);
  const flipped = compareToRoute(replay(r, (s) => s.map((x) => (x.action.type === 'setChecked' ? { ...x, action: { ...x.action, checked: true } } : x))), r);
  check('4. the right box in the wrong direction is rejected', flipped.outcome === 'rejected', flipped.reason);
  const other = compareToRoute(replay(r, (s) => s.map((x) => (x.action.type === 'setChecked' ? box('Delete issues for Contractors', true) : x))), r);
  check('4. a different change is rejected as leading somewhere else', other.outcome === 'rejected' && /somewhere else/.test(other.reason), other.reason);
  const navOnly = compareToRoute(replay(r, (s) => s.filter((x) => x.action.type === 'click')), r);
  check('4. navigating without changing anything is rejected', navOnly.outcome === 'rejected' && /never made the change/.test(navOnly.reason));
  check('4. "cannot" is a gap, not a rejection', compareToRoute({ understood: 'x', outcome: 'cannot', limitation: 'not in docs', steps: [] }, r).outcome === 'gap');
  check('4. "partial" means the label promised more: rejected', compareToRoute({ ...replay(r), outcome: 'partial', limitation: 'timing' }, r).outcome === 'rejected');
  check('4. path agreement reported for an exact replay', compareToRoute(replay(r), r).pathAgreement === 1);

  const swap = routeBy(db, pid, (x) => x.kind === 'effect' && JSON.parse(x.goal_actions_json).length === 2);
  check('4. a two-change route needs both changes', compareToRoute(replay(swap), swap).outcome === 'verified'
    && compareToRoute(replay(swap, (s) => s.slice(0, -1)), swap).outcome === 'rejected');
  const rm = routeBy(db, pid, (x) => /Remove Developers/.test(x.goal_actions_json));
  check('4. a route whose change is a click is verified by that click', compareToRoute(replay(rm), rm).outcome === 'verified');

  const dest = routeBy(db, pid, (x) => x.kind === 'destination');
  check('4. a destination is verified by getting there', compareToRoute(replay(dest), dest).outcome === 'verified');
  check('4. a look-only goal that changes something is rejected',
    compareToRoute(replay(dest, (s) => [...s, box('Edit issues for Contractors', false)]), dest).outcome === 'rejected');
}

/* ---- 5. the scenario verification exists for: an over-broad label ---- */
{
  const db = openDb(':memory:');
  const pid = seed(db, 'http://verify.localhost');
  const r = routeBy(db, pid, isUntick);
  /* A labeller that overreaches, and a planner that faithfully does what the label says. */
  const deps: Deps = {
    model: 'fake',
    label: async () => ({ goal: 'Remove all contractor permissions', title: 'Remove contractor permissions' }),
    plan: async () => replay(r, (s) => [...s.slice(0, -1), box('Browse projects for Contractors', false), box('Edit issues for Contractors', false)]),
  };
  const res = await runVerification(db, pid, deps, { tool: 'jira', maxCalls: 2, maxRoutes: 1 });
  const row = routeBy(db, pid, isUntick);
  check('5. an over-broad label for a narrow route is rejected', res.processed[0]?.outcome === 'rejected' && row.status === 'rejected', res.processed[0]?.reason);
  check('5. with the extra change it would have caused named in the reason', /Browse projects for Contractors/.test(row.status_reason ?? ''));
}

/* ---- 6. orchestration, budget, and never paying twice ---- */
{
  const db = openDb(':memory:');
  const pid = seed(db, 'http://verify.localhost');
  const plan = planVerification(db, pid, { tool: 'jira' });
  check('6. four candidate routes planned, all callable', plan.length === 4 && plan.every((p) => p.willCall), `planned=${plan.length}`);

  let labelCalls = 0;
  let planCalls = 0;
  const byRoute = new Map(routes(db, pid).map((r) => [r.id, r]));
  const faithful: Deps = {
    model: 'fake',
    label: async (i: LabelInput) => { labelCalls++; return { goal: `Get this done: ${i.goal.replace(/untick|tick|click/gi, '').slice(0, 60)}`, title: 't' }; },
    plan: async () => { planCalls++; return replay([...byRoute.values()][planCalls - 1]); },
  };
  /* Route order in the plan matches selection order, so the fake replays each in turn. */
  const ordered = planVerification(db, pid, { tool: 'jira' }).map((p) => byRoute.get(p.route.id)!);
  faithful.plan = async () => { planCalls++; return replay(ordered[planCalls - 1]); };
  const res = await runVerification(db, pid, faithful, { tool: 'jira', maxCalls: 100 });
  check('6. all four verified', res.processed.every((x) => x.outcome === 'verified'), JSON.stringify(res.processed.map((x) => x.outcome)));
  check('6. two calls each, eight in total', res.callsUsed === 8 && labelCalls === 4 && planCalls === 4);
  const rows = routes(db, pid);
  check('6. each route pinned to the path it was verified on', rows.every((r) => r.status === 'verified' && r.verified_path_hash === r.path_hash && !!r.label));
  const recs = db.prepare('SELECT COUNT(*) AS n, SUM(calls) AS c FROM verifications WHERE product_id = ?').get(pid) as any;
  check('6. every attempt recorded with its cost (G11)', recs.n === 4 && recs.c === 8);

  const again = await runVerification(db, pid, faithful, { tool: 'jira', maxCalls: 100 });
  check('6. a second run pays nothing for routes already settled', again.callsUsed === 0 && again.processed.length === 0);
  runLearning(db, pid);
  check('6. and learning keeps them verified', routes(db, pid).every((r) => r.status === 'verified'));
}

/* ---- 7. budget and failure behaviour ---- */
{
  const db = openDb(':memory:');
  const pid = seed(db, 'http://verify.localhost');
  const never: Deps = { model: 'fake', label: async () => { throw new Error('must not be called'); }, plan: async () => { throw new Error('must not be called'); } };
  const zero = await runVerification(db, pid, never, { tool: 'jira', maxCalls: 1 });
  check('7. a budget too small for one whole route starts nothing', zero.callsUsed === 0 && /budget/.test(zero.stoppedBecause ?? ''));

  const r0 = planVerification(db, pid, { tool: 'jira' })[0].route;
  const ok: Deps = { model: 'fake', label: async () => ({ goal: 'Stop contractors from editing issues', title: 't' }), plan: async () => replay(r0) };
  const three = await runVerification(db, pid, ok, { tool: 'jira', maxCalls: 3 });
  check('7. a budget of three finishes one route and stops', three.callsUsed === 2 && three.processed.length === 1 && /budget/.test(three.stoppedBecause ?? ''));

  const mechanics: Deps = { model: 'fake', label: async () => ({ goal: 'Click Permissions then untick the box', title: 't' }), plan: async () => { throw new Error('verify must not run after a failed lint'); } };
  const linted = await runVerification(db, pid, mechanics, { tool: 'jira', maxCalls: 2, maxRoutes: 1 });
  check('7. a label that describes clicks is rejected without paying to verify it', linted.processed[0]?.outcome === 'rejected' && linted.callsUsed === 1, linted.processed[0]?.reason);
}
{
  const db = openDb(':memory:');
  const pid = seed(db, 'http://verify.localhost');
  const down: Deps = { model: 'fake', label: async () => ({ goal: 'Stop contractors from editing issues', title: 't' }), plan: async () => { throw new Error('429 rate limited'); } };
  const res = await runVerification(db, pid, down, { tool: 'jira', maxCalls: 100 });
  const first = res.processed[0];
  check('7. a failing model stops the run', res.processed.length === 1 && /429/.test(res.stoppedBecause ?? ''));
  check('7. and leaves the route as it was, not rejected', routes(db, pid).find((r) => r.id === first.routeId)?.status === 'candidate');
}

/* ---- 8. private routes are never labelled ---- */
{
  const db = openDb(':memory:');
  const pid = seed(db, 'http://verify.localhost');
  /* `text` is the last key of a stored label, so it is preceded by a comma, not followed by one. */
  db.prepare("UPDATE routes SET path_json = replace(path_json, ',\"text\":\"Project settings\"', '') WHERE product_id = ?").run(pid);
  const stillClear = routes(db, pid).filter((r) => r.path_json.includes('"text":"Project settings"')).length;
  check('8. (setup) the label really was made private', stillClear === 0, `still clear in ${stillClear}`);
  const never: Deps = { model: 'fake', label: async () => { throw new Error('must not label a private route'); }, plan: async () => { throw new Error('x'); } };
  const res = await runVerification(db, pid, never, { tool: 'jira', maxCalls: 100 });
  const skipped = res.processed.filter((x) => x.outcome === 'skipped');
  check('8. routes with private labels are skipped at no cost', skipped.length >= 1 && skipped.every((x) => x.calls === 0) && /private/.test(skipped[0].reason), JSON.stringify(res.processed.map((x) => x.outcome)));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
