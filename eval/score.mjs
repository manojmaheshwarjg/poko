#!/usr/bin/env node
/* Reads a filled-in grading sheet and reports the only number that matters:
   the share of plans an expert would accept unedited.
   Makes no API calls. */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node eval/score.mjs eval/results/<stamp>.md');
  process.exit(2);
}

const text = readFileSync(path, 'utf8');
const blocks = text.split(/^## /m).slice(1);
const rows = blocks.map((block) => {
  const id = block.split('\n', 1)[0].trim();
  const match = block.match(/^VERDICT:\s*(.*)$/m);
  const verdict = (match?.[1] ?? '').trim().toUpperCase();
  return { id, verdict };
});

const graded = rows.filter((r) => r.verdict === 'ACCEPT' || r.verdict === 'REJECT');
const ungraded = rows.filter((r) => !['ACCEPT', 'REJECT'].includes(r.verdict));
const accepted = graded.filter((r) => r.verdict === 'ACCEPT');

for (const row of rows) {
  const mark = row.verdict === 'ACCEPT' ? 'ACCEPT' : row.verdict === 'REJECT' ? 'REJECT' : '  ?   ';
  console.log(`${mark}  ${row.id}`);
}

if (ungraded.length) {
  console.log(`\n${ungraded.length} of ${rows.length} not yet graded: ${ungraded.map((r) => r.id).join(', ')}`);
}
if (!graded.length) {
  console.log('\nNothing graded yet, so there is no accept rate to report.');
  process.exit(0);
}

const rate = (accepted.length / graded.length) * 100;
console.log(`\nAccept rate: ${accepted.length}/${graded.length} = ${rate.toFixed(0)}%`);
console.log(
  rate >= 70
    ? 'Above the 70% bar from PLAN.md.'
    : rate < 40
      ? 'Below 40%. PLAN.md says that means docs-plus-UI-map is incomplete and the missing piece is consequence modelling.'
      : 'Between 40% and 70%. Neither the go nor the rethink signal.'
);
if (graded.length < 20) {
  console.log(`\nNote: ${graded.length} graded items is a small sample. Treat this as direction, not a measurement.`);
}
