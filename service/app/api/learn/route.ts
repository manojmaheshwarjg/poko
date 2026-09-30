import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runLearning } from '@/lib/learn/run.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Runs learning for one product. Posted to by the console, which is same-origin, so
   no CORS. Makes no model calls: clustering, graph building and mining only. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = url.searchParams.get('origin');
  if (!origin) return NextResponse.json({ error: 'origin is required' }, { status: 400 });
  const db = getDb();
  const product = db.prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined;
  if (!product) return NextResponse.json({ error: 'no product for that origin yet' }, { status: 404 });

  try {
    const summary = runLearning(db, product.id);
    if ((request.headers.get('accept') ?? '').includes('text/html')) {
      /* A plain form post goes back to the map; the console asks for JSON instead. */
      return NextResponse.redirect(new URL(`/p/${product.id}/map`, url), 303);
    }
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
