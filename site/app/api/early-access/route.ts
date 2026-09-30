import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Early-access signups, and questions Ask Poko couldn't answer. Where they go is not
   decided yet:
   - EARLY_ACCESS_WEBHOOK_URL set: each entry is POSTed there as JSON (a form service, a
     database function, a chat channel).
   - Local development without it: appended to .data/early-access.jsonl (git-ignored).
   - Production without it: refused with a clear message, so nothing is silently lost. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send the form as JSON.' }, { status: 400 });
  }
  const { email, website, question } = (body ?? {}) as { email?: unknown; website?: unknown; question?: unknown };

  /* A filled hidden field means a bot. Answer as if it worked and keep nothing. */
  if (typeof website === 'string' && website.trim() !== '') return NextResponse.json({ ok: true });

  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (clean.length > 254 || !EMAIL.test(clean)) {
    return NextResponse.json({ error: 'Enter a valid work email.' }, { status: 400 });
  }
  const asked = typeof question === 'string' ? question.trim().slice(0, 500) : '';
  const entry = { email: clean, ...(asked ? { question: asked } : {}), at: new Date().toISOString() };

  const hook = process.env.EARLY_ACCESS_WEBHOOK_URL;
  if (hook) {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => null);
    if (!res || !res.ok) {
      return NextResponse.json({ error: "Couldn't save that. Try again in a minute." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (process.env.NODE_ENV !== 'production') {
    const dir = path.join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, 'early-access.jsonl'), `${JSON.stringify(entry)}\n`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Signups aren't open yet. Check back soon." }, { status: 503 });
}
