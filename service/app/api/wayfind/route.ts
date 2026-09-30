import { getDb } from '@/lib/db';
import { fail, ok, preflight } from '@/lib/http';
import { screensForWayfinding, wayfind } from '@/lib/console/wayfind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* "Take me there". GET lists the product's screens with their hashed keys, so the
   panel can tell which one the page is (hashes only; the panel hashes the live page
   with the same product key). POST returns the way from one screen to another along
   links people use. Neither calls a model. */

export function OPTIONS(request: Request) {
  return preflight(request);
}

function productFor(origin: string | null) {
  if (!origin) return undefined;
  return getDb().prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined;
}

export function GET(request: Request) {
  const product = productFor(new URL(request.url).searchParams.get('origin'));
  if (!product) return fail(request, 404, 'unknown product');
  return ok(request, { screens: screensForWayfinding(getDb(), product.id) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { origin?: string; from?: string; to?: string } | null;
  const product = productFor(body?.origin ?? null);
  if (!product) return fail(request, 404, 'unknown product');
  if (!body?.from || !body?.to) return fail(request, 400, 'from and to are required');
  const way = wayfind(getDb(), product.id, body.from, body.to);
  if (!way.ok) return fail(request, 409, way.reason);
  return ok(request, way);
}
