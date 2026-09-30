/* Ingest tests, run straight from TypeScript with no build step.
   Several play a buggy or hostile client: G4 only means something if the server
   holds when the browser gets it wrong. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin, promotedLabels } from '../service/lib/ingest.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const lbl = (hash: string, text?: string) => (text === undefined ? { hash } : { hash, text });
const obs = (heading: string, nodes: unknown[], url = 'http://localhost:4500/fixture/jira-mock.html') => ({
  url, title: lbl('t0', 'Mock Jira'), heading: lbl(`h-${heading}`, heading), nodes,
});
const board = obs('Board', [{ role: 'link', name: lbl('ps', 'Project settings'), region: 'chrome' }]);
const settings = obs('Project settings', [{ role: 'link', name: lbl('perm', 'Permissions'), region: 'chrome' }]);
const tr = (seq: number, before: unknown, after: unknown, extra: Record<string, unknown> = {}) => ({
  at: 1_790_000_000_000 + seq, episode: 'ep1', seq, source: 'user', before, after,
  action: { type: 'click', target: { role: 'link', name: lbl('ps', 'Project settings'), within: null, region: 'chrome' } },
  ...extra,
});
const count = (db: ReturnType<typeof openDb>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/* 1. products */
{
  const db = openDb(':memory:');
  const a = productForOrigin(db, 'http://localhost:4500');
  const b = productForOrigin(db, 'http://localhost:4500');
  check('same origin, same product and key', a.id === b.id && a.key === b.key);
  check('product key is 256-bit', /^[0-9a-f]{64}$/.test(a.key));
}

/* 2. happy path, dedupe, idempotency */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'o1');
  const batch = {
    productId: p.id, install: { id: 'install-vendor-1', mode: 'vendor', attested: true },
    transitions: [tr(0, board, settings), tr(1, settings, board)],
  };
  const r1 = ingestBatch(db, batch) as any;
  check('vendor batch accepted', r1.accepted === 2 && r1.rejected.length === 0, JSON.stringify(r1));
  check('identical screens stored once', count(db, 'observations') === 2, `observations=${count(db, 'observations')}`);
  const r2 = ingestBatch(db, batch) as any;
  check('retry of the same batch is a no-op', r2.accepted === 0 && r2.duplicate === 2);
  check('still exactly two transitions after the retry', count(db, 'transitions') === 2);
}

/* 3. G4: the server strips what a client should never have sent */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'o2');
  const leaky = obs('Board', [
    { role: 'button', name: lbl('e', 'priya.sharma@acme.com'), region: 'chrome' },
    { role: 'textbox', name: lbl('s', 'Search'), region: 'chrome', value: 'salary review', rect: { x: 4 } },
  ], 'http://localhost:4500/projects/123?q=priya');
  const t = tr(0, leaky, leaky, {
    action: { type: 'setValue', value: 'hunter2', target: { role: 'textbox', name: lbl('pw', 'Password'), region: 'chrome' } },
  });
  const r = ingestBatch(db, { productId: p.id, install: { id: 'install-vendor-2', mode: 'vendor', attested: true }, transitions: [t] }) as any;
  check('a transition carrying forbidden fields is kept, not rejected', r.accepted === 1, JSON.stringify(r.rejected ?? r));
  const stored = ((db.prepare('SELECT json FROM observations').get() as { json: string } | undefined)?.json) ?? '';
  const action = (db.prepare('SELECT action_json FROM transitions').get() as { action_json: string }).action_json;
  check('personal text a client sent is stripped', !stored.includes('priya.sharma@acme.com'));
  check('its hash is kept, so learning still sees the node', stored.includes('"hash":"e"'));
  check('typed value on a node is stripped', !stored.includes('salary review') && !stored.includes('"value"'));
  check('rect a client sent is stripped', !stored.includes('"rect"'));
  check('typed value on an action is stripped', !action.includes('hunter2') && !action.includes('"value"'));
  check('raw url re-normalised on the server', stored.includes('/projects/:id') && !stored.includes('q=priya'));
}

/* 4. malformed items are rejected alone; bounds are enforced */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'o3');
  const r = ingestBatch(db, {
    productId: p.id, install: { id: 'install-vendor-3', mode: 'vendor' },
    transitions: [tr(0, board, settings), { garbage: true }, tr(2, settings, board, { source: 'someone' })],
  }) as any;
  check('good item kept, two bad items rejected', r.accepted === 1 && r.rejected.length === 2, JSON.stringify(r.rejected));
  const big = ingestBatch(db, {
    productId: p.id, install: { id: 'install-vendor-3', mode: 'vendor' },
    transitions: Array.from({ length: 101 }, (_, i) => tr(i, board, settings)),
  }) as any;
  check('oversized batch refused outright', big.status === 400);
  const ghost = ingestBatch(db, { productId: 'p_nope', install: { id: 'install-vendor-3', mode: 'vendor' }, transitions: [] }) as any;
  check('unknown product refused', ghost.status === 404);
}

/* 5. privilege ratchets down, never up */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'o4');
  const q = productForOrigin(db, 'o5');
  const clear = obs('Board', [{ role: 'button', name: lbl('act', 'Actions'), region: 'chrome' }]);
  ingestBatch(db, { productId: p.id, install: { id: 'install-cust-1', mode: 'customer' }, transitions: [tr(0, clear, clear)] });
  ingestBatch(db, {
    productId: p.id, install: { id: 'install-cust-1', mode: 'vendor', attested: true },
    transitions: [tr(1, clear, clear)],
  });
  const row = db.prepare("SELECT mode, attested FROM installs WHERE id = 'install-cust-1'").get() as any;
  check('customer install cannot promote itself to vendor', row.mode === 'customer' && row.attested === 0);
  const json = db.prepare('SELECT json FROM observations').all().map((r: any) => r.json).join('');
  check('so its clear text is still stripped', !json.includes('"text":"Actions"'));
  const hop = ingestBatch(db, { productId: q.id, install: { id: 'install-cust-1', mode: 'customer' }, transitions: [] }) as any;
  check('an install cannot switch products', hop.status === 403);
}

/* 6. k-anonymity: promotion needs K independent customer installs */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'o6');
  const screen = obs('Board', [{ role: 'button', name: lbl('shared-label'), region: 'chrome' }]);
  const send = (id: string, mode: string) =>
    ingestBatch(db, { productId: p.id, install: { id, mode }, transitions: [tr(0, screen, screen)] });
  for (let i = 1; i <= 4; i++) send(`install-customer-${i}`, 'customer');
  check('4 customer installs: not promoted', !promotedLabels(db, p.id, 5).has('shared-label'));
  for (let i = 1; i <= 3; i++) send(`install-vendor-k${i}`, 'vendor');
  check('vendor installs never count toward promotion', !promotedLabels(db, p.id, 5).has('shared-label'));
  const r = send('install-customer-5', 'customer') as any;
  check('5th customer install promotes it', promotedLabels(db, p.id, 5).has('shared-label'));
  check('and the response tells clients so', r.promoted.includes('shared-label'));
}

/* 7. a storage failure mid-batch leaves nothing half-written */
{
  const db = openDb(':memory:');
  const p = productForOrigin(db, 'o7');
  db.exec('PRAGMA foreign_keys = OFF; DROP TABLE observations; PRAGMA foreign_keys = ON;');
  const r = ingestBatch(db, {
    productId: p.id, install: { id: 'install-vendor-7', mode: 'vendor' },
    transitions: [tr(0, board, settings), tr(1, settings, board)],
  }) as any;
  check('storage failure reported as an error', r.status === 500, r.error);
  check('and no partial transitions were written', count(db, 'transitions') === 0);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
