/* Phase L: copilot decisions as learning signals. What leaves the browser, what the
   server keeps, and where they show up as struggles. */
import { createRequire } from 'node:module';
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { ingestDecisions } from '../service/lib/decisions.ts';
import { runLearning } from '../service/lib/learn/run.ts';
import { session, click, tick } from './sim.mts';
const require = createRequire(import.meta.url);
const redact = require('../core/redact.js');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const rows = (db: any, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as any[];

/* A journal entry, as the runner writes it. */
const entry = (over: Record<string, unknown> = {}) => ({
  at: 1_790_000_000_000, runId: 'run-1', route: null, tool: 'jira',
  goal: 'let ava@example.com stop editing issues', intent: 'Untick Edit issues for Ava', reasoning: 'because Ava asked on 2026-01-02',
  stepId: 's3', plannedTarget: { role: 'checkbox', name: 'Edit issues for Contractors', within: 'Permissions' },
  action: { type: 'setChecked', value: false }, locatedAs: { role: 'checkbox', name: 'Edit issues for Contractors', state: { checked: true } },
  screen: { url: 'http://g.localhost/projects/42/settings?tab=x', heading: 'Edit permissions' },
  decision: 'skipped', ok: undefined, note: 'free text a person might have typed', ...over,
});

/* ---- 1. what leaves the browser ---- */
{
  const opts = { key: 'k', mode: 'vendor', attested: true, promoted: new Set() };
  const d = await redact.redactDecision(entry(), opts);
  const text = JSON.stringify(d);
  check('1. the goal, intent, reasoning and note never leave', !/ava@example|Untick Edit issues for Ava|because Ava|free text/.test(text), text);
  check('1. the URL is normalised: no query, no ids', d.url === 'http://g.localhost/projects/:id/settings');
  check('1. labels are redacted like any other (hash always, clear text when allowed)', !!d.planned.name.hash && d.planned.name.text === 'Edit issues for Contractors');
  check('1. a checkbox keeps its intended state, nothing else', d.action.type === 'setChecked' && d.action.value === false);
  const customer = await redact.redactDecision(entry(), { ...opts, mode: 'customer', attested: false });
  check('1. in customer mode a label nobody else has seen is a hash only', !customer.planned.name.text && !!customer.planned.name.hash);
  check('1. an approval that failed is a failure', (await redact.redactDecision(entry({ decision: 'approved', ok: false }), opts)).kind === 'failed');
  check('1. an unknown kind is not sent at all', (await redact.redactDecision(entry({ decision: 'whatever' }), opts)) === null);
}

/* ---- a product with screens to place decisions on ---- */
function seed() {
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://decisions.localhost');
  const acts = [click('link', 'Project settings'), click('link', 'Permissions'), click('button', 'Actions'), click('menuitem', 'Edit permissions'), tick('Edit issues for Contractors', false)];
  for (const w of ['a', 'b']) {
    const steps = session(w, `ep-${w}`, acts);
    ingestBatch(db, { productId: p.id, install: { id: `install-${w}-dec`, mode: 'vendor', attested: true }, transitions: steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action })) });
  }
  runLearning(db, p.id);
  /* The Edit permissions page as the recorder stored it: its URL and heading hash. */
  const page = rows(db, 'SELECT o.json FROM observations o').map((r) => JSON.parse(r.json)).find((o) => o.heading?.text === 'Edit permissions');
  return { db, pid: p.id, page };
}
const stored = (page: any, over: Record<string, unknown> = {}) => ({
  at: Date.now(), runId: 'run-1', stepId: 's3', kind: 'skipped', url: page.url, heading: page.heading,
  planned: { role: 'checkbox', name: { hash: 'hx', text: 'Edit issues for Contractors' }, within: null },
  located: { role: 'checkbox', name: { hash: 'hx', text: 'Edit issues for Contractors' } },
  action: { type: 'setChecked', value: false }, route: null, ...over,
});

/* ---- 2. what the server keeps ---- */
{
  const { db, pid, page } = seed();
  const send = (install: any, decisions: unknown[]) => ingestDecisions(db, { productId: pid, install, decisions }) as any;
  const r = send({ id: 'install-cust-dec', mode: 'customer' }, [stored(page, { goal: 'sneaky', intent: 'sneaky' }), stored(page, { kind: 'invented' })]);
  check('2. a customer decision is accepted; an unknown kind is rejected on its own', r.accepted === 1 && r.rejected.length === 1, JSON.stringify(r));
  const kept = rows(db, 'SELECT * FROM decisions')[0];
  check('2. clear text a customer install may not send is stripped (G4)', !kept.planned_json.includes('Edit issues for Contractors') && kept.planned_json.includes('hx'), kept.planned_json);
  check('2. fields that have no place in a decision are dropped', !JSON.stringify(kept).includes('sneaky'));
  check('2. a decision sent twice is stored once', send({ id: 'install-cust-dec', mode: 'customer' }, [stored(page, { at: kept.at })]).duplicate === 1);
}

/* ---- 3. where they show up ---- */
{
  const { db, pid, page } = seed();
  const send = (install: string, over: Record<string, unknown>) => ingestDecisions(db, { productId: pid, install: { id: install, mode: 'vendor', attested: true }, decisions: [stored(page, over)] });
  send('install-x-dec', { kind: 'skipped', runId: 'r1' });
  send('install-y-dec', { kind: 'skipped', runId: 'r2' });
  send('install-y-dec', { kind: 'repaired', runId: 'r3' });
  send('install-y-dec', { kind: 'approved', runId: 'r4' });
  send('install-z-dec', { kind: 'skipped', runId: 'r5', url: 'http://decisions.localhost/nowhere' });
  send('install-z-dec', { kind: 'skipped', runId: 'r6', at: Date.now() - 400 * 86_400_000 });
  const run = runLearning(db, pid);
  const s = rows(db, "SELECT s.kind, s.attempts, s.installs, sc.display_name FROM struggles s JOIN screens sc ON sc.id = s.screen_id WHERE s.kind LIKE 'copilot%' ORDER BY s.kind");
  const rejected = s.find((x) => x.kind === 'copilotRejected');
  check('3. rejections become a struggle on the screen they happened on', rejected?.display_name === 'Edit permissions' && rejected.attempts === 2 && rejected.installs === 2, JSON.stringify(s));
  check('3. a repair is a miss', s.some((x) => x.kind === 'copilotMissed' && x.attempts === 1));
  check('3. an approval that worked is not a struggle', s.length === 2);
  check('3. a decision on a page no screen matches is counted, not guessed at', run.copilotUnplaced === 1);
  check('3. a decision older than the decay window no longer counts', run.copilotDecisions === 5, `decisions=${run.copilotDecisions}`);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
