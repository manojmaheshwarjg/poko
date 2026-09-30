import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { comparisonsFor } from '@/lib/console/evaluations';
import { applyG9, planG9 } from '@/lib/learn/g9';
import { resultsFile } from '@/lib/onboard';
import { resultPage, esc } from '@/lib/page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Apply a with/without comparison's verdict (the same as `service/scripts/g9.mts
   --apply`). No model calls. The console posts JSON { productId, file } and gets the
   result back; a plain form post (origin, file) still gets a page. A run from before
   runs recorded their product counts as this product's only when the routes it
   offered are this product's, which is how the console attributes it too. */
export async function POST(request: Request) {
  const json = (request.headers.get('content-type') ?? '').includes('application/json');
  const db = getDb();
  let product: { id: string; origin: string } | undefined;
  let file = '';
  if (json) {
    const body = (await request.json().catch(() => ({}))) as { productId?: string; file?: string };
    product = db.prepare('SELECT id, origin FROM products WHERE id = ?').get(body.productId ?? '') as typeof product;
    file = String(body.file ?? '');
  } else {
    const form = await request.formData();
    product = db.prepare('SELECT id, origin FROM products WHERE origin = ?').get(String(form.get('origin') ?? '')) as typeof product;
    file = String(form.get('file') ?? '');
  }
  const back = product ? `/p/${product.id}/evaluations?file=${encodeURIComponent(file)}` : '/products';
  const refuse = (status: number, error: string) =>
    json ? NextResponse.json({ error }, { status }) : resultPage('Nothing applied', `<p class="bad">${esc(error)}</p>`, back, status);

  const results = resultsFile(file) as Array<{ origin?: string | null }> | null;
  if (!product || !results) return refuse(404, 'Unknown product or results file.');
  if (!comparisonsFor(db, product.id, product.origin, 1000).some((c) => c.file === file)) {
    return refuse(400, `${file} was not a with/without comparison run against ${product.origin}.`);
  }
  const plan = planG9(db, product.id, results);
  if (plan.refused) return refuse(400, plan.refused);
  applyG9(db, plan, file.replace(/\.json$/, ''));
  if (json) return NextResponse.json({ held: plan.hold.map((h) => h.id), released: plan.release.map((r) => r.id), kept: plan.keep.map((k) => k.id) });
  return NextResponse.redirect(new URL(back, request.url), 303);
}
