/* Enforces G9 from a with/without comparison (eval/run.mjs --compare).
 *
 *   node service/scripts/g9.mts <eval results .json> [--origin <product origin>]
 *        DRY RUN (default): shows the verdict and what it would hold or release.
 *   ... --apply
 *        Does it.
 *
 * No model calls. Holding is the default consequence of a regression; releasing needs
 * a clean comparison that included the held routes (eval/run.mjs --include-held). */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.ts';
import { applyG9, planG9 } from '../lib/learn/g9.ts';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? undefined : args[i + 1];
};
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--origin');
if (!file) {
  console.error('usage: node service/scripts/g9.mts <eval results .json> [--origin <product origin>] [--apply]');
  process.exit(2);
}
/* Read before moving into the service directory, so a relative path means what it did. */
const results = JSON.parse(readFileSync(resolve(file), 'utf8')) as Array<{ origin?: string | null }>;
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const recorded = results.find((r) => r.origin)?.origin ?? null;
const origin = flag('origin') ?? recorded;
if (!origin) {
  console.error('These results do not say which product they were run against. Pass --origin <product origin>.');
  process.exit(2);
}
if (recorded && flag('origin') && recorded !== flag('origin')) {
  console.error(`These results were run against ${recorded}, not ${flag('origin')}.`);
  process.exit(2);
}
const db = openDb();
const product = db.prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined;
if (!product) {
  console.error(`No product for ${origin}.`);
  process.exit(2);
}

const plan = planG9(db, product.id, results);
const v = plan.verdict;
console.log(`G9 for ${origin}, from ${basename(file)}`);
if (plan.refused) {
  console.log(`Refused: ${plan.refused}`);
  process.exit(2);
}
console.log(`  docs only ${v.docsOnly.passed}/${v.docsOnly.of}, with routes ${v.withRoutes.passed}/${v.withRoutes.of}`);
console.log(`  regressed: ${v.regressed.join(', ') || 'none'}; improved: ${v.improved.join(', ') || 'none'}${v.inconclusive.length ? `; inconclusive: ${v.inconclusive.join(', ')}` : ''}\n`);
for (const h of plan.hold) console.log(`hold      ${h.id}  "${h.label}"  (${h.was === 'held' ? 'held again' : 'offered where planning got worse'})`);
for (const r of plan.release) console.log(`release   ${r.id}  "${r.label}"  (offered in a clean comparison)`);
for (const k of plan.keep) console.log(`keep held ${k.id}  "${k.label}"  (${k.why})`);
if (!plan.hold.length && !plan.release.length) console.log('Nothing to change.');

if (args.includes('--apply')) {
  applyG9(db, plan, basename(file, '.json'));
  console.log('\nApplied.');
} else if (plan.hold.length || plan.release.length) {
  console.log('\nDry run: nothing changed. Add --apply to do it.');
}
