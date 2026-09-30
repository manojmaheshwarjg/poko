import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { addScenario } from '@/lib/console/scenarios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Add an evaluation scenario from the console. Writes eval/scenarios.added.json and
   nothing else; it runs in the next comparison someone queues. No model call. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'console only' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { productId?: string } | null;
  if (!body?.productId || !getDb().prepare('SELECT 1 FROM products WHERE id = ?').get(body.productId)) {
    return NextResponse.json({ error: 'unknown product' }, { status: 404 });
  }
  const r = addScenario(body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
