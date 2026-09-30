#!/usr/bin/env node
/* Lists the models this GROQ_API_KEY can reach, so GROQ_MODEL is chosen from
   reality rather than guessed.
 *
 *   node scripts/list-models.mjs
 *
 * This is a metadata call. It runs no inference and generates no tokens, but it
 * does hit Groq with your key, so it asks first unless you pass --yes. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const here = dirname(fileURLToPath(import.meta.url));

/* Read .env.local without pulling in a dependency. */
function loadEnv() {
  try {
    const text = readFileSync(join(here, '..', '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env.local, fall back to the ambient environment */
  }
}
loadEnv();

const key = process.env.GROQ_API_KEY;
if (!key) {
  console.error('GROQ_API_KEY is not set. Put it in service/.env.local or export it.');
  process.exit(2);
}

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('This calls Groq with your API key (metadata only, no inference). Continue? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Cancelled.');
    process.exit(0);
  }
}

const response = await fetch('https://api.groq.com/openai/v1/models', {
  headers: { authorization: `Bearer ${key}` },
});
if (!response.ok) {
  console.error(`Groq returned ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const { data = [] } = await response.json();
const rows = data
  .filter((m) => m.active !== false)
  .sort((a, b) => (b.context_window ?? 0) - (a.context_window ?? 0));

console.log(`${rows.length} models available to this key:\n`);
for (const m of rows) {
  const ctx = m.context_window ? `${Math.round(m.context_window / 1000)}k ctx` : '';
  console.log(`  ${m.id.padEnd(42)} ${ctx.padStart(9)}  ${m.owned_by ?? ''}`);
}
console.log('\nPut one in service/.env.local as GROQ_MODEL=<id>');
console.log('The planner needs solid instruction-following and JSON Schema support.');
