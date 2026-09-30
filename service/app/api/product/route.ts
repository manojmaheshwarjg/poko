import { getDb } from '@/lib/db';
import { productForOrigin, promotedLabels } from '@/lib/ingest';
import { fail, ok, preflight } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(request: Request) {
  return preflight(request);
}

/* Returns the per-product hashing key and the labels currently promoted for clear
   text. The key has to reach every install of a product so they all hash the same
   label the same way. In production this must sit behind install authentication:
   anyone holding the key can test guesses against low-entropy labels. */
export function GET(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return fail(request, 400, 'origin is required');
  let normalised: string;
  try {
    normalised = new URL(origin).origin;
  } catch {
    return fail(request, 400, 'origin must be a URL');
  }
  const db = getDb();
  const product = productForOrigin(db, normalised);
  return ok(request, { productId: product.id, key: product.key, promoted: [...promotedLabels(db, product.id)] });
}
