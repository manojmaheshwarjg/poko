/* Phase G on the server: who may send explored pages, what is re-checked on arrival,
   and what exploration may and may not teach the learning pipeline. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { ingestExploration, explorationsFor } from '../service/lib/explore.ts';
import { runLearning } from '../service/lib/learn/run.ts';
import { createEnrollment } from '../service/lib/enroll.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const rows = (db: any, sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as any[];
const one = (db: any, sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as any;

const ORIGIN = 'http://localhost:4502';
const L = (t: string) => ({ hash: 'x' + t.toLowerCase().replace(/\W+/g, '_'), text: t });
const nd = (role: string, t: string, extra: Record<string, unknown> = {}) => ({ role, name: L(t), region: 'chrome', ...extra });
const nav = () => ['Your work', 'Projects', 'Help'].map((t) => nd('link', t));
const obs = (path: string, heading: string, nodes: unknown[] = []) => ({
  url: ORIGIN + path, title: L('Acme'), heading: L(heading), nodes: [...nav(), nd('heading', heading), ...nodes],
});
const PAGES = {
  work: obs('/work', 'Your work', [nd('button', 'Create project')]),
  board: obs('/projects/1/board', 'Board', [nd('button', 'Create issue'), nd('button', 'Filter')]),
  settings: obs('/projects/1/settings', 'Project settings', [nd('link', 'Access'), nd('link', 'Permissions')]),
  access: obs('/projects/1/settings/access', 'Access', [nd('button', 'Add people')]),
  alerts: obs('/projects/1/settings/notifications', 'Notifications', [nd('checkbox', 'Issue created', { state: { checked: true } })]),
  alertsOff: obs('/projects/1/settings/notifications', 'Notifications', [nd('checkbox', 'Issue created', { state: { checked: false } })]),
};
let clock = 1_790_000_000_000;
let runSeq = 0;
const newRun = () => ({ id: `x_${(0xabc000 + ++runSeq).toString(16).padStart(16, '0')}`, startUrl: ORIGIN + '/work', startedAt: clock++ });
const page = (key: keyof typeof PAGES, extra: Record<string, unknown> = {}) => ({
  url: PAGES[key].url, from: ORIGIN + '/work', via: L(key), viaRegion: 'chrome', at: clock++, observation: PAGES[key], truth: key, ...extra,
});
const vendor = (id = 'install-vend-1') => ({ id, mode: 'vendor', attested: true });
const explore = (db: any, productId: string, run: any, pages: unknown[], install: any = vendor()) =>
  ingestExploration(db, { productId, install, run, pages }) as any;

/* 1. Who may explore */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, ORIGIN);
  const ok = explore(db, p.id, newRun(), [page('work')]);
  check('1. a vendor install with the no-real-data attestation is accepted', ok.accepted === 1, JSON.stringify(ok));
  const customer = explore(db, p.id, newRun(), [page('work')], { id: 'install-cust-1', mode: 'customer' });
  check('1. a customer install is refused', customer.status === 403, JSON.stringify(customer));
  const unattested = explore(db, p.id, newRun(), [page('work')], { id: 'install-vend-2', mode: 'vendor', attested: false });
  check('1. a vendor install without the attestation is refused', unattested.status === 403);
  const late = explore(db, p.id, newRun(), [page('work')], { id: 'install-vend-2', mode: 'vendor', attested: true });
  check('1. and cannot gain it later (privilege only ratchets down)', late.status === 403, JSON.stringify(late));
  ingestBatch(db, { productId: p.id, install: { id: 'install-cust-2', mode: 'customer' }, transitions: [] });
  const upgraded = explore(db, p.id, newRun(), [page('work')], { id: 'install-cust-2', mode: 'vendor', attested: true });
  check('1. nor can a customer install claim vendor mode for exploration', upgraded.status === 403);
  check('1. nothing from a refused install was stored', one(db, 'SELECT COUNT(*) AS n FROM explore_pages').n === 1);
  const r = newRun();
  explore(db, p.id, r, [page('board')]);
  const hijack = explore(db, p.id, r, [page('access')], vendor('install-vend-3'));
  check('1. a run belongs to the install that started it', hijack.status === 403, JSON.stringify(hijack));
}

/* 2. Re-checked on arrival (G4) */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, ORIGIN);
  const leaky = {
    ...PAGES.access,
    url: ORIGIN + '/projects/1/settings/access?user=ava@example.com',
    nodes: [...PAGES.access.nodes, { role: 'link', name: { hash: 'xmail', text: 'ava@example.com' }, region: 'content', value: 'typed secret', rect: { x: 1 } }],
  };
  const res = explore(db, p.id, newRun(), [page('access', { observation: leaky, url: leaky.url, via: { hash: 'xvia', text: 'ben@example.com' } })]);
  check('2. the page is accepted', res.accepted === 1, JSON.stringify(res));
  const stored = rows(db, 'SELECT json FROM observations').map((r) => r.json).join('\n');
  check('2. an email label is stored as a hash only', !stored.includes('ava@example.com') && stored.includes('xmail'));
  check('2. typed values and rects are stripped', !stored.includes('typed secret') && !stored.includes('rect'));
  check('2. the query string is gone from the observation', !stored.includes('?user'));
  const pg = one(db, 'SELECT url, via_json FROM explore_pages');
  check('2. and from the page URL', pg.url === ORIGIN + '/projects/:id/settings/access', pg.url);
  check('2. the link label is re-checked too', !pg.via_json.includes('ben@example.com') && pg.via_json.includes('xvia'), pg.via_json);
  const off = explore(db, p.id, newRun(), [page('work', { url: 'https://elsewhere.example/work' })]);
  check('2. a page on another origin is rejected', off.accepted === 0 && off.rejected[0]?.reason === 'page is not on this product', JSON.stringify(off));
  const bad = explore(db, p.id, newRun(), [{ url: ORIGIN + '/x', observation: { nodes: 'nope' } }]);
  check('2. a malformed page is rejected on its own', bad.accepted === 0 && bad.rejected.length === 1);
  const badStop = explore(db, p.id, { ...newRun(), finishedAt: clock++, stopped: 'exploded' }, []);
  check('2. an unknown stop reason is refused', badStop.status === 400);
}

/* 3. Truth only for local products; idempotent pages; the run summary */
{
  const db = openDb(':memory:');
  const local = productForOrigin(db, ORIGIN);
  const remote = productForOrigin(db, 'https://app.acme.com');
  explore(db, local.id, newRun(), [page('work')]);
  const remotePage = { ...page('work'), url: 'https://app.acme.com/work', observation: { ...PAGES.work, url: 'https://app.acme.com/work' } };
  const { code } = createEnrollment(db, remote.id);
  const rr = explore(db, remote.id, newRun(), [remotePage], { ...vendor('install-vend-remote'), enrollment: code });
  check('3. (the real product accepted the page)', rr.accepted === 1, JSON.stringify(rr));
  const truths = rows(db, 'SELECT product_id, truth FROM explore_pages');
  check('3. ground truth kept for a local product', truths.find((t) => t.product_id === local.id)?.truth === 'work');
  check('3. and dropped for a real one', truths.find((t) => t.product_id === remote.id)?.truth === null);

  const r = newRun();
  explore(db, local.id, r, [page('board')]);
  const again = explore(db, local.id, r, [page('board')]);
  check('3. a page sent twice is stored once', again.duplicate === 1 && again.accepted === 0);
  const done = explore(db, local.id, {
    ...r, finishedAt: clock++, stopped: 'done',
    skipped: [
      { url: ORIGIN + '/projects/1/delete?confirm=1', reason: 'unsafe', word: 'delete' },
      { url: ORIGIN + '/billing', reason: 'unsafe', word: 'customer-name-here' },
      { url: 'https://evil.example/path/secret', reason: 'offsite' },
      { url: 'javascript:alert(1)', reason: 'scheme' },
      { url: ORIGIN + '/x', reason: 'made-up reason' },
    ],
    failures: [{ url: ORIGIN + '/missing?token=abc', reason: 'http', status: 404 }],
  }, []);
  check('3. the finishing report is accepted', done.accepted === 0 && !done.status, JSON.stringify(done));
  const x = explorationsFor(db, local.id).find((e) => e.id === r.id)!;
  const skipped = JSON.parse(x.skipped_json);
  check('3. the run is marked finished with its stop reason and page count', x.stopped === 'done' && x.pages === 1 && !!x.finished_at);
  check('3. a refused link is kept as its pattern, never its query', skipped[0].url === ORIGIN + '/projects/:id/delete' && skipped[0].word === 'delete', JSON.stringify(skipped[0]));
  check('3. a word not on the rules list is dropped', skipped[1].word === null);
  check('3. another site is kept as its origin only', skipped[2].url === 'https://evil.example');
  check('3. a non-web link keeps no URL at all', skipped[3].url === null);
  check('3. a reason outside the rules vocabulary is dropped', skipped.length === 4);
  check('3. failures lose their query too', !x.failures_json.includes('token'), x.failures_json);
}

/* 4. What exploration teaches: screens, never routes (G6) */
{
  const click = (t: string) => ({ type: 'click', target: { role: 'link', name: L(t), within: null, region: 'chrome' } });
  const untick = { type: 'setChecked', value: false, target: { role: 'checkbox', name: L('Issue created'), within: null, region: 'chrome' } };
  /* Two people turning off one notification: enough evidence for one route. */
  const tour = (episode: string) => [
    { at: clock++, episode, seq: 0, source: 'user', before: PAGES.work, action: click('Projects'), after: PAGES.board },
    { at: clock++, episode, seq: 1, source: 'user', before: PAGES.board, action: click('Notifications'), after: PAGES.alerts },
    { at: clock++, episode, seq: 2, source: 'user', before: PAGES.alerts, action: untick, after: PAGES.alertsOff },
  ];
  const learn = (withExploration: boolean) => {
    const db = openDb(':memory:');
    const p = productForOrigin(db, ORIGIN);
    ingestBatch(db, { productId: p.id, install: { id: 'install-user-1', mode: 'vendor', attested: true }, transitions: tour('e1') });
    ingestBatch(db, { productId: p.id, install: { id: 'install-user-2', mode: 'vendor', attested: true }, transitions: tour('e2') });
    if (withExploration) explore(db, p.id, newRun(), [page('work'), page('board'), page('settings'), page('access')]);
    return { db, p, r: runLearning(db, p.id) };
  };

  const onlyExplored = (() => {
    const db = openDb(':memory:');
    const p = productForOrigin(db, ORIGIN);
    explore(db, p.id, newRun(), [page('work'), page('board'), page('settings'), page('access')]);
    return { db, p, r: runLearning(db, p.id) };
  })();
  check('4. explored pages alone become screens', onlyExplored.r.screens === 4, `screens=${onlyExplored.r.screens}`);
  check('4. all of them known only from exploring', onlyExplored.r.screensExploredOnly === 4 && onlyExplored.r.exploredOnly === 4);
  check('4. and they teach no routes, attempts, struggles or edges', onlyExplored.r.humanAttempts === 0 && onlyExplored.r.edges === 0 &&
    one(onlyExplored.db, 'SELECT COUNT(*) AS n FROM routes').n === 0 && onlyExplored.r.struggles === 0);
  check('4. their ground truth scores the clustering', onlyExplored.r.truthLabelled === 4 && onlyExplored.r.score?.precision === 1 && onlyExplored.r.score?.recall === 1,
    JSON.stringify(onlyExplored.r.score && { p: onlyExplored.r.score.precision, r: onlyExplored.r.score.recall }));

  const without = learn(false);
  const withX = learn(true);
  const routeSig = (db: any) => rows(db, 'SELECT kind, attempts, installs, status FROM routes ORDER BY kind, attempts').map((r) => `${r.kind}:${r.attempts}:${r.installs}:${r.status}`).join('|');
  check('4. (people alone produce a route to compare)', routeSig(without.db) !== '' && without.r.humanAttempts === 2, routeSig(without.db));
  check('4. with people too, exploration adds screens', withX.r.screens === without.r.screens + 2, `${without.r.screens} -> ${withX.r.screens}`);
  check('4. only the two nobody used are marked explored only', withX.r.screensExploredOnly === 2, `${withX.r.screensExploredOnly}`);
  check('4. and the routes mined from people are exactly the same', routeSig(withX.db) === routeSig(without.db) && withX.r.humanAttempts === without.r.humanAttempts,
    `${routeSig(without.db)} vs ${routeSig(withX.db)}`);
  check('4. an explored page of a screen people use joins that screen', (() => {
    const s = rows(withX.db, "SELECT s.id, COUNT(m.obs_hash) AS n FROM screens s JOIN screen_members m ON m.screen_id = s.id WHERE s.display_name = 'Board' GROUP BY s.id");
    return s.length === 1;
  })());
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
