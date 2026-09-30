import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CORPUS_DIR } from '@/lib/corpus';
import { crawl, writeCorpus } from '@/lib/docs/crawl';
import { esc, resultPage } from '@/lib/page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/* Ingest a product's docs from a URL. The crawler's own rules apply (robots, scope,
   limits; see lib/docs/crawl.ts). It fetches only when a person asks: nothing here
   runs on its own. The console posts JSON { productId, url, maxPages } and shows the
   result in place; a plain form post (origin, url) still gets a page. No model call. */
export async function POST(request: Request) {
  const json = (request.headers.get('content-type') ?? '').includes('application/json');
  const db = getDb();
  let product: { id: string; tool: string; origin: string } | undefined;
  let rawUrl = '';
  let max = 40;
  if (json) {
    const body = (await request.json().catch(() => ({}))) as { productId?: string; url?: string; maxPages?: number };
    product = db.prepare('SELECT id, tool, origin FROM products WHERE id = ?').get(body.productId ?? '') as typeof product;
    rawUrl = String(body.url ?? '');
    max = Number(body.maxPages) || 40;
  } else {
    const form = await request.formData();
    product = db.prepare('SELECT id, tool, origin FROM products WHERE origin = ?').get(String(form.get('origin') ?? '')) as typeof product;
    rawUrl = String(form.get('url') ?? '');
    max = Number(form.get('maxPages')) || 40;
  }
  const back = product ? `/p/${product.id}/sources?tab=docs` : '/products';
  const reply = (status: number, data: Record<string, unknown>, html: string, title: string) =>
    json ? NextResponse.json(data, { status }) : resultPage(title, html, back, status);

  if (!product) return reply(404, { error: 'unknown product' }, '<p class="bad">Unknown product.</p>', 'Docs not ingested');
  let start: URL;
  try {
    start = new URL(rawUrl);
    if (start.protocol !== 'http:' && start.protocol !== 'https:') throw new Error('not a web address');
  } catch {
    return reply(400, { error: 'the docs address must be an http or https URL' }, '<p class="bad">The docs address must be an http or https URL.</p>', 'Docs not ingested');
  }
  const maxPages = Math.max(1, Math.min(60, max));
  try {
    const result = await crawl({ start: start.toString(), maxPages });
    if (!result.pages.length) {
      return reply(
        200,
        { written: 0, removed: 0, stoppedBecause: result.stoppedBecause ?? null, skipped: result.skipped.slice(0, 20) },
        `<p class="warn">No pages were taken from ${esc(start)}${result.stoppedBecause ? `: ${esc(result.stoppedBecause)}` : ''}.</p>`,
        'Nothing ingested'
      );
    }
    const written = writeCorpus(CORPUS_DIR(), product.tool, start.origin, result.pages);
    const skipped = result.skipped.slice(0, 20);
    return reply(
      200,
      { written: written.written.length, removed: written.removed, stoppedBecause: result.stoppedBecause ?? null, skipped },
      `<p class="ok">${written.written.length} page${written.written.length === 1 ? '' : 's'} from ${esc(start.origin)} saved to the <code>${esc(product.tool)}</code> corpus${written.removed ? `, replacing ${written.removed} from an earlier ingest` : ''}.</p>
       ${result.stoppedBecause ? `<p>Stopped: ${esc(result.stoppedBecause)}.</p>` : ''}
       ${skipped.length ? `<p>Not taken:</p><ul>${skipped.map((s) => `<li><code>${esc(s.url)}</code> ${esc(s.reason)}</li>`).join('')}</ul>` : ''}`,
      'Docs ingested'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply(502, { error: message }, `<p class="bad">${esc(message)}</p>`, 'Docs not ingested');
  }
}
