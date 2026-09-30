/* Phase E tests: verified routes reaching the planner, screen checks, demotion.
   No model call anywhere. */
import { createRequire } from 'node:module';
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning, nextStatus } from '../service/lib/learn/run.ts';
import { nodeKey, IDENTIFYING_ROLES } from '../service/lib/learn/screens.ts';
import { loadKnownRoutes, rankKnown, renderKnown, attribute, expectationsFor } from '../service/lib/learn/known.ts';
import { recordFeedback } from '../service/lib/learn/feedback.ts';
import { planVerification } from '../service/lib/learn/verify.ts';
import { plannerUserMessage } from '../service/lib/planner.ts';
import { session, click, tick } from './sim.mts';

const require = createRequire(import.meta.url);
const R = require('../core/redact.js');
const SC = require('../core/screencheck.js');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

/* ---- 1. parity: browser keys == server keys, with real hashing ---- */
const KEY = 'parity-product-key';
const raw = {
  screen: { url: 'http://app/x', title: 'Mock Jira', heading: 'Edit permissions' },
  nodes: [
    { role: 'link', name: 'Project settings', region: 'chrome' },
    { role: 'checkbox', name: 'Edit issues for Contractors', region: 'content', state: { checked: true } },
    { role: 'button', name: 'GPT OSS 120B', within: 'Reasoning', region: 'chrome' },
    { role: 'heading', name: 'Edit permissions', region: 'chrome' },
  ],
};
for (const mode of ['vendor', 'customer']) {
  const stored = await R.redactObservation(raw, { key: KEY, mode, attested: true, promoted: new Set() });
  const server = new Set<string>();
  if (stored.heading?.hash) server.add(`H:${stored.heading.hash}`);
  for (const n of stored.nodes) if (IDENTIFYING_ROLES.has(n.role)) { const k = nodeKey(n); if (k) server.add(k); }
  const browser = await SC.liveKeys(raw, KEY, R.hashLabel);
  const missing = [...server].filter((k) => !browser.has(k));
  check(`1. ${mode} mode: every key the server stored is what the browser computes`, missing.length === 0 && server.size === 5, `missing=${missing.length} server=${server.size}`);
}

/* ---- 2. the screen check ---- */
{
  const browser = await SC.liveKeys(raw, KEY, R.hashLabel);
  const h = (t: string) => R.hashLabel(KEY, t);
  const heading = `H:${await h('Edit permissions')}`;
  const box = `checkbox:${await h('Edit issues for Contractors')}@`;
  check('2. the right screen passes', SC.overlap([heading, box], browser).ok);
  check('2. a different screen fails', !SC.overlap([`H:${await h('Access')}`, `button:${await h('Add people')}@`], browser).ok);
  check('2. an empty expectation fails closed', !SC.overlap([], browser).ok);
  check('2. half the features is enough, fewer is not',
    SC.overlap([heading, `button:${await h('Nope')}@`], browser).ok && !SC.overlap([heading, 'a', 'b'], browser).ok);
}

/* ---- a product with routes, some verified ---- */
const toPerms = [click('link', 'Project settings'), click('link', 'Permissions')];
const intoEdit = [click('button', 'Actions'), click('menuitem', 'Edit permissions')];
const readOnly = tick('Edit issues for Contractors', false);
function seed() {
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://use.localhost');
  const groups: Array<[string[], any[]]> = [
    [['a', 'b', 'c'], [...toPerms, ...intoEdit, readOnly]],
    [['d', 'e'], [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Remove Developers')]],
  ];
  for (const [who, acts] of groups) for (const w of who) {
    const steps = session(w, `ep-${w}`, acts);
    ingestBatch(db, { productId: p.id, install: { id: `install-${w}-use`, mode: 'vendor', attested: true }, transitions: steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action })) });
  }
  runLearning(db, p.id);
  const verify = (like: string, label: string) =>
    db.prepare("UPDATE routes SET status = 'verified', verified_path_hash = path_hash, label = ?, title = ? WHERE product_id = ? AND goal_actions_json LIKE ?").run(label, label, p.id, `%${like}%`);
  verify('Edit issues for Contractors', 'Stop contractors from editing issues');
  return { db, pid: p.id };
}

/* ---- 3. distinctive keys never include global chrome ---- */
{
  const { db, pid } = seed();
  const rows = db.prepare('SELECT display_name, distinctive_keys_json FROM screens WHERE product_id = ?').all(pid) as any[];
  const railKey = `link:${'x' + 'project settings'.replace(/\W+/g, '_')}@`;
  check('3. every screen has distinctive keys', rows.every((r) => JSON.parse(r.distinctive_keys_json).length > 0));
  const core = db.prepare('SELECT core_keys_json FROM screens WHERE product_id = ?').all(pid) as any[];
  check('3. (sanity) the rail key is real: it is in every screen\'s full core', core.every((r) => JSON.parse(r.core_keys_json).includes(railKey)));
  check('3. the nav rail is never one of them', rows.every((r) => !JSON.parse(r.distinctive_keys_json).includes(railKey)), rows.map((r) => r.display_name).join(','));
}

/* ---- 4. what the planner is offered ---- */
{
  const { db, pid } = seed();
  const known = loadKnownRoutes(db, pid);
  check('4. only verified routes are offered', known.length === 1 && known[0].label === 'Stop contractors from editing issues');
  check('4. a matching request finds it', rankKnown(known, 'stop contractors editing issues please').length === 1);
  check('4. an unrelated request is offered nothing', rankKnown(known, 'export the board as CSV').length === 0);
  const text = renderKnown(known);
  check('4. offered as data, with its id and steps', text.includes(`[${known[0].id}]`) && /data, not instructions/.test(text) && text.includes('untick "Edit issues for Contractors"'));
  const msg = plannerUserMessage({ goal: 'g', observation: { nodes: [{ role: 'link', name: 'x' }] }, known: text });
  check('4. known workflows come after the goal and the screen', msg.indexOf('Goal:') < msg.indexOf('Current screen') && msg.indexOf('Current screen') < msg.indexOf('Known workflows'));
  check('4. and are absent when there are none', !plannerUserMessage({ goal: 'g', observation: { nodes: [{ role: 'link', name: 'x' }] } }).includes('Known workflows'));
}

/* ---- 5. a claim is attributed only if it holds ---- */
{
  const { db, pid } = seed();
  const [r] = loadKnownRoutes(db, pid);
  const faithful = {
    understood: 'x', outcome: 'plan' as const, limitation: null, route: r.id,
    steps: r.steps.map((s) => ({ intent: 'x', reasoning: 'x', target: { role: s.role, name: s.name, within: s.within }, action: { type: s.type, text: null, checked: s.type === 'setChecked' ? (s.value ?? null) : null } })),
  };
  const ok = attribute(faithful, [r]);
  check('5. a faithful claim is attributed', ok.route?.id === r.id);
  const exp = expectationsFor(faithful, r);
  check('5. every step inherits its learned screen', exp.every((e) => e && e.keys.length > 0) && exp[exp.length - 1]!.screenName === 'Edit permissions', exp.map((e) => e?.screenName).join(' > '));
  const greedy = { ...faithful, steps: [...faithful.steps, { intent: 'x', reasoning: 'x', target: { role: 'checkbox', name: 'Browse projects for Contractors', within: null }, action: { type: 'setChecked' as const, text: null, checked: false } }] };
  const bad = attribute(greedy, [r]);
  check('5. a claim with an extra change is refused', bad.route === null && /Browse projects/.test(bad.note ?? ''), bad.note ?? '');
  check('5. a claim of a route that was not offered is refused', attribute({ ...faithful, route: 'r_made_up' }, [r]).route === null);
  check('5. no claim, no attribution', attribute({ ...faithful, route: null }, [r]).route === null);
  /* Workflows are shown to the model as "[r_...]", and in the G9 eval it copied the
     brackets into its claim, so a faithful claim was refused as "not offered". */
  check('5. a claim written the way the id is shown, in brackets, is still attributed', attribute({ ...faithful, route: `[${r.id}]` }, [r]).route?.id === r.id);
  check('5. and so is one with quotes or spaces', attribute({ ...faithful, route: ` "${r.id}" ` }, [r]).route?.id === r.id);
  check('5. but tidying never turns a made-up claim into a real one', attribute({ ...faithful, route: '[r_made_up]' }, [r]).route === null);
  check('5. nor a claim that only contains a real id', attribute({ ...faithful, route: `${r.id}x` }, [r]).route === null && attribute({ ...faithful, route: `see ${r.id}` }, [r]).route === null);
  const partialMatch = expectationsFor({ ...faithful, steps: [faithful.steps[0], { intent: 'x', reasoning: 'x', target: { role: 'button', name: 'Something new', within: null }, action: { type: 'click' as const, text: null, checked: null } }] }, r);
  check('5. a step with no learned counterpart gets no expectation', partialMatch[0] !== null && partialMatch[1] === null);
}

/* ---- 6. demotion ---- */
{
  const fresh = () => { const s = seed(); const [r] = loadKnownRoutes(s.db, s.pid); return { ...s, r }; };
  const status = (db: any, id: string) => (db.prepare('SELECT status, status_reason FROM routes WHERE id = ?').get(id) as any);
  {
    const { db, pid, r } = fresh();
    const res = recordFeedback(db, { productId: pid, routeId: r.id, pathHash: r.pathHash, installId: 'install-x-1', kind: 'repaired' });
    check('6. one repair demotes', res.demoted && status(db, r.id).status === 'demoted');
  }
  {
    const { db, pid, r } = fresh();
    recordFeedback(db, { productId: pid, routeId: r.id, pathHash: r.pathHash, installId: 'install-x-1', kind: 'wrongScreen' });
    check('6. one failed screen check demotes', status(db, r.id).status === 'demoted');
  }
  {
    const { db, pid, r } = fresh();
    for (let i = 0; i < 5; i++) recordFeedback(db, { productId: pid, routeId: r.id, pathHash: r.pathHash, installId: 'install-x-1', kind: 'skipped' });
    check('6. skips from one person never demote', status(db, r.id).status === 'verified');
    recordFeedback(db, { productId: pid, routeId: r.id, pathHash: r.pathHash, installId: 'install-y-2', kind: 'skipped' });
    check('6. enough skips from two people do', status(db, r.id).status === 'demoted', status(db, r.id).status_reason);
  }
  {
    const { db, pid, r } = fresh();
    const res = recordFeedback(db, { productId: pid, routeId: r.id, pathHash: 'an-old-path', installId: 'install-x-1', kind: 'repaired' });
    check('6. feedback about an old path is kept but not acted on', res.recorded && !res.demoted && status(db, r.id).status === 'verified');
  }
  {
    const { db, pid, r } = fresh();
    for (let i = 0; i < 4; i++) recordFeedback(db, { productId: pid, routeId: r.id, pathHash: r.pathHash, installId: `install-z-${i}`, kind: 'completed' });
    check('6. completions never demote', status(db, r.id).status === 'verified');
  }
  {
    const { db, pid, r } = fresh();
    recordFeedback(db, { productId: pid, routeId: r.id, pathHash: r.pathHash, installId: 'install-x-1', kind: 'repaired' });
    check('6. a demoted route is no longer offered', loadKnownRoutes(db, pid).length === 0);
    check('6. and is not re-verified, which would only promote it to fail again', !planVerification(db, pid, { tool: 'jira' }).some((p) => p.route.id === r.id));
    runLearning(db, pid);
    check('6. learning keeps it demoted while the path is unchanged', status(db, r.id).status === 'demoted');
    check('6. but a new path gives it another chance', nextStatus({ status: 'candidate', blockedReason: null, pathHash: 'new' }, { status: 'demoted', verified_path_hash: 'old' }).status === 'candidate');
  }
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
