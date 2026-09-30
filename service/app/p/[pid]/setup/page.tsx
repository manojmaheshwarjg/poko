import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { productState } from '@/lib/console/model';
import { Icon } from '../../../_ui/icons';
import { SetupLearn } from './SetupLearn';

export const dynamic = 'force-dynamic';

/* Onboarding as a checklist: six steps, each done or not by what is stored, with the
   next thing to do and where to do it. */
export default async function SetupPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const base = `/p/${pid}`;
  const state = productState(getDb(), pid, base);
  if (!state) notFound();
  const done = state.setup.filter((s) => s.done).length;
  const next = state.setup.find((s) => !s.done) ?? null;
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-h">
        <h1>
          Set up <span className="mono" style={{ fontSize: 15 }}>{new URL(state.product.origin).host}</span>
        </h1>
        <span className="pill" data-s={done === state.setup.length ? 'ok' : 'accent'}>
          {done} of {state.setup.length} done
        </span>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {state.setup.map((s, i) => (
          <div
            key={s.key}
            className="row"
            style={{ padding: '12px 16px', borderBottom: i < state.setup.length - 1 ? '1px solid var(--line)' : undefined, background: s === next ? 'var(--accent-bg)' : undefined, alignItems: 'flex-start' }}
          >
            <span
              style={{
                width: 22, height: 22, borderRadius: '50%', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                background: s.done ? 'var(--verified-bg)' : 'var(--surface)', border: `1px solid ${s.done ? 'var(--verified-line)' : 'var(--line-2)'}`, color: s.done ? 'var(--verified-text)' : 'var(--text-3)',
                fontSize: 11, fontWeight: 600,
              }}
            >
              {s.done ? <Icon name="check" size={13} /> : i + 1}
            </span>
            <span className="grow">
              <b style={{ fontWeight: 600 }}>{s.title}</b>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {s.detail}
              </span>
            </span>
            {s.cta === 'Run learning' ? (
              <SetupLearn origin={state.product.origin} />
            ) : s.cta && s.href ? (
              <Link className={`btn btn-sm ${s === next ? 'btn-primary' : ''}`} href={s.href}>
                {s.cta}
              </Link>
            ) : s.href ? (
              <Link className="btn btn-sm btn-ghost" href={s.href}>
                Open
              </Link>
            ) : null}
          </div>
        ))}
      </div>
      {state.attention.length ? (
        <div className="section">
          <h2>Needs attention</h2>
          <div className="card">
            <div className="card-b col" style={{ gap: 8 }}>
              {state.attention.map((a) => (
                <div key={a.text} className="row">
                  <span className="dot" data-s={a.tone === 'bad' ? 'rejected' : a.tone === 'warn' ? 'held' : 'candidate'} />
                  <span className="grow">{a.text}</span>
                  {a.cta === 'Run learning' ? (
                    <SetupLearn origin={state.product.origin} />
                  ) : (
                    <Link className="btn btn-sm" href={a.href}>
                      {a.cta}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
