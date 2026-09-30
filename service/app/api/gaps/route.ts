import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { addGap } from '@/lib/console/scenarios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Note something the docs do not say, against the screen it is about. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'console only' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { productId?: string } | null;
  const db = getDb();
  if (!body?.productId || !db.prepare('SELECT 1 FROM products WHERE id = ?').get(body.productId)) {
    return NextResponse.json({ error: 'unknown product' }, { status: 404 });
  }
  const r = addGap(db, body.productId, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
