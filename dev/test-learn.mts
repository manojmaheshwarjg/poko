/* Learning pipeline tests: ingest -> cluster -> ids -> graph -> persist, through the
   real code paths on an in-memory database. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning } from '../service/lib/learn/run.ts';
import { createEnrollment } from '../service/lib/enroll.ts';
import { assignIds } from '../service/lib/learn/ids.ts';
import { buildGraph } from '../service/lib/learn/graph.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

/* ---- a small product: four screens and a tour through them ---- */
const L = (t: string) => ({ hash: 'x' + t.toLowerCase().replace(/\W+/g, '_'), text: t });
const nd = (role: string, t: string, extra: Record<string, unknown> = {}) => ({ role, name: L(t), region: 'chrome', ...extra });
const rail = () => ['Home', 'Reports', 'Settings'].map((t) => nd('link', t));
const screen = (heading: string, nodes: unknown[]) => ({ url: 'http://localhost:4500/app', title: L('App'), heading: L(heading), nodes: [...rail(), nd('heading', heading), ...nodes] });
const S = {
  home: screen('Home', [nd('button', 'New report')]),
  reports: screen('Reports', [nd('button', 'Export'), nd('button', 'Filter')]),
  reportsMenu: screen('Reports', [nd('button', 'Export'), nd('button', 'Filter'), nd('menuitem', 'CSV'), nd('menuitem', 'PDF')]),
  settings: screen('Settings', [nd('checkbox', 'Email alerts', { state: { checked: true } })]),
  settingsOff: screen('Settings', [nd('checkbox', 'Email alerts', { state: { checked: false } })]),
};
const click = (t: string, role = 'link') => ({ type: 'click', target: { role, name: L(t), within: null, region: 'chrome' } });
const tour: Array<[keyof typeof S, ReturnType<typeof click> | object, keyof typeof S, string, string]> = [
  ['home', click('Reports'), 'reports', 'home', 'reports'],
  ['reports', click('Export', 'button'), 'reportsMenu', 'reports', 'reports'],
  ['reportsMenu', click('Settings'), 'settings', 'reports', 'settings'],
  ['settings', { type: 'setChecked', value: false, target: { role: 'checkbox', name: L('Email alerts'), within: null, region: 'chrome' } }, 'settingsOff', 'settings', 'settings'],
  ['settingsOff', click('Home'), 'home', 'settings', 'home'],
];
let clock = 1_790_000_000_000;
const transitions = (episode: string, source = 'user', withTruth = true) =>
  tour.map(([b, action, a, tb, ta], seq) => ({
    at: clock++, episode, seq, source, before: S[b], after: S[a], action,
    ...(withTruth ? { truth: { before: tb, after: ta } } : {}),
  }));
const send = (db: any, productId: string, id: string, list: unknown[], mode = 'vendor') =>
  ingestBatch(db, { productId, install: { id, mode, attested: true }, transitions: list });
const rows = (db: any, sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as any[];

/* 1. End to end */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://localhost:4500');
  send(db, p.id, 'install-aaaa-1', transitions('ep1'));
  send(db, p.id, 'install-aaaa-1', transitions('ep2', 'copilot'));
  const r = runLearning(db, p.id);
  check('1. three screens found: the open menu and the unticked box fold into their screens', r.screens === 3, `screens=${r.screens}`);
  check('1. scored against ground truth with no merges', r.score?.precision === 1, JSON.stringify(r.score && { p: r.score.precision, r: r.score.recall }));
  check('1. and no splits', r.score?.recall === 1);
  check('1. every transition placed on a screen', r.unplaced === 0);
  const edges = rows(db, 'SELECT * FROM edges WHERE product_id = ?', p.id);
  check('1. five distinct edges', edges.length === 5, `edges=${edges.length}`);
  check('1. human and copilot evidence counted separately (G6)', edges.every((e) => e.users === 1 && e.copilot === 1));
  const names = rows(db, 'SELECT display_name FROM screens').map((x) => x.display_name).sort().join('|');
  check('1. screens named from their headings', names === 'Home|Reports|Settings', names);
}

/* 2. Idempotent: re-running with no new data changes nothing */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://localhost:4500');
  send(db, p.id, 'install-bbbb-1', transitions('ep1'));
  runLearning(db, p.id);
  const snap = () => JSON.stringify([rows(db, 'SELECT id, display_name, count FROM screens ORDER BY id'), rows(db, 'SELECT * FROM edges ORDER BY from_screen, action_key')]);
  const first = snap();
  const again = runLearning(db, p.id);
  check('2. a second run with nothing new is identical', snap() === first);
  check('2. and keeps every id', again.idsKept === again.screens && again.idsNew === 0);
}

/* 3. Ids survive new data */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://localhost:4500');
  send(db, p.id, 'install-cccc-1', transitions('ep1'));
  runLearning(db, p.id);
  const before = new Map(rows(db, 'SELECT id, display_name FROM screens').map((x) => [x.display_name, x.id]));
  const extra = { ...S.reports, nodes: [...S.reports.nodes, nd('button', 'Share')] };
  send(db, p.id, 'install-cccc-1', [{ at: clock++, episode: 'ep9', seq: 0, source: 'user', before: S.home, after: extra, action: click('Reports'), truth: { before: 'home', after: 'reports' } }]);
  runLearning(db, p.id);
  const after = new Map(rows(db, 'SELECT id, display_name FROM screens').map((x) => [x.display_name, x.id]));
  check('3. existing screens keep their ids when new observations arrive', [...before].every(([name, id]) => after.get(name) === id), JSON.stringify([...before, '->', ...after]));
}

/* 4. ids unit cases */
{
  const prior = new Map([['s_old', new Set(['a', 'b', 'c', 'd'])]]);
  const split = assignIds([{ key: 'k1', members: ['a', 'b', 'c'] }, { key: 'k2', members: ['d'] }], prior);
  check('4. on a split, the larger part keeps the id', split.get('k1') === 's_old' && split.get('k2') !== 's_old');
  const unrelated = assignIds([{ key: 'k', members: ['x', 'y'] }], prior);
  check('4. an unrelated screen gets a fresh id', unrelated.get('k') !== 's_old');
  const det = assignIds([{ key: 'k', members: ['x', 'y'] }], new Map()).get('k') === assignIds([{ key: 'k', members: ['y', 'x'] }], new Map()).get('k');
  check('4. fresh ids are deterministic', det);
}

/* 5. graph unit cases */
{
  const g = buildGraph(
    [
      { beforeHash: 'a', afterHash: 'b', source: 'user', at: 1, action: { type: 'click', target: { role: 'link', name: { hash: 'h' } } } as any },
      { beforeHash: 'a', afterHash: 'b', source: 'user', at: 2, action: { type: 'click', target: { role: 'link', name: { hash: 'h', text: 'Go' } } } as any },
      { beforeHash: 'a', afterHash: 'zz', source: 'user', at: 3, action: { type: 'click', target: { role: 'link', name: { hash: 'h' } } } as any },
    ],
    new Map([['a', 'S1'], ['b', 'S2']])
  );
  check('5. repeated transitions fold into one edge', g.edges.length === 1 && g.edges[0].users === 2);
  check('5. the example with clear text is kept', g.edges[0].action.target.name?.text === 'Go');
  check('5. a transition with no screen is counted, not silently dropped', g.unplaced === 1);
}

/* 6. Ground truth is a test instrument, never a leak */
{
  const db = openDb(':memory:');
  const local = productForOrigin(db, 'http://localhost:4500');
  const remote = productForOrigin(db, 'https://app.acme.com');
  send(db, local.id, 'install-dddd-1', transitions('ep1'));
  /* A vendor install of a real product must enroll (Phase M), or nothing would be stored
     and the check below would pass for the wrong reason. */
  const { code } = createEnrollment(db, remote.id);
  const sent = ingestBatch(db, { productId: remote.id, install: { id: 'install-eeee-1', mode: 'vendor', attested: true, enrollment: code }, transitions: transitions('ep1') }) as any;
  check('6. (the real product accepted the transitions)', sent.accepted === 5, JSON.stringify(sent));
  const truthFor = (pid: string) => rows(db, 'SELECT COUNT(*) AS n FROM dev_truth WHERE product_id = ?', pid)[0].n;
  check('6. truth stored for a localhost product', truthFor(local.id) === 5);
  check('6. truth refused for a real product, whatever the client sends', truthFor(remote.id) === 0);
  const obsJson = rows(db, 'SELECT json FROM observations').map((x) => x.json).join('');
  check('6. truth never written inside an observation', !obsJson.includes('"truth"') && !obsJson.includes('"before":"home"'));
}

/* 7. A failed run leaves the previous good run in place */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://localhost:4500');
  send(db, p.id, 'install-ffff-1', transitions('ep1'));
  runLearning(db, p.id);
  const good = rows(db, 'SELECT COUNT(*) AS n FROM screens')[0].n;
  db.exec('DROP TABLE learn_runs');
  let threw = false;
  try {
    runLearning(db, p.id);
  } catch {
    threw = true;
  }
  check('7. a failing run reports the failure', threw);
  check('7. and the last good screens are still there', rows(db, 'SELECT COUNT(*) AS n FROM screens')[0].n === good, `screens=${rows(db, 'SELECT COUNT(*) AS n FROM screens')[0].n}`);
}

/* 8. Decay: evidence older than the window stops producing routes */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'http://localhost:4500');
  send(db, p.id, 'install-gggg-1', transitions('ep1', 'user', false));
  send(db, p.id, 'install-gggg-2', transitions('ep2', 'user', false));
  const last = clock;
  const day = 86_400_000;
  const live = (id: string) => rows(db, "SELECT COUNT(*) AS n FROM routes WHERE product_id = ? AND status != 'stale'", id)[0].n;
  const fresh = runLearning(db, p.id, { now: last + day, windowDays: 90 });
  check('8. recent evidence produces routes', live(p.id) > 0 && fresh.decayed === 0, `routes=${live(p.id)}`);
  const old = runLearning(db, p.id, { now: last + 200 * day, windowDays: 90 });
  check('8. evidence older than the window no longer counts', old.decayed === 10 && old.edges === 0 && old.humanAttempts === 0, JSON.stringify({ decayed: old.decayed, edges: old.edges }));
  check('8. its routes go stale, so they are no longer offered', live(p.id) === 0 && rows(db, 'SELECT status_reason FROM routes WHERE product_id = ?', p.id).every((r) => /older than 90 days/.test(r.status_reason)));
  check('8. the screens themselves are kept', old.screens === fresh.screens);
  runLearning(db, p.id, { now: last + day, windowDays: 90 });
  check('8. evidence back inside the window counts again', live(p.id) > 0);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
