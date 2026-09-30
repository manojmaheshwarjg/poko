import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { fixtureScreens } from '@/lib/console/evaluations';
import { plain, when } from '@/lib/console/format';
import { gapsFor } from '@/lib/console/scenarios';
import { afterStruggle, copilotCases, listStruggles, STRUGGLE_CHIPS } from '@/lib/console/struggles';
import { Icon } from '../../../_ui/icons';
import { StruggleActions } from './StruggleActions';

export const dynamic = 'force-dynamic';

/* Where people get stuck, one at a time: what happened, where those people went next,
   what the copilot proposed when it was the one that was wrong, and a way to turn it
   into a scenario the eval checks or a note of what the docs leave out. */
export default async function StrugglesPage({
  params,
  searchParams,
}: {
  params: Promise<{ pid: string }>;
  searchParams: Promise<{ id?: string; kind?: string; note?: string }>;
}) {
  const { pid } = await params;
  const { id, kind, note } = await searchParams;
  const db = getDb();
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(pid) as { id: string; origin: string; tool: string } | undefined;
  if (!product) notFound();
  const base = `/p/${pid}`;
  const names = new Map((db.prepare('SELECT id, display_name FROM screens WHERE product_id = ?').all(pid) as Array<{ id: string; display_name: string }>).map((s) => [s.id, s.display_name]));
  const all = listStruggles(db, pid, (x) => names.get(x) ?? x);
  const kinds = [...new Set(all.map((s) => s.kind))];
  const shown = kind === 'copilot' ? all.filter((s) => s.copilot) : kind ? all.filter((s) => s.kind === kind) : all;
  const sel = all.find((s) => s.id === id) ?? shown[0] ?? null;
  const after = sel ? afterStruggle(db, pid, sel) : null;
  const cases = sel && sel.copilot ? copilotCases(db, pid, sel.screen_id, [sel.kind]) : [];
  const fixture = fixtureScreens();
  const gaps = gapsFor(db, pid);
  const now = Date.now();
  const next = after?.next[0] ? names.get(after.next[0].screen) ?? null : null;
  const noteScreen = note && names.has(note) ? { id: note, name: names.get(note)! } : null;

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="page-h">
        <h1>Struggles</h1>
        <span className="muted">Where people get stuck, and where the copilot was wrong. Each one can become a check.</span>
      </div>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Link className="chip" aria-pressed={!kind} href={`${base}/struggles`}>
          All <span className="n">{all.length}</span>
        </Link>
        {all.some((s) => s.copilot) ? (
          <Link className="chip" aria-pressed={kind === 'copilot'} href={`${base}/struggles?kind=copilot`}>
            The copilot&apos;s own <span className="n">{all.filter((s) => s.copilot).length}</span>
          </Link>
        ) : null}
        {kinds
          .filter((k) => !k.startsWith('copilot'))
          .map((k) => (
            <Link key={k} className="chip" aria-pressed={kind === k} href={`${base}/struggles?kind=${k}`}>
              {STRUGGLE_CHIPS[k] ?? k} <span className="n">{all.filter((s) => s.kind === k).length}</span>
            </Link>
          ))}
      </div>

      {!all.length ? (
        <div className="card">
          <div className="empty">No struggles yet. They come from real use: people backing out, clicking things that do nothing, undoing changes.</div>
          {noteScreen ? (
            <div className="card-b">
              <StruggleActions productId={pid} struggle={null} nextName={null} fixture={fixture} openNote={noteScreen} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {shown.map((s) => (
              <Link
                key={s.id}
                href={`${base}/struggles?id=${s.id}${kind ? `&kind=${kind}` : ''}`}
                className="row"
                style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', alignItems: 'flex-start', background: sel?.id === s.id ? 'var(--accent-bg)' : undefined }}
              >
                <Icon name="alert" size={14} style={{ color: s.copilot ? 'var(--accent)' : 'var(--bad)', marginTop: 2 }} />
                <span className="grow">
                  <span style={{ display: 'block' }}>{s.title}</span>
                  <span className="faint" style={{ fontSize: 11.5 }}>
                    {s.chip} &middot; {s.screenName}
                  </span>
                </span>
                <span className="mono faint">{s.installs}</span>
              </Link>
            ))}
          </div>

          {sel ? (
            <div className="col" style={{ gap: 12 }}>
              <div className="card">
                <div className="card-b">
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <span className="pill" data-s={sel.copilot ? 'accent' : 'bad'}>
                      {sel.chip}
                    </span>
                    <Link href={`${base}/map?screen=${sel.screen_id}`} className="row" style={{ gap: 5, color: 'var(--accent-text)' }}>
                      <Icon name="map" size={13} /> {sel.screenName}
                    </Link>
                  </div>
                  <h2 style={{ marginTop: 10, fontSize: 15 }}>{sel.title}</h2>
                  <div className="kv" style={{ marginTop: 10, maxWidth: 300 }}>
                    <span className="muted">People</span>
                    <span>{sel.installs}</span>
                    <span className="muted">Times</span>
                    <span>{sel.attempts}</span>
                    {sel.control_text ? (
                      <>
                        <span className="muted">Control</span>
                        <span>{sel.control_text}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {sel.copilot ? (
                <div className="card">
                  <div className="card-h">
                    <h3>What the copilot proposed, and what the person did instead</h3>
                  </div>
                  <div className="card-b col">
                    {cases.length ? (
                      cases.map((c, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div className="note">
                            <div className="faint" style={{ fontSize: 11 }}>The copilot proposed &middot; {when(c.at, now)}</div>
                            <b style={{ fontWeight: 600 }}>{c.proposed}</b>
                          </div>
                          <div className="note" data-tone="accent">
                            <div style={{ fontSize: 11, opacity: 0.8 }}>The person did next</div>
                            <b style={{ fontWeight: 600 }}>{c.didNext.length ? c.didNext.join(', then ') : 'nothing recorded within ten minutes'}</b>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted">The individual decisions behind this are not placed on this screen any more; learning placed them here when it ran.</p>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="card">
                <div className="card-h">
                  <h3>Where they went next</h3>
                  <span className="faint">{after?.episodes ?? 0} sessions with this struggle</span>
                </div>
                <div className="card-b col" style={{ gap: 7 }}>
                  {after && after.next.length ? (
                    after.next.map((n) => (
                      <div key={n.screen} className="row">
                        <span style={{ width: 150 }} className="ellipsis">
                          {names.get(n.screen) ?? n.screen}
                        </span>
                        <span style={{ flex: 1, height: 8, background: 'var(--hover)', borderRadius: 4, overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: '100%', width: `${Math.round((n.count / after.episodes) * 100)}%`, background: 'var(--accent-line)' }} />
                        </span>
                        <span className="mono muted" style={{ width: 60, textAlign: 'right' }}>
                          {n.count} of {after.episodes}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No later screen recorded in the same sessions.</p>
                  )}
                  {next && sel.kind === 'backtrack' ? (
                    <p className="muted" style={{ marginTop: 4 }}>
                      Most went on to {next}. They may have been looking for it when they opened {sel.screenName}.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="card">
                <div className="card-h">
                  <h3>Turn it into</h3>
                </div>
                <div className="card-b">
                  <StruggleActions
                    productId={pid}
                    struggle={plain({ id: sel.id, title: sel.title, screenId: sel.screen_id, screenName: sel.screenName, kind: sel.kind })}
                    nextName={next}
                    fixture={fixture}
                    openNote={noteScreen}
                  />
                </div>
              </div>

              {gaps.filter((g) => g.screen_id === sel.screen_id).length ? (
                <div className="card">
                  <div className="card-h">
                    <h3>Docs gaps noted on {sel.screenName}</h3>
                  </div>
                  <div className="card-b col" style={{ gap: 6 }}>
                    {gaps
                      .filter((g) => g.screen_id === sel.screen_id)
                      .map((g) => (
                        <div key={g.id} className="row" style={{ alignItems: 'flex-start' }}>
                          <Icon name="note" size={13} style={{ color: 'var(--docs)', marginTop: 2 }} />
                          <span className="grow">{g.note}</span>
                          <span className="mono faint">{when(g.created_at, now)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="card empty">Nothing matches that filter.</div>
          )}
        </div>
      )}
    </div>
  );
}
