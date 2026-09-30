import { z } from 'zod';
import { getDb } from '@/lib/db';
import { recordFeedback } from '@/lib/learn/feedback.ts';
import { fail, ok, preflight } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  origin: z.string().url(),
  routeId: z.string().min(1).max(64),
  pathHash: z.string().min(1).max(64),
  installId: z.string().min(8).max(64),
  kind: z.enum(['completed', 'skipped', 'repaired', 'wrongScreen']),
  step: z.number().int().min(0).nullable().optional(),
});

export function OPTIONS(request: Request) {
  return preflight(request);
}

/* How a verified route fared when someone actually used it. No model call. */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(request, 400, 'body must be JSON');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return fail(request, 400, parsed.error.issues[0]?.message ?? 'invalid feedback');
  const db = getDb();
  const product = db.prepare('SELECT id FROM products WHERE origin = ?').get(new URL(parsed.data.origin).origin) as { id: string } | undefined;
  if (!product) return fail(request, 404, 'unknown product');
  const result = recordFeedback(db, { productId: product.id, ...parsed.data });
  if (!result.recorded) return fail(request, 404, result.reason ?? 'not recorded');
  return ok(request, result);
}
