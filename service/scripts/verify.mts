/* Label and verify candidate routes (Phase D).
 *
 *   node scripts/verify.mts [origin] [--tool jira] [--max-routes N] [--max-calls N]
 *        DRY RUN (default): shows exactly what would be sent and what it would cost.
 *        No model is loaded, no call is made.
 *   ... --confirm
 *        Makes the calls. Two per route (label, then verify), within --max-calls.
 */
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.ts';
import { contextFor } from '../lib/retrieval.ts';
import { CALLS_PER_ROUTE, LABEL_SYSTEM, planVerification, runVerification } from '../lib/learn/verify.ts';

/* The corpus is read relative to the working directory, so anchor to the service. */
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? undefined : args[i + 1];
};
const origin = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true) ?? 'http://localhost:4500';
const tool = flag('tool') ?? 'jira';
const maxRoutes = flag('max-routes') ? Number(flag('max-routes')) : undefined;
const confirm = args.includes('--confirm');

const db = openDb();
const product = db.prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined;
if (!product) {
  console.error(`No product for ${origin}.`);
  process.exit(2);
}
const docs = (q: string) => contextFor(tool, q).text;
const planned = planVerification(db, product.id, { tool, maxRoutes, docs });
const callable = planned.filter((p) => p.willCall);
const needed = callable.length * CALLS_PER_ROUTE;
const maxCalls = flag('max-calls') ? Number(flag('max-calls')) : needed;

if (!planned.length) {
  console.log(`Nothing to verify for ${origin}: no candidate routes. (Blocked routes are never sent.)`);
  process.exit(0);
}

if (!confirm) {
  const names = new Map((db.prepare('SELECT id, display_name FROM screens WHERE product_id = ?').all(product.id) as any[]).map((r) => [r.id, r.display_name]));
  console.log(`DRY RUN for ${origin}. No model loaded, no calls made.\n`);
  console.log(`Label prompt (system, sent once per route): ${LABEL_SYSTEM.length} chars, docs attached per route.\n`);
  planned.forEach((p, i) => {
    const start = JSON.parse(p.route.path_json)[0]?.screen;
    console.log(`${i + 1}. ${p.title}   [${p.route.attempts} attempts, ${p.route.installs} people]${p.held ? '   HELD: one re-check with a new label; it stays held if it passes' : ''}`);
    if (!p.willCall) {
      console.log(`   skipped, 0 calls: ${p.skipReason}\n`);
      return;
    }
    console.log(`   call 1, label. The model is shown this route and asked for the request a person would type:`);
    for (const s of p.labelInput.steps) console.log(`      ${s}`);
    console.log(`      The point of it: ${p.labelInput.goal}.   (+ ${p.labelInput.docs?.length ?? 0} chars of docs)`);
    console.log(`   call 2, verify. The product planner gets ONLY that label plus the ${names.get(start) ?? start} screen,`);
    console.log(`      not the route, and must plan exactly: ${p.labelInput.goal}.\n`);
  });
  console.log(`Total: ${callable.length} route${callable.length === 1 ? '' : 's'} x ${CALLS_PER_ROUTE} calls = ${needed} calls${planned.length > callable.length ? ` (${planned.length - callable.length} skipped at no cost)` : ''}.`);
  console.log(`Budget cap for a real run: ${maxCalls}. Nothing has been spent.`);
  console.log(`To run it: node scripts/verify.mts ${origin} --confirm`);
  process.exit(0);
}

/* Only now are the key and the model client loaded at all. A dry run never reads
   .env.local, so it cannot touch the key even by accident. */
try {
  process.loadEnvFile('.env.local');
} catch {
  /* no .env.local: fall back to whatever is exported, and fail clearly below if nothing is */
}
const { modelDeps } = await import('../lib/learn/model-deps.ts');
const deps = modelDeps();
console.log(`Verifying ${callable.length} route(s) with ${deps.model}, budget ${maxCalls} calls.\n`);
const res = await runVerification(db, product.id, deps, { tool, maxCalls, maxRoutes, docs });
for (const r of res.processed) {
  console.log(`${r.outcome.padEnd(9)} ${r.title}`);
  if (r.label) console.log(`          labelled: "${r.label}"`);
  console.log(`          ${r.reason}   (${r.calls} call${r.calls === 1 ? '' : 's'})`);
}
console.log(`\n${res.callsUsed} call(s) used.${res.stoppedBecause ? ` Stopped: ${res.stoppedBecause}.` : ''}`);
