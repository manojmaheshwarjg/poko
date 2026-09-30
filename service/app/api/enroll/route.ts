import { getDb } from '@/lib/db';
import { createEnrollment, enrollmentsFor } from '@/lib/enroll';
import { fail, ok, preflight } from '@/lib/http';
import { esc, resultPage } from '@/lib/page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(request: Request) {
  return preflight(request);
}

function productFor(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return null;
  return getDb().prepare('SELECT id, origin FROM products WHERE origin = ?').get(origin) as { id: string; origin: string } | undefined;
}

/* Phase M: issue a vendor enrollment code. An admin action: in production this sits
   behind the product admin's sign-in, which this prototype does not have. */
export async function POST(request: Request) {
  const product = productFor(request);
  if (!product) return fail(request, 404, 'unknown product');
  const form = request.headers.get('content-type')?.includes('form') ? await request.formData() : null;
  const note = form?.get('note')?.toString().slice(0, 80) || null;
  const { code, expiresAt } = createEnrollment(getDb(), product.id, { note: note ?? undefined });
  /* A form post from the console gets a page showing the code once. Never a redirect
     carrying it: a code in a URL ends up in history and in server logs. */
  if (form) {
    return resultPage(
      'Vendor enrollment code',
      `<p>Enter this once in the extension's settings, on the vendor's demo browser. It works for one install, expires ${esc(new Date(expiresAt).toLocaleString())}, and is not shown again.</p><code class="big">${esc(code)}</code>`,
      `/onboard?origin=${encodeURIComponent(product.origin)}`,
      201
    );
  }
  return ok(request, { code, expiresAt });
}

export function GET(request: Request) {
  const product = productFor(request);
  if (!product) return fail(request, 404, 'unknown product');
  return ok(request, { enrollments: enrollmentsFor(getDb(), product.id) });
}
