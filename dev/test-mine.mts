/* Mining tests on simulated human sessions. Each persona is a kind of behaviour
   with a known right answer: what route it is evidence for, and what struggle it
   should reveal. */
import { buildAttempts, mineRoutes, aggregateStruggles, classifyEffect, type Step } from '../service/lib/learn/mine.ts';
import { session, click, tick } from './sim.mts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const toPerms = [click('link', 'Project settings'), click('link', 'Permissions')];
const intoEdit = [click('button', 'Actions'), click('menuitem', 'Edit permissions')];
const readOnly = tick('Edit issues for Contractors', false);

const personas = {
  /* Knows exactly where to go. */
  efficient: () => [...toPerms, ...intoEdit, readOnly],
  /* Goes to Access first, the classic wrong turn, then opens the menu and closes it
     again before finding the way. Same task, messier path. */
  lost: () => [click('link', 'Project settings'), click('link', 'Access'), click('link', 'Project settings'), click('link', 'Permissions'),
    click('button', 'Actions'), click('button', 'Actions'), ...intoEdit, readOnly],
  /* Unticks the wrong box, notices, puts it back, then does the right one. */
  mistake: () => [...toPerms, ...intoEdit, tick('Browse projects for Contractors', false), tick('Browse projects for Contractors', true), readOnly],
  /* Two changes that belong to one task. */
  swap: () => [...toPerms, ...intoEdit, readOnly, tick('Delete issues for Contractors', true)],
  /* Only wants to look at the permission table. */
  reader: () => toPerms,
  /* Circles through settings and gives up. */
  abandoner: () => [click('link', 'Project settings'), click('link', 'Notifications'), click('link', 'Project settings'), click('link', 'Access'),
    click('link', 'Project settings'), click('link', 'Notifications')],
  /* Clicks a button that does nothing, twice, then does something else. */
  deadClicker: () => [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Add people'), click('button', 'Add people'), click('button', 'Remove Developers')],
};

function world(extra: { copilotOnly?: number } = {}): Step[] {
  const s: Step[] = [];
  ['u1', 'u2', 'u3'].forEach((u) => s.push(...session(u, 'e-eff', personas.efficient())));
  ['u4', 'u5'].forEach((u) => s.push(...session(u, 'e-lost', personas.lost())));
  s.push(...session('u6', 'e-mis', personas.mistake()));
  ['u7', 'u8'].forEach((u) => s.push(...session(u, 'e-swap', personas.swap())));
  ['u9', 'u10'].forEach((u) => s.push(...session(u, 'e-read', personas.reader())));
  s.push(...session('u11', 'e-aband', personas.abandoner()));
  ['u12', 'u13'].forEach((u) => s.push(...session(u, 'e-dead', personas.deadClicker())));
  /* The same efficient route, driven by the copilot. Must count for nothing. */
  for (let i = 0; i < (extra.copilotOnly ?? 0); i++) s.push(...session(`c${i}`, 'e-cop', personas.efficient(), { source: 'copilot' }));
  return s;
}

const routeFor = (routes: ReturnType<typeof mineRoutes>, screen: string, actionName: RegExp) =>
  routes.find((r) => r.goal.screen === screen && r.goalActions.length === 1 && actionName.test(r.goalActions[0].target.name?.text ?? '') && r.kind === 'effect');

/* 1. Effects come from the diff, not from action names */
{
  const s = session('x', 'e', [...toPerms, click('button', 'Actions'), click('button', 'Actions'), click('button', 'Actions'), click('menuitem', 'Edit permissions'), readOnly]);
  const got = s.map(classifyEffect).join(',');
  check('1. navigate, open, close, mutate all read from what changed', got === 'navigate,navigate,open,close,open,navigate,mutate', got);
  const dead = session('x', 'e', [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Add people')]);
  check('1. a click that changes nothing is a dead click', classifyEffect(dead[2]) === 'none');
  const rm = session('x', 'e', [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Remove Contractors')]);
  check('1. removing a row is a change to the product', classifyEffect(rm[2]) === 'mutate');
}

const steps = world({ copilotOnly: 5 });
const attempts = buildAttempts(steps);
const routes = mineRoutes(attempts);
const struggles = aggregateStruggles(attempts);

/* 2. The main route is found, and messy paths count as evidence for it */
{
  const r = routeFor(routes, 'edit', /^Edit issues for Contractors$/);
  check('2. "untick Edit issues for Contractors" is a candidate route', !!r && r.status === 'candidate', r ? `${r.status} ${r.blockedReason ?? ''}` : 'missing');
  check('2. efficient, lost and mistaken attempts all count toward it', r?.attempts === 6, `attempts=${r?.attempts}`);
  check('2. from six different people', r?.installs === 6);
  const path = r?.path.map((p) => `${p.screen}:${p.action.target.name?.text}`).join(' > ');
  check('2. canonical path is the clean one, not the lost one',
    path === 'board:Project settings > ps:Permissions > perms:Actions > perms:Edit permissions > edit:Edit issues for Contractors', path);
  check('2. the wrong turn and the peek were cut, so every attempt collapsed onto one path', r?.variants.length === 1, `variants=${r?.variants.length}`);
}

/* 3. G6: the copilot's own sessions add nothing */
{
  const r = routeFor(routes, 'edit', /^Edit issues for Contractors$/);
  check('3. five copilot sessions of the same route added zero support', r?.attempts === 6);
  const onlyCopilot = mineRoutes(buildAttempts(Array.from({ length: 5 }, (_, i) => session(`c${i}`, 'e', personas.efficient(), { source: 'copilot' })).flat()));
  check('3. copilot-only data yields no routes at all', onlyCopilot.length === 0);
  const mid = session('u', 'e', personas.efficient(), { copilotAt: [2] });
  const pieces = buildAttempts(mid);
  check('3. a copilot step splits a human session; no attempt spans it', pieces.every((a) => a.steps.every((s) => s.source === 'user')) && pieces.length === 2, `attempts=${pieces.length}`);
}

/* 4. Two changes in one task are one route */
{
  const r = routes.find((x) => x.goalActions.length === 2);
  const names = r?.goalActions.map((a) => `${a.value ? 'tick' : 'untick'} ${a.target.name?.text}`).sort().join(' + ');
  check('4. the swap is its own two-change route', names === 'tick Delete issues for Contractors + untick Edit issues for Contractors', names);
  check('4. with support from both people who did it', r?.attempts === 2 && r.status === 'candidate');
}

/* 5. Looking without changing is a destination */
{
  const r = routes.find((x) => x.kind === 'destination' && x.goal.screen === 'perms');
  check('5. "get to Permissions" found as a destination route', !!r && r.attempts === 2, `attempts=${r?.attempts}`);
}

/* 6. Struggle points are where they should be */
{
  const find = (kind: string, screen: string, name?: RegExp) =>
    struggles.find((s) => s.kind === kind && s.screen === screen && (!name || name.test(s.action?.target.name?.text ?? '')));
  const back = find('backtrack', 'access');
  const topBacktrack = struggles.filter((s) => s.kind === 'backtrack').sort((a, b) => b.attempts - a.attempts)[0];
  check('6. going to Access by mistake is the top wrong turn', !!back && topBacktrack?.screen === 'access' && back.attempts === 3,
    JSON.stringify({ top: topBacktrack?.screen, attempts: back?.attempts }));
  check('6. opening the Actions menu and closing it again is a peek', !!find('peek', 'perms', /^Actions$/));
  check('6. unticking the wrong box and putting it back is an undo', !!find('undo', 'edit', /^Browse projects for Contractors$/));
  const dead = find('deadClick', 'access', /^Add people$/);
  check('6. the button that does nothing shows up as dead clicks', !!dead && dead.attempts === 2);
  check('6. circling back to settings three times is a loop', !!find('loop', 'ps'));
  check('6. circling and leaving with nothing done is an abandon', !!find('abandon', 'notif'));
  const efficientSignals = attempts.filter((a) => ['u1', 'u2', 'u3'].includes(a.install)).flatMap((a) => a.signals);
  check('6. the efficient people produced no struggle at all', efficientSignals.length === 0, JSON.stringify(efficientSignals.map((x) => x.kind)));
  const lostSignals = attempts.filter((a) => a.install === 'u4').flatMap((a) => a.signals.map((x) => x.kind)).sort().join(',');
  check('6. and a lost person produced exactly a wrong turn and a peek', lostSignals === 'backtrack,peek', lostSignals);
}

/* 6b. Dead clicks are cut from the route itself, not just reported. Otherwise the
       copilot would later suggest clicking a button that does nothing. */
{
  const rm = routes.find((r) => r.goal.screen === 'access');
  const path = rm?.path.map((p) => p.action.target.name?.text).join(' > ');
  check('6b. the dead-click route is clean: no "Add people" in it', path === 'Project settings > Access > Remove Developers', path);
}

/* 7. Fail-safes on promotion */
{
  const blockedAmb = mineRoutes(attempts, { ambiguousScreens: new Set(['access']) });
  const rm = blockedAmb.find((r) => r.goal.screen === 'access');
  check('7. a route through an ambiguous screen is blocked', rm?.status === 'blocked' && /cannot be told apart/.test(rm.blockedReason ?? ''), rm?.blockedReason ?? 'missing');
  const strict = mineRoutes(attempts, { minSupport: 10 });
  check('7. too little evidence blocks every route, with the reason stated', strict.every((r) => r.status === 'blocked' && /needs 10/.test(r.blockedReason ?? '')));
  const single = mineRoutes(buildAttempts(session('solo', 'e', personas.efficient())));
  check('7. one person doing something once is not a route yet', single.every((r) => r.status === 'blocked'));
}

/* 8. A long pause splits an attempt; the second half joins the same goal as a shorter variant */
{
  const paused = session('p1', 'e-pause', personas.efficient(), { pauses: { 2: 300 } });
  const r = routeFor(mineRoutes(buildAttempts([...steps, ...paused])), 'edit', /^Edit issues for Contractors$/);
  check('8. the resumed half counts toward the same route', r?.attempts === 7, `attempts=${r?.attempts}`);
  check('8. as a variant that starts on Permissions', !!r?.variants.some((v) => v.start === 'perms'), JSON.stringify(r?.variants));
  check('8. while the path most people took stays canonical', r?.path[0].screen === 'board' && r.variants[0].attempts === 6,
    `canonical starts on ${r?.path[0].screen}`);
}

/* 9. Determinism */
{
  const a = JSON.stringify(mineRoutes(buildAttempts(steps)).map((r) => [r.id, r.attempts, r.pathHash]));
  const b = JSON.stringify(mineRoutes(buildAttempts([...steps].reverse())).map((r) => [r.id, r.attempts, r.pathHash]));
  check('9. the same sessions in any order mine the same routes', a === b);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
