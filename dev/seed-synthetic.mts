/* Seeds a clearly separate synthetic product with simulated people, through the real
   ingest and learning paths, so the coverage page can be seen with routes and
   struggle points before any real people have used the product.
     node dev/seed-synthetic.mts            seed (replacing any previous seed)
     node dev/seed-synthetic.mts --remove   delete it again
   Never touches any other product. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin } from '../service/lib/ingest.ts';
import { runLearning } from '../service/lib/learn/run.ts';
import { session, click, tick } from './sim.mts';

const ORIGIN = 'http://synthetic.localhost';
const db = openDb(process.env.COPILOT_DB ?? 'service/data/copilot.db');

function remove() {
  const row = db.prepare('SELECT id FROM products WHERE origin = ?').get(ORIGIN) as { id: string } | undefined;
  if (!row) return 0;
  db.exec('BEGIN');
  for (const t of ['struggles', 'routes', 'edges', 'screen_members', 'screens', 'learn_runs', 'dev_truth', 'label_sightings', 'transitions', 'observations', 'installs']) {
    db.prepare(`DELETE FROM ${t} WHERE product_id = ?`).run(row.id);
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(row.id);
  db.exec('COMMIT');
  return 1;
}

if (process.argv.includes('--remove')) {
  console.log(remove() ? `removed ${ORIGIN}` : `nothing to remove`);
  process.exit(0);
}
remove();

const toPerms = [click('link', 'Project settings'), click('link', 'Permissions')];
const intoEdit = [click('button', 'Actions'), click('menuitem', 'Edit permissions')];
const readOnly = tick('Edit issues for Contractors', false);
const groups: Array<[string[], Parameters<typeof session>[2], Parameters<typeof session>[3]?]> = [
  [['ana', 'ben', 'cal', 'dee'], [...toPerms, ...intoEdit, readOnly]],
  [['eli', 'fay', 'gus'], [click('link', 'Project settings'), click('link', 'Access'), click('link', 'Project settings'), click('link', 'Permissions'), click('button', 'Actions'), click('button', 'Actions'), ...intoEdit, readOnly]],
  [['hal'], [...toPerms, ...intoEdit, tick('Browse projects for Contractors', false), tick('Browse projects for Contractors', true), readOnly]],
  [['ivy', 'jo'], [...toPerms, ...intoEdit, readOnly, tick('Delete issues for Contractors', true)]],
  [['kai', 'lee'], toPerms],
  [['max'], [click('link', 'Project settings'), click('link', 'Notifications'), click('link', 'Project settings'), click('link', 'Access'), click('link', 'Project settings'), click('link', 'Notifications')]],
  [['nia', 'oz'], [click('link', 'Project settings'), click('link', 'Access'), click('button', 'Add people'), click('button', 'Add people'), click('button', 'Remove Developers')]],
];

const p = productForOrigin(db, ORIGIN);
for (const [names, acts, opts] of groups) {
  for (const who of names) {
    const steps = session(who, `ep-${who}`, acts, opts);
    const r = ingestBatch(db, {
      productId: p.id,
      install: { id: `install-synthetic-${who}`, mode: 'vendor', attested: true },
      transitions: steps.map((s) => ({ at: s.at, episode: s.episode, seq: s.seq, source: s.source, before: s.before, after: s.after, action: s.action })),
    }) as any;
    if (r.error || r.rejected?.length) throw new Error(JSON.stringify(r));
  }
}
const s = runLearning(db, p.id);
console.log(`seeded ${ORIGIN}: ${s.transitions} transitions, ${s.screens} screens, ${s.humanAttempts} human attempts`);
console.log(`routes: ${s.routes.candidate} candidate, ${s.routes.blocked} blocked   struggle points: ${s.struggles}`);
console.log(`view: http://localhost:4600/coverage?origin=${encodeURIComponent(ORIGIN)}`);
