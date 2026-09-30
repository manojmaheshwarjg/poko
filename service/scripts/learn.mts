/* Runs learning for a product from the command line and prints what it found.
     node scripts/learn.mts [origin]      (default http://localhost:4500)
   No model calls. */
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.ts';
import { runLearning } from '../lib/learn/run.ts';

/* Anchor to the service, so the database is the service's wherever this is run from. */
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const origin = process.argv[2] ?? 'http://localhost:4500';
const db = openDb();
const product = db.prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined;
if (!product) {
  console.error(`No product for ${origin} yet. Capture some sessions first.`);
  process.exit(2);
}
const s = runLearning(db, product.id);
console.log(`observations ${s.observations}   transitions ${s.transitions}   screens ${s.screens} (${s.ambiguous} ambiguous)   edges ${s.edges}`);
console.log(`ids kept ${s.idsKept}, new ${s.idsNew}${s.unplaced ? `   UNPLACED transitions ${s.unplaced}` : ''}`);
if (s.score) {
  console.log(`\nagainst ground truth (${s.truthLabelled} labelled observations):`);
  console.log(`  precision ${s.score.precision.toFixed(3)}   (1.000 = no two different screens merged)`);
  console.log(`  recall    ${s.score.recall.toFixed(3)}   (1.000 = no screen split in two)`);
  for (const m of s.score.merges) console.log(`  MERGE  "${m.screen}" holds ${m.truths.join(' + ')}${m.ambiguous ? '  (flagged ambiguous)' : '  (NOT flagged)'}`);
  for (const x of s.score.splits) console.log(`  split  ${x.truth} across ${x.screens} screens`);
  if (s.score.indistinguishable.length) console.log(`  ${s.score.indistinguishable.length} observations identical across different true screens`);
}
const screens = db.prepare('SELECT id, display_name, count, ambiguous FROM screens WHERE product_id = ? ORDER BY count DESC').all(product.id) as any[];
console.log('\nscreens:');
for (const x of screens) console.log(`  ${x.id}  ${String(x.count).padStart(4)} seen  ${x.display_name}${x.ambiguous ? '   [ambiguous]' : ''}`);
