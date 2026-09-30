#!/usr/bin/env node
/* Eval runner. MAKES ONE PAID API CALL PER SCENARIO.
 *
 * It refuses to start without --confirm, because the whole point of this file
 * is that running it costs money and nobody should trigger that by reflex.
 *
 *   node eval/run.mjs --confirm
 *   node eval/run.mjs --confirm --only read-only-happy
 *   node eval/run.mjs --confirm --skip read-only-happy,impossible
 *   node eval/run.mjs --confirm --origin http://synthetic.localhost --compare   (G9, twice the calls)
 *   ... --compare --include-held   also offers routes held back by an earlier G9 failure,
 *                                  which is the only way to test them for release
 *   node eval/run.mjs --confirm --service http://localhost:4600
 *
 * Output:
 *   eval/results/<timestamp>.json   raw plans plus automatic checks
 *   eval/results/<timestamp>.md     grading sheet for a human SME
 *
 * The automatic checks are a filter, not the metric. They catch plans that are
 * structurally wrong for free. The number that decides whether this is a
 * company is the accept rate a human writes into the grading sheet, which
 * eval/score.mjs then reads back.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? true;
};

if (!args.includes('--confirm')) {
  console.error(
    'Refusing to run. This makes one paid API call per scenario.\n' +
      'Re-run with --confirm when you actually want to spend that.'
  );
  process.exit(2);
}

const SERVICE = flag('service') || 'http://localhost:4600';
const ONLY = flag('only');
/* G9. --origin names the product whose verified routes may be offered to the
   planner. --compare runs every scenario twice, with and without those routes, and
   reports any scenario learning made WORSE: learning is kept only if nothing
   regresses. Twice the calls. */
const ORIGIN = flag('origin');
const COMPARE = args.includes('--compare');
/* Held routes are never offered in normal use. The eval can ask for them, because a
   passing comparison that included them is the only thing that may release them. */
const INCLUDE_HELD = args.includes('--include-held');
const MODES = COMPARE ? [true, false] : [ORIGIN ? true : false];
if (COMPARE && !ORIGIN) {
  console.error('--compare needs --origin <product origin>, the product whose routes to compare against.');
  process.exit(2);
}
/* Scenarios written by hand, then any added from the console (a struggle turned into
   a test case). Added ones live in their own file so the hand-written set stays as it
   was reviewed; an id already taken by a hand-written scenario is ignored. */
const handWritten = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'));
const addedPath = join(here, 'scenarios.added.json');
const added = existsSync(addedPath) ? JSON.parse(readFileSync(addedPath, 'utf8')) : [];
const scenarios = [...handWritten, ...added.filter((a) => !handWritten.some((h) => h.id === a.id))];
const screens = JSON.parse(readFileSync(join(here, 'screens.json'), 'utf8'));
const SKIP = flag('skip');
let selected = ONLY ? scenarios.filter((s) => s.id === ONLY) : scenarios;
if (SKIP) {
  const skipped = new Set(String(SKIP).split(','));
  selected = selected.filter((s) => !skipped.has(s.id));
}

if (!selected.length) {
  console.error(`No scenario matched "${ONLY}".`);
  process.exit(2);
}

import { check } from './checks.mjs';
import { compareModes } from './compare.mjs';
import { LONG_WAIT_MS, parseWait } from './wait.mjs';

const started = Date.now();
const results = [];
process.stderr.write(`${selected.length} scenario(s) x ${MODES.length} mode(s) = ${selected.length * MODES.length} call(s)${COMPARE ? ', with and without learned routes' : ''}\n\n`);

/* Set when the provider says to wait longer than a per-minute limit ever needs: a daily
   limit. Every later request would fail too, so the run stops and keeps what it has. */
let stopped = null;
runs: for (const useRoutes of MODES) for (const scenario of selected) {
  if (stopped) break runs;
  const observation = screens[scenario.from];
  process.stderr.write(`planning${COMPARE ? (useRoutes ? ' [routes]' : ' [docs only]') : ''}: ${scenario.id} ... `);
  let result;
  const t0 = Date.now();
  /* Groq's free tier is token-per-minute limited, and a full sweep of these
     scenarios exceeds it. A 429 is a scheduling problem, not a result: retry it
     rather than recording a failure the model never had a chance to cause. */
  const ATTEMPTS = 6;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${SERVICE}/api/plan`, {
        method: 'POST',
        /* Set when the console's queue started this run, so the service can record
           each call's tokens against it. */
        headers: { 'content-type': 'application/json', ...(process.env.SEKVA_JOB ? { 'x-sekva-job': process.env.SEKVA_JOB } : {}) },
        body: JSON.stringify({
          tool: 'jira', goal: scenario.goal, observation,
          ...(ORIGIN ? { origin: ORIGIN, useRoutes, ...(INCLUDE_HELD && useRoutes ? { includeHeld: true } : {}) } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `service returned ${response.status}`);
      result = data;
      break;
    } catch (error) {
      const message = error.message;
      const rateLimited = /rate_limit|429/.test(message);
      if (!rateLimited || attempt === ATTEMPTS) {
        result = { error: message };
        break;
      }
      const hinted = parseWait(message);
      if (hinted !== null && hinted > LONG_WAIT_MS) {
        stopped = `the provider asked for a ${Math.round(hinted / 60_000)} minute wait, which is a daily limit, not a per-minute one`;
        result = { error: message };
        break;
      }
      const waitMs = (hinted ?? 2 ** attempt * 1000) + 1500;
      process.stderr.write(`rate limited, waiting ${Math.round(waitMs / 1000)}s ... `);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const ms = Date.now() - t0;

  const problems = result.error ? [`request failed: ${result.error}`] : check(scenario, result, screens);
  results.push({ ...scenario, result, problems, ms, useRoutes, origin: ORIGIN, includeHeld: INCLUDE_HELD, followedRoute: result.plan?.route?.id ?? null });
  process.stderr.write(problems.length ? `${problems.length} problem(s), ${ms}ms\n` : `ok, ${ms}ms\n`);
  if (scenario !== selected.at(-1)) await new Promise((r) => setTimeout(r, 3000));
}

if (stopped) {
  process.stderr.write(`\nStopped early: ${stopped}. ${results.length} of ${selected.length * MODES.length} results kept; nothing after this was sent.\n`);
  process.exitCode = 1;
}

mkdirSync(join(here, 'results'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(join(here, 'results', `${stamp}.json`), JSON.stringify(results, null, 2));

/* The grading sheet. One block per scenario, with a blank verdict line the SME
   fills in. Keep the format dumb so it can be edited in any editor. */
const sheet = [
  `# Grading sheet ${stamp}`,
  '',
  `${results.length} scenarios, ${Math.round((Date.now() - started) / 1000)}s total.`,
  '',
  'For each plan below write ACCEPT or REJECT on the verdict line, as an expert',
  'who knows this product. ACCEPT means you would let it run unedited. Anything',
  'you would want to change first is a REJECT, even if it is close.',
  '',
  'The automatic problems listed are advisory. You can accept a plan they flagged',
  'and reject one they did not.',
  '',
  '---',
  '',
  ...results.flatMap((r) => {
    const lines = [`## ${r.id}`, '', `**Goal:** ${r.goal}`, `**Starting screen:** ${r.from}`, `**Why this scenario:** ${r.why}`, ''];
    if (r.result.error) {
      lines.push('```', `ERROR: ${r.result.error}`, '```', '');
    } else if (!r.result.plan) {
      const label = r.result.outcome === 'nothing_to_do' ? 'Nothing to do' : 'Cannot be done';
      lines.push(`**${label}:** ${r.result.limitation ?? '(no explanation given)'}`, '');
    } else if (r.result.plan) {
      lines.push(`**Outcome:** ${r.result.outcome}`, '');
      if (r.result.outcome === 'partial') {
        lines.push(`**Not covered:** ${r.result.limitation ?? '(not stated)'}`, '');
      }
      if (r.result.plan.understood) lines.push(`**Understood as:** ${r.result.plan.understood}`, '');
      r.result.plan.steps.forEach((s, i) => {
        const act =
          s.action.type === 'click'
            ? 'click'
            : `${s.action.type} = ${JSON.stringify(s.action.value)}`;
        lines.push(`${i + 1}. **${s.intent}**`, `   - target: \`${s.target.role}\` / \`${s.target.name}\``, `   - action: \`${act}\``, `   - reasoning: ${s.reasoning}`);
      });
      lines.push('');
    }
    lines.push(
      r.problems.length
        ? `**Automatic checks:** ${r.problems.map((p) => `\n   - ${p}`).join('')}`
        : '**Automatic checks:** clean',
      '',
      'VERDICT: ',
      '',
      '---',
      ''
    );
    return lines;
  }),
].join('\n');

writeFileSync(join(here, 'results', `${stamp}.md`), sheet);

const clean = results.filter((r) => !r.problems.length).length;
console.log(`\n${clean}/${results.length} passed the automatic checks.`);
/* Read by the console's queue to find what this run wrote. */
console.log(`Results: eval/results/${stamp}.json`);

if (COMPARE) {
  const v = compareModes(results);
  if (!v.complete) console.log('\nG9: incomplete run, so no verdict. Every scenario must run both ways.');
  console.log(`\nG9, learned routes vs docs only:`);
  console.log(`  docs only      ${v.docsOnly.passed}/${v.docsOnly.of}`);
  console.log(`  with routes    ${v.withRoutes.passed}/${v.withRoutes.of}   (a route was followed in ${v.followed})`);
  console.log(`  improved       ${v.improved.length ? v.improved.join(', ') : 'none'}`);
  console.log(`  REGRESSED      ${v.regressed.length ? v.regressed.join(', ') : 'none'}`);
  if (v.inconclusive.length) console.log(`  inconclusive   ${v.inconclusive.join(', ')} (a request got no answer; re-run with --only)`);
  if (v.regressed.length) {
    console.log('\nLearning made these worse. By G9 the routes offered there must be held back:');
    process.exitCode = 1;
  }
  console.log(`  node service/scripts/g9.mts eval/results/${stamp}.json            (shows what G9 would hold or release)`);
}
console.log(`Grading sheet: eval/results/${stamp}.md`);
console.log('Fill in the VERDICT lines, then: node eval/score.mjs eval/results/' + stamp + '.md');
