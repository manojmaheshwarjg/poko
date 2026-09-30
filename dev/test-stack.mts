/* The whole learning stack on simulated people: real ingest, real clustering, real
   mining, real persistence. The simulator's own screen names are never passed in,
   so every route here is built on screens the system identified by itself. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning, nextStatus } from '../service/lib/learn/run.ts';
import type { Step } from '../service/lib/learn/mine.ts';
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
  efficient: [...toPerms, ...intoEdit, readOnly],
  lost: [click('link', 'Project settings'), click('link', 'Access'), click('link', 'Project settings'), click('link', 'Permissions'),
    click('button', 'Actions'), click('button', 'Actions'), ...intoEdit, readOnly],
  mistake: [...toPerms, ...intoEdit, tick('Browse projects for Contractors', false), tick('Browse projects for Contractors', true), readOnly],
  deadClicker: [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Add people'), click('button', 'Add people'), click('button', 'Remove Developers')],
};

/* Steps become exactly what the uploader would send: no screen ids, no truth. */
const asTransitions = (steps: Step[]) =>
  steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action }));
const upload = (db: any, productId: string, steps: Step[]) => {
  const byInstall = new Map<string, Step[]>();
  for (const s of steps) byInstall.set(s.install, [...(byInstall.get(s.install) ?? []), s]);
  for (const [install, list] of byInstall) {
    const r = ingestBatch(db, { productId, install: { id: `install-${install}-xxxx`, mode: 'vendor', attested: true }, transitions: asTransitions(list) }) as any;
    if (r.error || r.rejected?.length) throw new Error(`ingest failed: ${JSON.stringify(r)}`);
  }
};
const rows = (db: any, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as any[];
const screenName = (db: any, id: string) => rows(db, 'SELECT display_name FROM screens WHERE id = ?', id)[0]?.display_name;

const db = openDb(':memory:');
const p = productForOrigin(db, 'http://sim.localhost');
const people: Step[] = [
  ...['a', 'b', 'c'].flatMap((u) => session(u, 'e1', personas.efficient)),
  ...['d', 'e'].flatMap((u) => session(u, 'e1', personas.lost)),
  ...session('f', 'e1', personas.mistake),
  ...['g', 'h'].flatMap((u) => session(u, 'e1', personas.deadClicker)),
];
upload(db, p.id, people);
const r1 = runLearning(db, p.id);

/* 1. Routes are mined on screens the system found itself */
const untick = () => rows(db, "SELECT * FROM routes WHERE product_id = ? AND goal_actions_json LIKE '%Edit issues for Contractors%' AND kind = 'effect'", p.id)[0];
{
  const r = untick();
  check('1. the main route is found through the real stack', r?.status === 'candidate' && r.attempts === 6, r ? `${r.status} attempts=${r.attempts}` : 'missing');
  const steps = JSON.parse(r.path_json).map((s: any) => `${screenName(db, s.screen)}: ${s.action.target.name.text}`);
  check('1. its path runs over clustered screens, by name', steps.join(' > ') === 'Board: Project settings > Project settings: Permissions > Permissions: Actions > Permissions: Edit permissions > Edit permissions: Edit issues for Contractors', steps.join(' > '));
  check('1. clustering underneath: the 5 screens these personas visit, none ambiguous', r1.screens === 5 && r1.ambiguous === 0, `screens=${r1.screens}`);
}

/* 2. Struggle points land on the right real screens */
{
  const s = rows(db, 'SELECT screen_id, kind, attempts FROM struggles WHERE product_id = ?', p.id).map((x) => `${x.kind}@${screenName(db, x.screen_id)}×${x.attempts}`).sort();
  check('2. wrong turn into Access found', s.includes('backtrack@Access×2'), s.join(', '));
  check('2. peek at the Actions menu found', s.includes('peek@Permissions×2'));
  check('2. the undone box found', s.includes('undo@Edit permissions×1'));
  check('2. dead clicks on Access found', s.includes('deadClick@Access×2'));
}

/* 3. G6 across the whole stack: copilot sessions change nothing */
{
  upload(db, p.id, Array.from({ length: 8 }, (_, i) => session(`bot${i}`, 'c1', personas.efficient, { source: 'copilot' })).flat());
  runLearning(db, p.id);
  check('3. eight copilot runs of the same route leave its support at 6', untick().attempts === 6, `attempts=${untick().attempts}`);
  check('3. and add no struggle signals', rows(db, 'SELECT COUNT(*) AS n FROM struggles WHERE product_id = ?', p.id)[0].n === 4);
}

/* 4. Verification survives a re-run only while the path is the one verified */
{
  const r = untick();
  db.prepare("UPDATE routes SET status = 'verified', verified_path_hash = ? WHERE id = ?").run(r.path_hash, r.id);
  runLearning(db, p.id);
  check('4. a verified route stays verified when nothing changed', untick().status === 'verified');

  /* Ten people who begin on Permissions make the shorter path the most common one. */
  upload(db, p.id, Array.from({ length: 10 }, (_, i) => session(`late${i}`, 'e9', [...intoEdit, readOnly], { start: 'perms' })).flat());
  runLearning(db, p.id);
  const after = untick();
  check('4. when the canonical path changes, verification is dropped', after.status === 'candidate' && after.verified_path_hash === null, `${after.status} ${after.status_reason}`);
  check('4. and the reason is stated', /changed since it was checked/.test(after.status_reason ?? ''));
}

/* 5. A route that stops being produced is kept as stale, not deleted */
{
  const before = rows(db, "SELECT id FROM routes WHERE product_id = ? AND goal_actions_json LIKE '%Remove Developers%'", p.id)[0];
  db.exec("DELETE FROM transitions WHERE install_id IN ('install-g-xxxx', 'install-h-xxxx')");
  runLearning(db, p.id);
  const after = rows(db, 'SELECT status FROM routes WHERE id = ?', before.id)[0];
  check('5. a route with no evidence left is marked stale', after?.status === 'stale', after?.status);
}

/* 6. nextStatus: blocked always wins, whatever came before */
{
  const blocked = nextStatus({ status: 'blocked', blockedReason: 'ambiguous', pathHash: 'p' }, { status: 'verified', verified_path_hash: 'p' });
  check('6. an ambiguous screen blocks even a verified route', blocked.status === 'blocked' && blocked.verifiedPathHash === null);
  const rejected = nextStatus({ status: 'candidate', blockedReason: null, pathHash: 'p' }, { status: 'rejected', verified_path_hash: 'p' });
  check('6. a rejection sticks while the path is the same', rejected.status === 'rejected');
  const retry = nextStatus({ status: 'candidate', blockedReason: null, pathHash: 'q' }, { status: 'rejected', verified_path_hash: 'p' });
  check('6. a rejected route gets another chance when the path changes', retry.status === 'candidate');
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
