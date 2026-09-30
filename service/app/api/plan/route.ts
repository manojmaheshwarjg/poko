import { callPlanner, toRunnerPlan, type Observation } from '@/lib/planner';
import { hasCorpus } from '@/lib/corpus';
import { getDb } from '@/lib/db';
import { attribute, expectationsFor, loadKnownRoutes, rankKnown, renderKnown, withheldForScope } from '@/lib/learn/known.ts';
import { cors, fail, ok, preflight, requireConfig } from '@/lib/http';
import { usageContext } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const blocked = requireConfig(request);
  if (blocked) return blocked;

  let body: { tool?: string; goal?: string; observation?: Observation; origin?: string; useRoutes?: boolean; includeHeld?: boolean };
  try {
    body = await request.json();
  } catch {
    return fail(request, 400, 'Body must be JSON.');
  }

  const tool = body.tool?.trim();
  const goal = body.goal?.trim();
  if (!tool) return fail(request, 400, 'tool is required.');
  if (!hasCorpus(tool)) return fail(request, 400, `No documentation is loaded for tool "${tool}".`);
  if (!goal) return fail(request, 400, 'goal is required.');
  if (!body.observation?.nodes?.length) {
    return fail(request, 400, 'observation with at least one node is required.');
  }

  /* Verified routes for this product, if the caller says which product it is.
     `useRoutes: false` turns them off, which is how the eval measures whether
     learning helped or hurt (G9). `includeHeld` also offers routes held back by a
     failed comparison; it exists for the eval, and the panel never sends it. */
  let offered: ReturnType<typeof rankKnown> = [];
  let withheld: ReturnType<typeof withheldForScope> = [];
  if (body.origin && body.useRoutes !== false) {
    const db = getDb();
    const product = db.prepare('SELECT id FROM products WHERE origin = ?').get(body.origin) as { id: string } | undefined;
    if (product) {
      const known = loadKnownRoutes(db, product.id, { includeHeld: body.includeHeld === true });
      offered = rankKnown(known, goal);
      withheld = withheldForScope(known, goal);
    }
  }

  /* A comparison queued from the console runs the eval, which marks its requests with
     the job they belong to so the run's cost can be read back per run. Only a number
     is accepted; anything else is ignored. */
  const jobHeader = request.headers.get('x-sekva-job');
  const jobId = jobHeader && /^\d{1,9}$/.test(jobHeader) ? Number(jobHeader) : undefined;

  try {
    const plan = await usageContext.run({ jobId }, () =>
      callPlanner({ tool, goal, observation: body.observation!, known: renderKnown(offered) })
    );
    const claim = attribute(plan, offered);
    const attribution = {
      route: claim.route ? { id: claim.route.id, pathHash: claim.route.pathHash, label: claim.route.label } : null,
      expects: claim.route ? expectationsFor(plan, claim.route) : [],
      note: claim.note,
    };
    /* cannot and nothing_to_do carry no steps, so there is no plan to run. They
       are still successful answers, not errors. */
    if (plan.outcome === 'cannot' || plan.outcome === 'nothing_to_do') {
      return ok(request, {
        outcome: plan.outcome,
        understood: plan.understood,
        limitation: plan.limitation,
        plan: null,
        /* Reported for every outcome: G9 has to know what was offered even when the
           answer was that nothing can be done. */
        knownOffered: offered.map((r) => r.id),
        knownWithheld: withheld,
      });
    }
    return ok(request, {
      outcome: plan.outcome,
      understood: plan.understood,
      limitation: plan.limitation,
      plan: toRunnerPlan(plan, tool, goal, attribution),
      knownOffered: offered.map((r) => r.id),
      knownWithheld: withheld,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(request, 502, message);
  }
}

export { cors };
