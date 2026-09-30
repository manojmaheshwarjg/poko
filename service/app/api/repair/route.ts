import { callRepair, type Observation } from '@/lib/planner';
import { hasCorpus } from '@/lib/corpus';
import { fail, ok, preflight, requireConfig } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const blocked = requireConfig(request);
  if (blocked) return blocked;

  let body: { tool?: string; goal?: string; intent?: string; observation?: Observation };
  try {
    body = await request.json();
  } catch {
    return fail(request, 400, 'Body must be JSON.');
  }

  const { tool, goal, intent } = body;
  if (!tool || !goal || !intent) return fail(request, 400, 'tool, goal and intent are required.');
  if (!hasCorpus(tool)) return fail(request, 400, `No documentation is loaded for tool "${tool}".`);
  if (!body.observation?.nodes?.length) return fail(request, 400, 'observation is required.');

  try {
    const result = await callRepair({ tool, goal, intent, observation: body.observation });
    return ok(request, result);
  } catch (error) {
    return fail(request, 502, error instanceof Error ? error.message : String(error));
  }
}
