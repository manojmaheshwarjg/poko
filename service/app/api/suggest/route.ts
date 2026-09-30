import { getDb } from '@/lib/db';
import { fail, ok, preflight } from '@/lib/http';
import { suggestions } from '@/lib/console/wayfind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Things a person can ask for in this product: verified routes' labels. Free. */
export function OPTIONS(request: Request) {
  return preflight(request);
}

export function GET(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  const product = origin ? (getDb().prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined) : undefined;
  if (!product) return fail(request, 404, 'unknown product');
  return ok(request, { suggestions: suggestions(getDb(), product.id) });
}
