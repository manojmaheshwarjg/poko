import { getDb } from '@/lib/db';
import { ingestDecisions } from '@/lib/decisions';
import { fail, ok, preflight } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(request: Request) {
  return preflight(request);
}

/* Phase L: copilot decisions, redacted in the browser, re-checked in lib/decisions.ts. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 256 * 1024) return fail(request, 413, 'batch too large');
    body = JSON.parse(text);
  } catch {
    return fail(request, 400, 'body must be JSON');
  }
  const result = ingestDecisions(getDb(), body);
  if ('error' in result) return fail(request, result.status, result.error);
  return ok(request, result);
}
