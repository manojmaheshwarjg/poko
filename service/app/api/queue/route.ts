import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { cancel, enqueue } from '@/lib/console/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Queue a paid run from the console, or cancel one. Queueing is the approval: the body
   carries the exact number of calls the person was shown and ticked, and the queue
   refuses a run that would now make a different number. Same-origin only; nothing
   here makes a call itself. */

const Body = z.object({
  productId: z.string().min(1).max(64),
  kind: z.enum(['verify', 'compare']),
  calls: z.number().int().positive().max(10_000),
  when: z.enum(['now', 'next-morning']),
  options: z.object({ includeHeld: z.boolean().optional(), apply: z.boolean().optional() }).optional(),
});

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'the queue takes requests from the console only' }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad request' }, { status: 400 });
  const db = getDb();
  const product = db.prepare('SELECT id, tool FROM products WHERE id = ?').get(parsed.data.productId) as { id: string; tool: string } | undefined;
  if (!product) return NextResponse.json({ error: 'unknown product' }, { status: 404 });
  const r = enqueue(db, product, { kind: parsed.data.kind, calls: parsed.data.calls, when: parsed.data.when, options: parsed.data.options });
  if (!r.ok) return NextResponse.json({ error: r.reason, calls: r.calls ?? null }, { status: 409 });
  return NextResponse.json({ job: r.job }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'the queue takes requests from the console only' }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (!cancel(getDb(), id)) return NextResponse.json({ error: 'only a run that has not started can be cancelled' }, { status: 409 });
  return NextResponse.json({ cancelled: id });
}
