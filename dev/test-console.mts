/* The console's logic, without a browser or a model: map layout, screen drawings,
   readable steps, docs coverage, route history, token budget, the paid-run queue,
   struggle context, evaluation diffs and the with/without split, setup, and the map
   model end to end on a learned product. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning } from '../service/lib/learn/run.ts';
import { layoutMap, spaceOut } from '../service/lib/console/layout.ts';
import { thumbFor } from '../service/lib/console/thumbs.ts';
import { readableSteps, routeScreens } from '../service/lib/console/steps.ts';
import { mentions } from '../service/lib/console/docs.ts';
import { routeHistory } from '../service/lib/console/history.ts';
import { recordRouteEvent } from '../service/lib/learn/events.ts';
import { budget, DEFAULT_TOKENS_PER_CALL, estimate, kTokens, nextMorning, recordUsage, startOfDay, tokensForJob, tokensSince, usageContext } from '../service/lib/usage.ts';
import { cancel, dueJobs, enqueue, getJob, recoverInterrupted, runJob, type Executors } from '../service/lib/console/queue.ts';
import { afterStruggle, copilotCases, listStruggles, parseStruggleId, struggleId, struggleTitle } from '../service/lib/console/struggles.ts';
import { comparisonDetail, comparisonsFor, diffLines, splitFor, walkPlan } from '../service/lib/console/evaluations.ts';
import { counts, needsAttention, setupSteps } from '../service/lib/console/setup.ts';
import { loadMap } from '../service/lib/console/model.ts';
import { suggestions, wayfind } from '../service/lib/console/wayfind.ts';
import { session, click, tick } from './sim.mts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const one = (db: any, sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as any;

/* ---- 1. layout ---- */
{
  const nodes = ['board', 'settings', 'perms', 'access', 'notif', 'edit'].map((id, i) => ({ id, weight: 10 - i }));
  const links = [
    { from: 'board', to: 'settings', weight: 15 }, { from: 'settings', to: 'perms', weight: 12 }, { from: 'settings', to: 'access', weight: 6 },
    { from: 'settings', to: 'notif', weight: 2 }, { from: 'perms', to: 'edit', weight: 10 }, { from: 'access', to: 'settings', weight: 4 },
    { from: 'board', to: 'edit', weight: 1 }, { from: 'perms', to: 'perms', weight: 9 },
  ];
  const a = layoutMap(nodes, links, { entries: ['board'] });
  const b = layoutMap([...nodes].reverse(), [...links].reverse(), { entries: ['board'] });
  const at = (l: typeof a, id: string) => l.nodes.find((n) => n.id === id)!;
  check('1. the same product always draws the same map, whatever order rows come in', JSON.stringify(a.nodes.map((n) => [n.id, n.x, n.y]).sort()) === JSON.stringify(b.nodes.map((n) => [n.id, n.x, n.y]).sort()));
  check('1. where people start is the first column', at(a, 'board').layer === 0 && at(a, 'settings').layer === 1 && at(a, 'edit').layer === 3);
  let overlap = false;
  for (const p of a.nodes) for (const q of a.nodes) if (p !== q && Math.abs(p.x - q.x) < a.nodeW && Math.abs(p.y - q.y) < a.nodeH) overlap = true;
  check('1. no two stations overlap', !overlap);
  check('1. a screen sits level with the screen that leads to it when there is room', at(a, 'edit').y === at(a, 'perms').y && at(a, 'settings').y === at(a, 'board').y);
  check('1. an action that stays on its screen is not a line', !a.links.some((l) => l.from === l.to));
  const back = a.links.find((l) => l.from === 'access' && l.to === 'settings')!;
  check('1. going back to an earlier screen is drawn as a return line', back.back && !a.links.find((l) => l.from === 'settings' && l.to === 'access')!.back);
  const skip = a.links.find((l) => l.from === 'board' && l.to === 'edit')!;
  check('1. a line that skips columns runs in the lane under every station', Number(skip.d.match(/V(\d+)/)![1]) > Math.max(...a.nodes.map((n) => n.y + a.nodeH)));
  const verticals = a.links.flatMap((l) => [...l.d.matchAll(/H(\d+) V/g)].map((m) => Number(m[1])));
  check('1. every vertical runs in a gap between columns, never through a station', verticals.every((x) => !a.nodes.some((n) => x > n.x && x < n.x + a.nodeW)));
  check('1. an unreachable screen still gets placed', layoutMap([{ id: 'x', weight: 1 }, { id: 'y', weight: 1 }], []).nodes.length === 2);
  check('1. no screens is an empty map, not a crash', layoutMap([], []).nodes.length === 0);
  const s = spaceOut([0, 0, 300], 100);
  check('1. spacing keeps order and the gap, as close to the wanted heights as it can', s[1] - s[0] >= 100 - 1e-9 && s[2] - s[1] >= 100 - 1e-9 && Math.abs(s[0] + 50) < 1e-9 && s[2] === 300);
}

/* ---- 2. drawings ---- */
{
  const k = (keys: string[]) => thumbFor(keys).kind;
  check('2. a screen of checkboxes is a grid', k(['H:x', ...['a', 'b', 'c', 'd'].map((n) => `checkbox:${n}@`)]) === 'grid');
  check('2. several fields make a form', k(['textbox:a@', 'combobox:b@', 'button:save@']) === 'form');
  check('2. rows of buttons are a table', k(['button:a@', 'button:b@', 'button:c@', 'link:x@']) === 'table');
  check('2. only links is a list', k(['link:a@', 'link:b@', 'link:c@']) === 'list');
  check('2. controls are counted by role, headings are not controls', thumbFor(['H:x', 'heading:x@', 'link:a@', 'button:b@']).controls === 2);
}

/* ---- 3. readable steps ---- */
{
  const A = (type: string, role: string, text: string | null, value?: boolean) => ({ type, value, target: { role, name: text === null ? { hash: 'h' } : { hash: 'h', text } } });
  const steps = readableSteps([
    { screen: 'b', action: A('click', 'link', 'Project settings'), effect: 'navigate' },
    { screen: 's', action: A('click', 'button', 'Actions'), effect: 'open' },
    { screen: 's', action: A('click', 'menuitem', 'Edit permissions'), effect: 'navigate' },
    { screen: 'e', action: A('setChecked', 'checkbox', 'Edit issues for Contractors', false), effect: 'mutate' },
    { screen: 'e', action: A('click', 'button', null), effect: 'mutate' },
  ]);
  check('3. a link is "Open"', steps[0].text === 'Open Project settings' && !steps[0].changes);
  check('3. a menu and its item read as one step', steps[1].text === 'Actions, then Edit permissions' && steps[1].covers === 2);
  check('3. a checkbox says which way it goes', steps[2].text === 'Untick Edit issues for Contractors' && steps[2].changes);
  check('3. a private label is shown as private, not guessed', steps[3].text.includes('label is private'));
  check('3. screens along a route, without repeats in a row', routeScreens([{ screen: 'b', action: A('click', 'link', 'x') }, { screen: 's', action: A('click', 'link', 'y') }, { screen: 's', action: A('click', 'link', 'z') }], 'e').join(',') === 'b,s,e');
}

/* ---- 4. docs coverage ---- */
{
  const sections = [{ doc: 'guide', heading: 'Sharing', body: '', text: 'Use Access to add people. Accessibility is elsewhere.' }];
  check('4. a screen named in the docs is found', mentions('Access', sections).length === 1);
  check('4. whole phrases only: "Access" is not found inside "Accessibility"', mentions('Accessibility settings', sections).length === 0 && mentions('Access', [{ ...sections[0], text: 'Accessibility only' }]).length === 0);
  check('4. case and spacing do not matter', mentions('use  access', sections).length === 1);
}

/* A learned product: people going to Edit permissions, one wrong turn to Access. */
const toPerms = [click('link', 'Project settings'), click('link', 'Permissions')];
const intoEdit = [click('button', 'Actions'), click('menuitem', 'Edit permissions')];
function learned() {
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://console.localhost');
  const add = (who: string, acts: any[]) => {
    const steps = session(who, `ep-${who}`, acts);
    ingestBatch(db, { productId: p.id, install: { id: `install-${who}-console`, mode: 'vendor', attested: true }, transitions: steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action })) });
  };
  for (const w of ['a', 'b', 'c']) add(w, [...toPerms, ...intoEdit, tick('Edit issues for Contractors', false)]);
  for (const w of ['d', 'e']) add(w, [click('link', 'Project settings'), click('link', 'Access'), click('link', 'Project settings'), click('link', 'Permissions'), ...intoEdit, tick('Edit issues for Contractors', false)]);
  runLearning(db, p.id);
  return { db, p };
}

/* ---- 5. history ---- */
{
  const { db, p } = learned();
  const route = one(db, "SELECT id FROM routes WHERE product_id = ? AND goal_actions_json LIKE '%Edit issues%'", p.id).id as string;
  const mined = routeHistory(db, route);
  check('5. a new route is mined, with how many people', mined.length === 1 && mined[0].kind === 'mined' && /5 people/.test(mined[0].detail ?? ''), JSON.stringify(mined));
  const ins = db.prepare('INSERT INTO verifications (product_id, route_id, path_hash, at, outcome, reason, label, calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const t0 = Date.now();
  ins.run(p.id, route, 'h', t0 + 1000, 'verified', 'ok', 'Remove Edit issues', 2);
  ins.run(p.id, route, 'h', t0 + 2000, 'verified', 'ok', 'Remove the Edit issues permission', 2);
  recordRouteEvent(db, { productId: p.id, routeId: route, kind: 'held', detail: 'made planning worse', at: t0 + 3000 });
  const h = routeHistory(db, route);
  check('5. newest first', h[0].kind === 'held' && h[h.length - 1].kind === 'mined');
  check('5. a second verification under another label reads as a re-check', h[1].text.startsWith('Re-checked, new label') && h[2].text === 'Verified, 2 calls');
}

/* ---- 6. usage and budget ---- */
{
  const db = openDb(':memory:');
  const now = new Date(2026, 8, 25, 14, 0, 0).getTime();
  check('6. no history: the measured default per call', estimate(db, 10, ['plan'], now).tokens === 10 * DEFAULT_TOKENS_PER_CALL && !estimate(db, 10, ['plan'], now).measured);
  for (const n of [3000, 5000, 4000]) recordUsage(db, { purpose: 'plan', model: 'm', promptTokens: n - 500, completionTokens: 500, totalTokens: n }, now - 3_600_000);
  recordUsage(db, { purpose: 'plan', model: 'm', promptTokens: 1, completionTokens: 1, totalTokens: 99_000 }, startOfDay(now) - 1);
  const e = estimate(db, 10, ['plan'], now);
  check('6. with history: the average of recorded calls', e.measured && e.tokens === 10 * 27_750, String(e.tokens));
  check('6. today counts from midnight, not the last day', tokensSince(db, startOfDay(now)) === 12_000 && budget(db, now).usedToday === 12_000);
  check('6. a run bigger than what is left does not fit today', !estimate(db, 100, ['plan'], now).fitsToday && estimate(db, 1, ['plan'], now).fitsToday);
  check('6. the per-minute limit says how long a run takes', e.minutes === Math.ceil(e.tokens / 8000));
  const next = new Date(nextMorning(now));
  check('6. the next slot is nine the next morning', next.getDate() === 26 && next.getHours() === 9 && next.getMinutes() === 0);
  usageContext.run({ jobId: 7 }, () => recordUsage(db, { purpose: 'plan', model: 'm', promptTokens: 1, completionTokens: 1, totalTokens: 2 }, now));
  check('6. a call made inside a job is recorded against it', tokensForJob(db, 7).calls === 1 && tokensForJob(db, 7).tokens === 2);
  check('6. token counts read as 41k, 1.2k, 830', kTokens(41_234) === '41k' && kTokens(1_200) === '1.2k' && kTokens(830) === '830');
}

/* ---- 7. the queue ---- */
{
  const { db, p } = learned();
  const product = { id: p.id, tool: 'jira' };
  const candidates = one(db, "SELECT COUNT(*) AS n FROM routes WHERE product_id = ? AND status = 'candidate'", p.id).n as number;
  const calls = candidates * 2;
  check('7. setup: the learned product has routes waiting to be verified', candidates > 0);
  const wrong = enqueue(db, product, { kind: 'verify', calls: calls + 2, when: 'now' });
  check('7. a run whose calls changed since they were shown is refused', !wrong.ok && /look again/.test((wrong as any).reason));
  const now = Date.now();
  const q = enqueue(db, product, { kind: 'verify', calls, when: 'next-morning' }, now);
  check('7. a confirmed run is queued with exactly the calls shown', q.ok && q.job.calls === calls && q.job.status === 'queued');
  check('7. queued for the morning is not due now', q.ok && q.job.run_after === nextMorning(now) && dueJobs(db, now).length === 0);
  const dup = enqueue(db, product, { kind: 'verify', calls, when: 'now' });
  check('7. one queued run of a kind per product', !dup.ok && /already queued/.test((dup as any).reason));
  check('7. a queued run can be cancelled', q.ok && cancel(db, q.job.id) && getJob(db, q.job.id)!.status === 'cancelled');
  check('7. a cancelled run cannot be cancelled again, or run', q.ok && !cancel(db, q.job.id) && dueJobs(db, Date.now()).length === 0);

  let ran = 0;
  const exec: Executors = {
    verify: async (job) => {
      ran++;
      recordUsage(db, { purpose: 'verify', model: 'fake', promptTokens: 10, completionTokens: 5, totalTokens: 15 });
      return { job: job.id };
    },
    compare: async () => ({}),
  };
  const r = enqueue(db, product, { kind: 'verify', calls, when: 'now' });
  const outcome = r.ok ? await runJob(db, r.job, exec) : null;
  check('7. a due run runs, once, and is marked done', outcome?.status === 'done' && ran === 1 && r.ok && getJob(db, r.job.id)!.status === 'done');
  check('7. the tokens it used are recorded against it', r.ok && tokensForJob(db, r.job.id).tokens === 15);

  /* A run that no longer fits today moves to the morning instead of starting. */
  db.prepare("UPDATE routes SET status = 'candidate' WHERE product_id = ?").run(p.id);
  const again = enqueue(db, product, { kind: 'verify', calls: callsNow(db, p.id), when: 'now' });
  recordUsage(db, { purpose: 'plan', model: 'm', promptTokens: 1, completionTokens: 1, totalTokens: 199_990 });
  const deferred = again.ok ? await runJob(db, again.job, exec) : null;
  check('7. a run that no longer fits what is left today is moved, not started', deferred?.status === 'deferred' && ran === 1 && again.ok && getJob(db, again.job.id)!.status === 'queued' && getJob(db, again.job.id)!.run_after > Date.now());

  /* More calls than approved: refused at start. */
  db.prepare("DELETE FROM model_usage").run();
  const small = db.prepare("INSERT INTO jobs (product_id, kind, status, calls, est_tokens, run_after, options_json, created_at) VALUES (?, 'verify', 'queued', 1, 10, 0, '{}', 0)").run(p.id);
  const over = await runJob(db, getJob(db, Number(small.lastInsertRowid))!, exec);
  check('7. never more calls than were approved', over.status === 'failed' && /more than the 1 that/.test(over.note ?? '') && ran === 1, JSON.stringify(over));

  db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(Number(small.lastInsertRowid));
  check('7. a run left running by a stopped service is marked interrupted', recoverInterrupted(db) >= 1 && /interrupted/.test(getJob(db, Number(small.lastInsertRowid))!.error ?? ''));
}
function callsNow(db: any, productId: string) {
  return (one(db, "SELECT COUNT(*) AS n FROM routes WHERE product_id = ? AND status = 'candidate'", productId).n as number) * 2;
}

/* ---- 8. struggles ---- */
{
  const { db, p } = learned();
  const names = new Map((db.prepare('SELECT id, display_name FROM screens WHERE product_id = ?').all(p.id) as any[]).map((s) => [s.id, s.display_name]));
  const list = listStruggles(db, p.id, (id) => names.get(id) ?? id);
  const back = list.find((s) => s.kind === 'backtrack');
  check('8. the wrong turn is a struggle that says what happened, not why', !!back && back.title === '2 people open Access and come straight back', back?.title);
  check('8. struggle ids round-trip', !!back && JSON.stringify(parseStruggleId(struggleId(back))) === JSON.stringify({ screen_id: back.screen_id, kind: back.kind, control: back.control }));
  const after = back ? afterStruggle(db, p.id, back) : null;
  const next = after?.next[0];
  check('8. where they went next: both went on to Permissions', after?.episodes === 2 && !!next && names.get(next.screen) === 'Permissions' && next.count === 2, JSON.stringify(after));
  check('8. titles for the copilot\'s own mistakes', struggleTitle('copilotRejected', 2, 'Edit permissions', 'Edit issues') === `2 people turned down the copilot's step "Edit issues"`);

  /* A turned-down step, and what that person did instead. */
  const edit = db.prepare("SELECT id, core_keys_json FROM screens WHERE product_id = ? AND display_name = 'Edit permissions'").get(p.id) as any;
  const heading = (JSON.parse(edit.core_keys_json) as string[]).find((k) => k.startsWith('H:'))!.slice(2);
  const install = 'install-a-console';
  const at = (one(db, 'SELECT MIN(at) AS at FROM transitions WHERE install_id = ?', install).at as number) - 1;
  db.prepare("INSERT INTO decisions (product_id, install_id, run_id, step_id, at, kind, url, heading_json, planned_json, located_json, action_json, route_id, received_at) VALUES (?, ?, 'r1', 's1', ?, 'skipped', null, ?, ?, null, ?, null, ?)").run(
    p.id, install, at, JSON.stringify({ hash: heading }), JSON.stringify({ role: 'checkbox', name: { hash: 'h', text: 'Browse projects for Contractors' } }), JSON.stringify({ type: 'setChecked', value: false }), at
  );
  const cases = copilotCases(db, p.id, edit.id, ['copilotRejected']);
  check('8. the copilot proposed, and the person did next', cases.length === 1 && cases[0].proposed === 'Untick Browse projects for Contractors' && cases[0].didNext[0] === 'Project settings', JSON.stringify(cases));
  check('8. a decision on another screen is not listed here', copilotCases(db, p.id, 'no-such-screen', ['copilotRejected']).length === 0);
}

/* ---- 9. evaluations ---- */
{
  const d = diffLines(['a', 'b', 'c'], ['a', 'c', 'd']);
  check('9. plans diff like code', d.map((l) => l.op + l.text).join(' ') === ' a -b  c +d');
  const links = [
    { from: 'perms', to: 'perms', name: 'Actions' },
    { from: 'perms', to: 'edit', name: 'Edit permissions' },
  ];
  const w = walkPlan('perms', [{ target: { name: 'Actions' } }, { target: { name: 'Edit permissions' } }, { target: { name: 'Edit issues' } }], links);
  check('9. a plan is walked over the links people use', w.screens.join('>') === 'perms>edit' && w.unseen.join() === 'Edit issues');
  const docsOnly = walkPlan('perms', [{ target: { name: 'Actions' } }, { target: { name: 'Copy scheme' } }], links);
  check('9. a control never seen in use is reported, not invented', docsOnly.screens.join('>') === 'perms' && docsOnly.unseen.join() === 'Copy scheme');

  /* Comparisons on disk, one recorded for its product and one from before that. */
  const root = mkdtempSync(join(tmpdir(), 'sekva-'));
  const cwd = process.cwd();
  try {
    mkdirSync(join(root, 'service'), { recursive: true });
    mkdirSync(join(root, 'eval', 'results'), { recursive: true });
    const { db, p } = learned();
    const route = one(db, "SELECT id FROM routes WHERE product_id = ? AND goal_actions_json LIKE '%Edit issues%'", p.id).id as string;
    db.prepare("UPDATE routes SET status = 'verified' WHERE id = ?").run(route);
    const row = (id: string, useRoutes: boolean, outcome: string, problems: string[], steps: string[], origin?: string) => ({
      id, goal: `goal ${id}`, from: 'permissions', useRoutes, problems, ...(origin ? { origin } : {}),
      result: { outcome, knownOffered: useRoutes ? [route] : [], plan: { steps: steps.map((n) => ({ target: { role: 'button', name: n }, action: { type: 'click' } })) } },
    });
    const legacy = [
      row('scope', true, 'partial', ['expected plan'], ['Actions', 'Edit permissions']), row('scope', false, 'plan', [], ['Actions', 'Copy scheme']),
      row('happy', true, 'plan', [], ['Actions']), row('happy', false, 'plan', [], ['Actions']),
    ];
    const recorded = legacy.map((r) => ({ ...r, origin: 'http://console.localhost' }));
    const other = legacy.map((r) => ({ ...r, origin: 'http://other.localhost' }));
    writeFileSync(join(root, 'eval', 'results', '2026-09-20T10-00-00.json'), JSON.stringify(legacy));
    writeFileSync(join(root, 'eval', 'results', '2026-09-21T10-00-00.json'), JSON.stringify(recorded));
    writeFileSync(join(root, 'eval', 'results', '2026-09-22T10-00-00.json'), JSON.stringify(other));
    writeFileSync(join(root, 'eval', 'results', '2026-09-23T10-00-00.json'), JSON.stringify(legacy.filter((r) => r.useRoutes)));
    process.chdir(join(root, 'service'));
    const list = comparisonsFor(db, p.id, 'http://console.localhost');
    check('9. comparisons for this product, newest first; another product\'s and one-sided runs are not', list.map((c) => c.file).join() === '2026-09-21T10-00-00.json,2026-09-20T10-00-00.json', list.map((c) => c.file).join());
    check('9. a run from before products were recorded is attributed by its routes, and says so', list[1].inferred && !list[0].inferred);
    const detail = comparisonDetail(db, p.id, '2026-09-21T10-00-00.json')!;
    check('9. worst first: the regression leads', detail.scenarios[0].id === 'scope' && detail.scenarios[0].change === 'regressed' && detail.scenarios[1].change === 'same');
    check('9. the G9 plan holds the route that was offered where it got worse', detail.g9.hold.some((h) => h.id === route));
    const edit = one(db, "SELECT id FROM screens WHERE product_id = ? AND display_name = 'Edit permissions'", p.id).id;
    const perms = one(db, "SELECT id FROM screens WHERE product_id = ? AND display_name = 'Permissions'", p.id).id;
    const split = splitFor(db, p.id, '2026-09-21T10-00-00.json', route, (key) => (key === 'permissions' ? perms : null));
    check('9. the split: both start on Permissions; with the route it goes to Edit permissions, docs only stays for Copy scheme',
      !!split && split.splitAt === perms && split.withRoute.screens.join('>') === `${perms}>${edit}` && split.docsOnly.unseen.includes('Copy scheme'), JSON.stringify(split));
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ---- 10. setup and attention ---- */
{
  const { db, p } = learned();
  const c = counts(db, p.id);
  const steps = setupSteps(`/p/${p.id}`, c, 'jira', null, 4);
  const done = (k: string) => steps.find((s) => s.key === k)!.done;
  check('10. stored facts decide each step: mapped, captured, learned', done('screens') && done('capture') && done('routes'));
  check('10. not verified while routes wait, not compared without a comparison', !done('verify') && !done('compare'));
  const att = needsAttention(`/p/${p.id}`, c, 'jira', null, 4);
  check('10. waiting routes need attention, with where to go', att.some((a) => /waiting to be verified/.test(a.text) && a.href.endsWith('/runs')));
  db.prepare('INSERT INTO transitions (product_id, install_id, episode, seq, at, source, before_hash, after_hash, action_json, received_at) SELECT product_id, install_id, episode || \'-new\', seq, at, source, before_hash, after_hash, action_json, ? FROM transitions WHERE product_id = ? LIMIT 3').run(Date.now() + 10_000, p.id);
  check('10. new actions since learning ran are pointed out', needsAttention(`/p/${p.id}`, counts(db, p.id), 'jira', null, 4).some((a) => /3 new actions since learning/.test(a.text)));
}

/* ---- 11. the map model ---- */
{
  const { db, p } = learned();
  const m = loadMap(db, p.id, `/p/${p.id}`)!;
  const name = (id: string) => m.nodes.find((n) => n.id === id)?.name;
  check('11. every screen is on the map', m.nodes.length === (one(db, 'SELECT COUNT(*) AS n FROM screens WHERE product_id = ?', p.id).n as number));
  const ps = m.nodes.find((n) => n.name === 'Project settings')!;
  const perms = m.nodes.find((n) => n.name === 'Permissions')!;
  const link = m.links.find((l) => l.from === ps.id && l.to === perms.id)!;
  check('11. a line counts distinct people, from real use', link.people === 5 && link.used);
  const r = m.routes.find((x) => x.steps.some((s) => s.text === 'Untick Edit issues for Contractors'))!;
  check('11. a route knows its screens and its steps', !!r && r.screens.map(name).join(' > ') === 'Board > Project settings > Permissions > Edit permissions', r?.screens.map(name).join(' > '));
  check('11. the start screen is the first column', m.nodes.find((n) => n.name === 'Board')!.x < ps.x);
  check('11. struggles are on the screen they happened on', m.nodes.find((n) => n.name === 'Access')!.struggles.some((s) => s.kind === 'backtrack'));
  check('11. nothing on the map was only explored', m.nodes.every((n) => !n.exploredOnly));
}

/* ---- 12. take me there ---- */
{
  const { db, p } = learned();
  const id = (n: string) => one(db, 'SELECT id FROM screens WHERE product_id = ? AND display_name = ?', p.id, n).id as string;
  const way = wayfind(db, p.id, id('Access'), id('Edit permissions'));
  check('12. the way from Access to Edit permissions goes the way people go', way.ok && way.steps.map((s) => s.target.name).join(' > ') === 'Project settings > Permissions > Actions > Edit permissions', JSON.stringify(way));
  check('12. a menu item gets its menu opened first', way.ok && way.steps[2].target.role === 'button' && way.steps[3].target.role === 'menuitem');
  check('12. every step of the way only clicks', way.ok && way.steps.every((s) => s.action.type === 'click'));
  check('12. already there is no steps', (() => { const w = wayfind(db, p.id, id('Board'), id('Board')); return w.ok && w.steps.length === 0; })());
  check('12. nowhere people have gone is refused, not guessed', !wayfind(db, p.id, id('Edit permissions'), id('Access')).ok);
  db.prepare("UPDATE edges SET action_json = json_remove(action_json, '$.target.name.text') WHERE product_id = ? AND action_json LIKE '%Project settings%'").run(p.id);
  const hidden = wayfind(db, p.id, id('Access'), id('Edit permissions'));
  check('12. a private label on the way is refused: it could not be found on the page', !hidden.ok && /private/.test(hidden.reason), JSON.stringify(hidden));
  db.prepare("UPDATE routes SET status = 'verified', label = 'Remove edit issues', title = 'Remove edit' WHERE product_id = ?").run(p.id);
  db.prepare("UPDATE routes SET status = 'held' WHERE product_id = ? AND goal_actions_json LIKE '%Remove%'").run(p.id);
  check('12. suggestions are verified routes only; held ones are not offered', suggestions(db, p.id).length === (one(db, "SELECT COUNT(*) AS n FROM routes WHERE product_id = ? AND status = 'verified'", p.id).n as number));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
