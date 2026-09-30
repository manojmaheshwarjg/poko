/* G9 enforced: routes that made planning worse are held back, stay held through
   learning and re-verification, and come back only through a clean comparison. Plus
   the two fixes for the first regression: labels may not promise scope, and the
   planner is told a workflow is a path, not proof of what a change affects. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning, nextStatus } from '../service/lib/learn/run.ts';
import { loadKnownRoutes, rankKnown, renderKnown, withheldForScope } from '../service/lib/learn/known.ts';
import { planVerification, runVerification, lintLabel, LABEL_SYSTEM, type Deps, type PlannerPlan, type RouteRow } from '../service/lib/learn/verify.ts';
import { planG9, applyG9 } from '../service/lib/learn/g9.ts';
import { SYSTEM } from '../service/lib/planner.ts';
import { compareModes } from '../eval/compare.mjs';
import { LONG_WAIT_MS, parseWait } from '../eval/wait.mjs';
import { session, click, tick } from './sim.mts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const one = (db: any, sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as any;

const toPerms = [click('link', 'Project settings'), click('link', 'Permissions')];
const intoEdit = [click('button', 'Actions'), click('menuitem', 'Edit permissions')];
function seed() {
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://g9.localhost');
  const groups: Array<[string[], any[]]> = [
    [['a', 'b', 'c'], [...toPerms, ...intoEdit, tick('Edit issues for Contractors', false)]],
    [['d', 'e'], [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Remove Developers')]],
  ];
  for (const [who, acts] of groups) for (const w of who) {
    const steps = session(w, `ep-${w}`, acts);
    ingestBatch(db, { productId: p.id, install: { id: `install-${w}-g9`, mode: 'vendor', attested: true }, transitions: steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action })) });
  }
  runLearning(db, p.id);
  const idOf = (like: string) => one(db, 'SELECT id FROM routes WHERE product_id = ? AND goal_actions_json LIKE ?', p.id, `%${like}%`).id as string;
  const ids = { edit: idOf('Edit issues for Contractors'), remove: idOf('Remove Developers') };
  const verify = (id: string, label: string) =>
    db.prepare("UPDATE routes SET status = 'verified', verified_path_hash = path_hash, label = ?, title = ? WHERE id = ?").run(label, label, id);
  verify(ids.edit, 'Revoke the Edit issues permission for the Contractors role in this project');
  verify(ids.remove, "Revoke the Developers role's access to this project");
  return { db, pid: p.id, ids };
}

/* One scenario's result, as eval/run.mjs records it. */
const res = (id: string, useRoutes: boolean, ok: boolean, offered: string[] = [], error?: string) => ({
  id, useRoutes, problems: ok ? [] : ['something'], result: error ? { error } : { outcome: 'plan', knownOffered: offered }, followedRoute: null,
});

/* ---- 1. the verdict ---- */
{
  const v = compareModes([
    res('s1', true, false, ['A', 'B']), res('s2', true, true, ['B']), res('s3', true, true, ['C']),
    res('s1', false, true), res('s2', false, false), res('s3', false, true),
  ]);
  check('1. worse with routes is a regression, better is an improvement', v.regressed.join() === 's1' && v.improved.join() === 's2');
  check('1. implicated: offered where it got worse; tested: offered anywhere', v.implicated.join() === 'A,B' && v.tested.sort().join() === 'A,B,C');
  const u = compareModes([res('s1', true, false, ['A'], '429 rate limited'), res('s1', false, true)]);
  check('1. an unanswered request is inconclusive, never a regression', u.inconclusive.join() === 's1' && u.regressed.length === 0);
  check('1. a run without both modes cannot decide anything', compareModes([res('s1', true, true)]).complete === false);
}

/* ---- 2. holding ---- */
{
  const { db, pid, ids } = seed();
  const results = [res('happy', true, false, [ids.edit]), res('other', true, true, [ids.remove]), res('happy', false, true), res('other', false, true)];
  const plan = planG9(db, pid, results);
  check('2. a regression holds the route offered there', plan.hold.map((h) => h.id).join() === ids.edit, JSON.stringify(plan.hold));
  check('2. and only that one', !plan.hold.some((h) => h.id === ids.remove));
  applyG9(db, plan, 'eval-1', 1_800_000_000_000);
  const edit = one(db, 'SELECT status, status_reason, held_at, verified_path_hash, path_hash FROM routes WHERE id = ?', ids.edit);
  check('2. it is marked held, with when and why', edit.status === 'held' && edit.held_at === 1_800_000_000_000 && /eval-1 \(happy\)/.test(edit.status_reason), edit.status_reason);
  check('2. a held route is never offered in normal use', !loadKnownRoutes(db, pid).some((r) => r.id === ids.edit) && loadKnownRoutes(db, pid).some((r) => r.id === ids.remove));
  check('2. the eval can still ask for it, to test it', loadKnownRoutes(db, pid, { includeHeld: true }).some((r) => r.id === ids.edit));
  check('2. a refused comparison cannot be applied', (() => { try { applyG9(db, planG9(db, pid, [res('x', true, true)]), 'bad'); return false; } catch { return true; } })());
  db.prepare("UPDATE routes SET status = 'demoted' WHERE id = ?").run(ids.remove);
  const again = planG9(db, pid, [res('r', true, false, [ids.remove]), res('r', false, true)]);
  check('2. a route already out of use for another reason keeps that reason', again.hold.length === 0);

  runLearning(db, pid);
  check('2. a hold survives a learning run', one(db, 'SELECT status FROM routes WHERE id = ?', ids.edit).status === 'held');
  check('2. but not a change in the path people take', nextStatus({ status: 'candidate', blockedReason: null, pathHash: 'new' }, { status: 'held', verified_path_hash: 'old' }).status === 'candidate'
    && nextStatus({ status: 'candidate', blockedReason: null, pathHash: 'old' }, { status: 'held', verified_path_hash: 'old' }).status === 'held');
}

/* ---- 3. releasing ---- */
{
  const { db, pid, ids } = seed();
  applyG9(db, planG9(db, pid, [res('happy', true, false, [ids.edit]), res('happy', false, true)]), 'eval-1');
  const untested = planG9(db, pid, [res('s', true, true, [ids.remove]), res('s', false, true)]);
  check('3. a clean comparison that never offered it does not release it', untested.release.length === 0 && /not offered/.test(untested.keep[0]?.why ?? ''), untested.keep[0]?.why);
  const unanswered = planG9(db, pid, [res('s', true, true, [ids.edit]), res('t', true, true, [ids.edit], '429'), res('s', false, true), res('t', false, true)]);
  check('3. nor does one with an unanswered scenario', unanswered.release.length === 0 && /no answer/.test(unanswered.keep[0]?.why ?? ''));
  const worse = planG9(db, pid, [res('s', true, true, [ids.edit]), res('t', true, false, [ids.remove]), res('s', false, true), res('t', false, true)]);
  check('3. nor does one with a regression anywhere', !worse.release.some((r) => r.id === ids.edit));
  const clean = planG9(db, pid, [res('s', true, true, [ids.edit]), res('s', false, true)]);
  check('3. a clean comparison that offered it releases it', clean.release.map((r) => r.id).join() === ids.edit);
  applyG9(db, clean, 'eval-2');
  const row = one(db, 'SELECT status, status_reason, verified_path_hash, path_hash FROM routes WHERE id = ?', ids.edit);
  check('3. back to verified, still pinned to its path', row.status === 'verified' && row.status_reason === null && row.verified_path_hash === row.path_hash);
}

/* ---- 4. re-checking a held route ---- */
{
  const { db, pid, ids } = seed();
  applyG9(db, planG9(db, pid, [res('happy', true, false, [ids.edit]), res('happy', false, true)]), 'eval-1', Date.now() - 1000);
  const planned = planVerification(db, pid, { tool: 'jira' });
  const p = planned.find((x) => x.route.id === ids.edit);
  check('4. a held route is due one re-check after its hold', !!p && p.held === true);
  const replay = (route: RouteRow): PlannerPlan => ({
    understood: 'x', outcome: 'plan', limitation: null,
    steps: (JSON.parse(route.path_json) as Array<{ action: any }>).map((s) => ({ intent: 'x', reasoning: 'x', target: { role: s.action.target.role, name: s.action.target.name.text, within: null }, action: { type: s.action.type, text: null, checked: s.action.type === 'setChecked' ? s.action.value : null } })),
  });
  const deps: Deps = { model: 'fake', label: async () => ({ goal: 'Stop contractors from editing issues', title: 't' }), plan: async () => replay(p!.route) };
  await runVerification(db, pid, deps, { tool: 'jira', maxCalls: 2, maxRoutes: 1 });
  const after = one(db, 'SELECT status, label, status_reason FROM routes WHERE id = ?', ids.edit);
  check('4. passing the re-check keeps it held, with the new label', after.status === 'held' && after.label === 'Stop contractors from editing issues' && /held until a with\/without comparison/.test(after.status_reason), JSON.stringify(after));
  check('4. and it is not due again until the next hold', !planVerification(db, pid, { tool: 'jira' }).some((x) => x.route.id === ids.edit));
  db.prepare("UPDATE routes SET held_at = ? WHERE id = ?").run(Date.now() + 10, ids.edit);
  db.prepare("INSERT INTO verifications (product_id, route_id, path_hash, at, outcome, reason, calls) VALUES (?, ?, 'x', ?, 'skipped', 'labelling failed: 429', 1)").run(pid, ids.edit, Date.now() + 20);
  check('4. a re-check that never got an answer does not count', planVerification(db, pid, { tool: 'jira' }).some((x) => x.route.id === ids.edit));
  const scoped: Deps = { model: 'fake', label: async () => ({ goal: 'Stop contractors editing issues in this project', title: 't' }), plan: async () => { throw new Error('verify must not run after a failed lint'); } };
  await runVerification(db, pid, scoped, { tool: 'jira', maxCalls: 2, maxRoutes: 1 });
  const rejected = one(db, 'SELECT status, status_reason FROM routes WHERE id = ?', ids.edit);
  check('4. a new label that still promises scope is rejected before paying to verify it', rejected.status === 'rejected' && /scope/.test(rejected.status_reason), JSON.stringify(rejected));
}

/* ---- 5. labels may not promise scope ---- */
{
  const change = { kind: 'effect' as const, path_json: JSON.stringify([{ action: { type: 'click', target: { name: { text: 'Edit permissions' } } } }]) };
  const copies = { kind: 'effect' as const, path_json: JSON.stringify([{ action: { type: 'click', target: { name: { text: 'Copy scheme' } } } }]) };
  const view = { kind: 'destination' as const, path_json: '[]' };
  const lint = (goal: string, route: any) => lintLabel({ goal, title: 't' }, route);
  check('5. the label behind the regression is refused', !!lint('Revoke the Edit issues permission for the Contractors role in this project', change));
  check('5. so is any "only for this team" kind of promise', !!lint('Remove edit rights just for this team', change) && !!lint('Turn off alerts within this workspace', change));
  check('5. the project as the object of the change is fine', lint("Revoke the Developers role's access to this project", change) === null);
  check('5. a route that itself copies or creates the narrower thing may say so', lint('Make contractors read only in this project', copies) === null);
  check('5. a route that only goes somewhere may say where', lint('Show the current permissions for this project', view) === null);
  check('5. "only" about the change itself is not scope', lint('Let contractors only view issues', change) === null);
  check('5. the labeller is told the rule', /Never promise a scope the route does not establish/.test(LABEL_SYSTEM));
}

/* ---- 6. the planner is told a workflow is a path ---- */
{
  check('6. the planner rules say a workflow is not evidence of what a change affects', /not evidence of what those changes affect/.test(SYSTEM) && /applies exactly as if no workflow had been offered/.test(SYSTEM));
  const { db, pid } = seed();
  check('6. and so does the list of workflows it is shown', /not proof of what the change affects/.test(renderKnown(loadKnownRoutes(db, pid))));
}

/* ---- 8. a scoped request is not offered a route that cannot keep to its scope ---- */
{
  const { db, pid, ids } = seed();
  const known = loadKnownRoutes(db, pid);
  const offered = (goal: string) => rankKnown(known, goal).map((r) => r.id);
  check('8. "only for this project" is not offered the shared-scheme route',
    !offered('Make contractors read only, but only for this project and nothing else').includes(ids.edit));
  check('8. nor is "... in this project"', !offered('Let contractors view but not edit issues in this project').includes(ids.edit));
  check('8. the same request without a scope is offered it', offered('Let contractors view but not edit issues').includes(ids.edit));
  const w = withheldForScope(known, 'Let contractors view but not edit issues in this project');
  check('8. what was withheld, and why, is reported', w.some((x) => x.id === ids.edit && x.scope === 'in this project'), JSON.stringify(w));
  const copying = { ...known.find((r) => r.id === ids.edit)!, row: { ...known.find((r) => r.id === ids.edit)!.row, path_json: JSON.stringify([{ action: { type: 'click', target: { role: 'button', name: { text: 'Copy scheme' } } } }]) } };
  check('8. a route that copies the scheme first is still offered', rankKnown([copying], 'Make contractors read only, but only for this project').length === 1);
  const view = { ...known[0], id: 'r_view', row: { ...known[0].row, kind: 'destination' as const } };
  check('8. a route that only goes somewhere is still offered', rankKnown([view], 'Show contractor permissions in this project').length === 1);
}

/* ---- 9. verification waits out per-minute limits and stops at a daily one ---- */
{
  const replayOf = (route: RouteRow): PlannerPlan => ({
    understood: 'x', outcome: 'plan', limitation: null,
    steps: (JSON.parse(route.path_json) as Array<{ action: any }>).map((s) => ({ intent: 'x', reasoning: 'x', target: { role: s.action.target.role, name: s.action.target.name.text, within: null }, action: { type: s.action.type, text: null, checked: s.action.type === 'setChecked' ? s.action.value : null } })),
  });
  {
    const { db, pid, ids } = seed();
    db.prepare("UPDATE routes SET status = 'candidate' WHERE id = ?").run(ids.edit);
    const route = planVerification(db, pid, { tool: 'jira' }).find((x) => x.route.id === ids.edit)!.route;
    let refusals = 2;
    const naps: number[] = [];
    const deps: Deps = {
      model: 'fake',
      label: async () => {
        if (refusals-- > 0) throw new Error('429 rate_limit_exceeded: Please try again in 1.2s');
        return { goal: 'Stop contractors from editing issues', title: 't' };
      },
      plan: async () => replayOf(route),
    };
    const r = await runVerification(db, pid, deps, { tool: 'jira', maxCalls: 2, maxRoutes: 1, sleep: async (ms) => { naps.push(ms); } });
    check('9. a per-minute limit is waited out, as long as it asks', r.processed[0]?.outcome === 'verified' && naps.length === 2 && naps[0] === 2700, JSON.stringify({ naps, r: r.processed[0] }));
    check('9. and the refused attempts are not counted against the budget', r.callsUsed === 2);
  }
  {
    const { db, pid, ids } = seed();
    db.prepare("UPDATE routes SET status = 'candidate' WHERE id = ?").run(ids.edit);
    const deps: Deps = { model: 'fake', label: async () => { throw new Error('429 rate_limit_exceeded on tokens per day (TPD): Please try again in 17m53.52s'); }, plan: async () => { throw new Error('never'); } };
    const naps: number[] = [];
    const r = await runVerification(db, pid, deps, { tool: 'jira', maxCalls: 2, maxRoutes: 1, sleep: async (ms) => { naps.push(ms); } });
    check('9. a daily limit stops the run at once, saying so', naps.length === 0 && /daily limit reached, try again in 18 minutes/.test(r.stoppedBecause ?? ''), r.stoppedBecause ?? '');
    check('9. and leaves the route as it was', one(db, 'SELECT status FROM routes WHERE id = ?', ids.edit).status === 'candidate');
  }
}

/* ---- 7. reading the provider's wait ---- */
{
  check('7. a per-minute hint in seconds', parseWait('Please try again in 3.915s. Need more tokens?') === 3915);
  check('7. a daily hint in minutes and seconds', parseWait('Please try again in 7m12.5s.') === 432500);
  check('7. hours, and milliseconds', parseWait('try again in 1h2m3s') === 3723000 && parseWait('try again in 450ms') === 450);
  check('7. no hint is null, not zero', parseWait('rate_limit_exceeded') === null);
  check('7. a daily wait is past the limit worth waiting out; a per-minute one is not',
    parseWait('try again in 7m12.5s')! > LONG_WAIT_MS && parseWait('try again in 3.9s')! < LONG_WAIT_MS);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
