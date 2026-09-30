'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from './icons';
import { postJson } from './actions';
import { toast } from './Toaster';

/* Every paid action goes through here. Nothing that costs money is one click away:
   the button opens this, which shows the exact number of calls, the tokens they are
   expected to use and what that leaves today, and needs an explicit tick before either
   button will spend anything. Confirming queues the run with exactly that many calls;
   the queue refuses to make more. */

export type Offer = {
  kind: 'verify' | 'compare';
  calls: number;
  tokens: number;
  measured: boolean;
  fitsToday: boolean;
  minutes: number;
  nextSlot: number;
  budget: { usedToday: number; limit: number; left: number; reservedToday: number };
};

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function PaidAction({
  productId,
  offer,
  label,
  title,
  explain,
  held = 0,
  variant = 'primary',
  size,
}: {
  productId: string;
  offer: Offer;
  label?: string;
  title: string;
  explain: string;
  held?: number;
  variant?: 'primary' | 'default';
  size?: 'sm';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [includeHeld, setIncludeHeld] = useState(held > 0);
  const [apply, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const after = offer.budget.left - offer.budget.reservedToday - offer.tokens;

  if (!offer.calls) {
    return (
      <button className={`btn ${size === 'sm' ? 'btn-sm' : ''}`} disabled title={offer.kind === 'verify' ? 'Nothing is waiting to be verified' : 'No scenarios to compare'}>
        {label ?? (offer.kind === 'verify' ? 'Verify' : 'Compare')}, 0 calls
      </button>
    );
  }

  const submit = async (whenRun: 'now' | 'next-morning') => {
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson('/api/queue', {
      productId,
      kind: offer.kind,
      calls: offer.calls,
      when: whenRun,
      options: offer.kind === 'compare' ? { includeHeld, apply } : {},
    });
    setBusy(false);
    if (!ok) {
      setError(data.error ?? 'It was not queued.');
      return;
    }
    setOpen(false);
    setApproved(false);
    toast(whenRun === 'now' ? `Queued #${data.job.id}: starts within a few seconds.` : `Queued #${data.job.id} for ${when(data.job.run_after)}. Cancel it any time before then.`, 'ok');
    router.refresh();
  };

  return (
    <>
      <button className={`btn ${variant === 'primary' ? 'btn-primary' : ''} ${size === 'sm' ? 'btn-sm' : ''}`} onClick={() => setOpen(true)}>
        <Icon name={offer.kind === 'verify' ? 'check' : 'compare'} size={14} />
        {label ?? (offer.kind === 'verify' ? 'Verify' : 'Compare')}, {offer.calls} {offer.calls === 1 ? 'call' : 'calls'}
      </button>
      {open ? (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <div className="dialog" role="dialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && !busy && setOpen(false)}>
            <div className="dialog-h">
              <h2>{title}</h2>
            </div>
            <div className="dialog-b">
              <p className="muted" style={{ lineHeight: 1.55 }}>
                {explain}
              </p>
              <div className="cost">
                <div>
                  <b>{offer.calls}</b>
                  <span>paid calls, exactly</span>
                </div>
                <div>
                  <b>~{k(offer.tokens)}</b>
                  <span>{offer.measured ? 'tokens, from your average' : 'tokens, estimated'}</span>
                </div>
                <div>
                  <b style={{ color: after < 0 ? 'var(--bad-text)' : undefined }}>{k(Math.max(0, after))}</b>
                  <span>left today after it</span>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                The provider allows {k(offer.budget.limit)} tokens a day; {k(offer.budget.usedToday)} used since midnight
                {offer.budget.reservedToday ? `, ${k(offer.budget.reservedToday)} promised to runs queued for today` : ''}. At its per-minute limit this takes about {offer.minutes}{' '}
                {offer.minutes === 1 ? 'minute' : 'minutes'}.
              </p>
              {offer.kind === 'compare' ? (
                <div className="col" style={{ gap: 6 }}>
                  <label className="check">
                    <input type="checkbox" checked={includeHeld} onChange={(e) => setIncludeHeld(e.target.checked)} />
                    <span>
                      Offer held routes too{held ? ` (${held} held)` : ''}. A clean comparison that offered them is the only way to release them.
                    </span>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
                    <span>Apply the verdict when it finishes: hold routes that made planning worse, release held ones that did no harm.</span>
                  </label>
                </div>
              ) : null}
              {!offer.fitsToday ? (
                <div className="note" data-tone="warn">
                  It does not fit what is left today. Queue it for {when(offer.nextSlot)}, when the daily budget has reset, rather than have it stop half way.
                </div>
              ) : null}
              <label className="check">
                <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
                <span>
                  I approve {offer.calls} paid model {offer.calls === 1 ? 'call' : 'calls'}.
                </span>
              </label>
              {error ? (
                <div className="note" data-tone="bad">
                  {error}
                </div>
              ) : null}
            </div>
            <div className="dialog-f">
              <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn" disabled={!approved || busy} onClick={() => submit('next-morning')}>
                Queue for {when(offer.nextSlot)}
              </button>
              {offer.fitsToday ? (
                <button className="btn btn-primary" disabled={!approved || busy} onClick={() => submit('now')}>
                  Run now, {offer.calls} {offer.calls === 1 ? 'call' : 'calls'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
