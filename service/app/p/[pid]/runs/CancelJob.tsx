'use client';

import { useRouter } from 'next/navigation';
import { toast } from '../../../_ui/Toaster';

/* Cancels a queued run. Only a run that has not started can be cancelled. */
export function CancelJob({ id }: { id: number }) {
  const router = useRouter();
  const cancel = async () => {
    const res = await fetch(`/api/queue?id=${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(`Not cancelled: ${data.error ?? res.status}`, 'bad');
      return;
    }
    toast(`Cancelled #${id}. Nothing was spent.`, 'ok');
    router.refresh();
  };
  return (
    <button className="btn btn-sm btn-danger" onClick={cancel}>
      Cancel
    </button>
  );
}
