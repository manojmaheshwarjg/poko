#!/usr/bin/env node
/* Re-runs the automatic checks against a stored results file. Makes no API
   calls, so a stricter check can be tried against plans already paid for. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2];
if (!path) {
  console.error('Usage: node eval/recheck.mjs eval/results/<stamp>.json');
  process.exit(2);
}

const screens = JSON.parse(readFileSync(join(here, 'screens.json'), 'utf8'));
const results = JSON.parse(readFileSync(path, 'utf8'));

/* Grade against TODAY's expectations, not the ones embedded in the file when it
   ran. Otherwise a migration silently re-grades old output against its own old
   bar, which is the opposite of what re-checking is for. */
const current = new Map(
  JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8')).map((s) => [s.id, s])
);

let clean = 0;
let stale = 0;
for (const r of results) {
  const scenario = current.get(r.id);
  if (!scenario) {
    stale++;
    console.log(`skipped   ${r.id} (no longer in scenarios.json)`);
    continue;
  }
  const problems = r.result.error
    ? [`request failed: ${r.result.error}`]
    : check(scenario, r.result, screens);
  if (!problems.length) clean++;
  console.log(`${problems.length ? 'PROBLEMS' : 'clean   '}  ${r.id}`);
  for (const p of problems) console.log(`          - ${p}`);
}
console.log(`\n${clean}/${results.length - stale} clean under the current checks and expectations.`);
if (results.some((r) => r.result.plan && !r.result.outcome)) {
  console.log('Note: this file predates the outcome field, so outcomes were inferred from whether a plan was returned.');
}
