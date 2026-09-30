'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from '../../../_ui/actions';
import { toast } from '../../../_ui/Toaster';

/* Applies a comparison's G9 verdict: hold what made planning worse, release what was
   held and did no harm. Free: it reads the results file, it calls nothing. */
export function ApplyVerdict({ productId, file, hold, release }: { productId: string; file: string; hold: number; release: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    const { ok, data } = await postJson('/api/g9', { productId, file });
    setBusy(false);
    if (!ok) {
      toast(`Not applied: ${data.error ?? 'unknown error'}`, 'bad');
      return;
    }
    toast(`Applied: ${data.held.length} held, ${data.released.length} released.`, 'ok');
    router.refresh();
  };
  return (
    <button className="btn btn-primary btn-sm" onClick={apply} disabled={busy}>
      Apply verdict: hold {hold}, release {release}
    </button>
  );
}
