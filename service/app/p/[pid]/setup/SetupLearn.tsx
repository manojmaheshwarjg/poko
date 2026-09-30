'use client';

import { useRouter } from 'next/navigation';
import { runLearning } from '../../../_ui/actions';

export function SetupLearn({ origin }: { origin: string }) {
  const router = useRouter();
  return (
    <button className="btn btn-sm btn-primary" onClick={async () => (await runLearning(origin)) && router.refresh()}>
      Run learning, free
    </button>
  );
}
