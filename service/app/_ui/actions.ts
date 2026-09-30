'use client';

import { toast } from './Toaster';

/* Free actions the console can run in place. Paid ones go through PaidAction, which
   shows the cost and asks first. */

export async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, data: { error: err instanceof Error ? err.message : String(err) } };
  }
}

export async function runLearning(origin: string): Promise<boolean> {
  toast('Learning…');
  const { ok, data } = await postJson(`/api/learn?origin=${encodeURIComponent(origin)}`);
  if (!ok) {
    toast(`Learning did not run: ${data.error ?? 'unknown error'}`, 'bad');
    return false;
  }
  const r = data.routes ?? {};
  const routes = Object.values(r as Record<string, number>).reduce((a, b) => a + b, 0);
  toast(`Learned ${data.screens} screens and ${routes} routes from ${data.transitions} actions. No model calls.`, 'ok');
  return true;
}
