import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { productForOrigin } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Add a product from the console, with the docs corpus it uses, and go to its map. */
export async function POST(request: Request) {
  const form = await request.formData();
  let origin: string;
  try {
    origin = new URL(String(form.get('origin') ?? '')).origin;
  } catch {
    return NextResponse.json({ error: 'origin must be a URL' }, { status: 400 });
  }
  if (!/^https?:$/.test(new URL(origin).protocol)) return NextResponse.json({ error: 'origin must be http or https' }, { status: 400 });
  const tool = String(form.get('tool') ?? '').trim().toLowerCase() || 'jira';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(tool)) return NextResponse.json({ error: 'docs name: letters, digits and dashes' }, { status: 400 });
  const db = getDb();
  const product = productForOrigin(db, origin);
  db.prepare('UPDATE products SET tool = ? WHERE id = ?').run(tool, product.id);
  return NextResponse.redirect(new URL(`/p/${product.id}/map`, request.url), 303);
}
