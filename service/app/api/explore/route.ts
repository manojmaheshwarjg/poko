import { getDb } from '@/lib/db';
import { ingestExploration } from '@/lib/explore';
import { fail, ok, preflight } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function OPTIONS(request: Request) {
  return preflight(request);
}

/* Phase G: pages found by read-only exploration. Vendor installs only; see lib/explore.ts. */
export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return fail(request, 413, 'batch too large');

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return fail(request, 413, 'batch too large');
    body = JSON.parse(text);
  } catch {
    return fail(request, 400, 'body must be JSON');
  }

  const result = ingestExploration(getDb(), body);
  if ('error' in result) return fail(request, result.status, result.error);
  return ok(request, result);
}
