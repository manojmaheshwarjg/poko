/* Ingest a vendor's public docs into the corpus for one tool. No model calls.
     node scripts/ingest-docs.mts <start-url> --tool <name> [--max-pages 40] [--max-depth 3] [--delay 500]
   Respects robots.txt (and refuses if it cannot be read), stays inside the start
   URL's directory, and never touches hand-written corpus files. */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { crawl, writeCorpus } from '../lib/docs/crawl.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const start = args[0];
const tool = flag('tool');
if (!start || !tool) {
  console.error('usage: node scripts/ingest-docs.mts <start-url> --tool <name> [--max-pages N] [--max-depth N] [--delay ms]');
  process.exit(2);
}
const r = await crawl({
  start,
  maxPages: Number(flag('max-pages') ?? 40),
  maxDepth: Number(flag('max-depth') ?? 3),
  delayMs: Number(flag('delay') ?? 500),
});
console.log(`robots.txt: ${r.robots}${r.stoppedBecause ? `   stopped: ${r.stoppedBecause}` : ''}`);
for (const p of r.pages) console.log(`  kept     ${p.url}   (${p.chars} chars)`);
for (const s of r.skipped) console.log(`  skipped  ${s.url}   ${s.reason}`);
if (!r.pages.length) {
  console.log('Nothing to write. The corpus is unchanged.');
  process.exit(r.robots === 'unreadable' ? 1 : 0);
}
const w = writeCorpus(join(process.cwd(), 'corpus'), tool, start, r.pages);
console.log(`\nwrote ${w.written.length} page(s) to corpus/${tool}/ (replaced ${w.removed} previously ingested)`);
