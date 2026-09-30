import { getDb } from '@/lib/db';
import { contextFor } from '@/lib/retrieval';
import { runVerification } from '@/lib/learn/verify';
import { verificationPreview } from '@/lib/onboard';
import { esc, resultPage } from '@/lib/page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Phase O: run verification from the console. This spends money, so it runs only when
   the form says it may (the person ticked the confirmation) and only if the number of
   calls it was shown is still the number it would make: if anything changed since the
   page was loaded, it refuses and asks for another look. */
export async function POST(request: Request) {
  const form = await request.formData();
  const origin = String(form.get('origin') ?? '');
  const back = `/onboard?origin=${encodeURIComponent(origin)}`;
  const db = getDb();
  const product = db.prepare('SELECT id, tool FROM products WHERE origin = ?').get(origin) as { id: string; tool: string } | undefined;
  if (!product) return resultPage('Verification did not run', '<p class="bad">Unknown product.</p>', '/onboard', 404);
  if (form.get('confirm') !== 'yes') {
    return resultPage('Verification did not run', '<p class="warn">It makes paid model calls, so it needs the confirmation ticked.</p>', back, 400);
  }
  const preview = verificationPreview(db, product.id, product.tool);
  if (Number(form.get('calls')) !== preview.calls || !preview.calls) {
    return resultPage('Verification did not run', `<p class="warn">The plan changed since the page was loaded (now ${preview.calls} calls). Look again before running it.</p>`, back, 409);
  }
  /* Loaded here, on a confirmed request only: the one module that reaches the model. */
  const { modelDeps } = await import('@/lib/learn/model-deps');
  let deps;
  try {
    deps = modelDeps();
  } catch (err) {
    return resultPage('Verification did not run', `<p class="bad">${esc(err instanceof Error ? err.message : String(err))}</p>`, back, 500);
  }
  const result = await runVerification(db, product.id, deps, {
    tool: product.tool,
    maxCalls: preview.calls,
    docs: (q) => contextFor(product.tool, q).text,
  });
  const items = result.processed
    .map((p) => `<li><strong>${esc(p.outcome)}</strong> ${esc(p.title)}${p.label ? `: <em>${esc(p.label)}</em>` : ''} <span>(${p.calls} call${p.calls === 1 ? '' : 's'}; ${esc(p.reason)})</span></li>`)
    .join('');
  return resultPage(
    'Verification finished',
    `<p>${result.callsUsed} call${result.callsUsed === 1 ? '' : 's'} used.${result.stoppedBecause ? ` <span class="warn">Stopped: ${esc(result.stoppedBecause)}.</span>` : ''}</p><ul>${items}</ul>`,
    back
  );
}
