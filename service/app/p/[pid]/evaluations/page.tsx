import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { comparisonDetail, comparisonsFor } from '@/lib/console/evaluations';
import { when } from '@/lib/console/format';
import { offer } from '@/lib/console/queue';
import { Icon } from '../../../_ui/icons';
import { PaidAction } from '../../../_ui/PaidAction';
import { ApplyVerdict } from './ApplyVerdict';
import { plain } from '@/lib/console/format';

export const dynamic = 'force-dynamic';

const CHANGE: Record<string, { label: string; s: string }> = {
  regressed: { label: 'worse with routes', s: 'regressed' },
  inconclusive: { label: 'no answer', s: 'inconclusive' },
  'still-failing': { label: 'fails either way', s: 'warn' },
  improved: { label: 'better with routes', s: 'improved' },
  same: { label: 'same', s: '' },
};

/* Evaluations: every with/without comparison for this product, and one of them read
   like a code review. Scenarios where learning made planning worse come first; each
   plan is shown as a diff of the other. */
export default async function EvaluationsPage({ params, searchParams }: { params: Promise<{ pid: string }>; searchParams: Promise<{ file?: string }> }) {
  const { pid } = await params;
  const { file } = await searchParams;
  const db = getDb();
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(pid) as { id: string; origin: string; tool: string } | undefined;
  if (!product) notFound();
  const base = `/p/${pid}`;
  const list = comparisonsFor(db, pid, product.origin);
  const current = list.find((c) => c.file === file) ?? list[0] ?? null;
  const detail = current ? comparisonDetail(db, pid, current.file) : null;
  const routes = new Map(
    (db.prepare('SELECT id, status, COALESCE(title, label, id) AS name FROM routes WHERE product_id = ?').all(pid) as Array<{ id: string; status: string; name: string }>).map((r) => [r.id, r])
  );
  const held = [...routes.values()].filter((r) => r.status === 'held').length;
  const now = Date.now();
  const cmp = plain(offer(db, product, 'compare'));

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="page-h">
        <h1>Evaluations</h1>
        <span className="muted">Every scenario planned twice, with learned routes and without. Learning is kept only if nothing gets worse.</span>
        <span className="grow" />
        <PaidAction
          productId={pid}
          offer={cmp}
          label="Queue a comparison"
          held={held}
          title="Compare with and without learned routes"
          explain="Every eval scenario is planned twice, with learned routes offered and without. The verdict holds routes that made planning worse and releases held ones that did no harm."
        />
      </div>

      {!list.length ? (
        <div className="card empty">No comparison has been run for this product yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {list.map((c) => (
              <Link
                key={c.file}
                href={`${base}/evaluations?file=${encodeURIComponent(c.file)}`}
                style={{ display: 'block', padding: '10px 12px', borderBottom: '1px solid var(--line)', background: current?.file === c.file ? 'var(--accent-bg)' : undefined }}
              >
                <div className="row">
                  <span className="mono" style={{ fontSize: 12 }}>
                    {when(c.at, now)}
                  </span>
                  <span className="grow" />
                  {c.verdict.regressed.length ? <span className="pill" data-s="regressed">{c.verdict.regressed.length} worse</span> : null}
                  {c.verdict.inconclusive.length ? <span className="pill" data-s="inconclusive">{c.verdict.inconclusive.length} unanswered</span> : null}
                  {!c.verdict.regressed.length && !c.verdict.inconclusive.length ? <span className="pill" data-s="ok">clean</span> : null}
                </div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                  docs only {c.verdict.docsOnly.passed}/{c.verdict.docsOnly.of} &middot; with routes {c.verdict.withRoutes.passed}/{c.verdict.withRoutes.of}
                  {c.inferred ? ' · product inferred' : ''}
                </div>
              </Link>
            ))}
          </div>

          {detail && current ? (
            <div className="col" style={{ gap: 12 }}>
              <div className="card">
                <div className="card-b">
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <span className="mono">{current.file}</span>
                    {current.includeHeld ? <span className="pill">held routes offered</span> : null}
                    {current.inferred ? (
                      <span className="pill" title="This run did not record its product. It offered routes that belong to this product, so it is shown here.">
                        product inferred from its routes
                      </span>
                    ) : null}
                  </div>
                  <div className="stat-grid" style={{ marginTop: 12 }}>
                    <div className="stat">
                      <b>
                        {detail.verdict.docsOnly.passed}/{detail.verdict.docsOnly.of}
                      </b>
                      <span>passed with docs only</span>
                    </div>
                    <div className="stat">
                      <b>
                        {detail.verdict.withRoutes.passed}/{detail.verdict.withRoutes.of}
                      </b>
                      <span>passed with routes</span>
                    </div>
                    <div className="stat">
                      <b style={{ color: detail.verdict.regressed.length ? 'var(--bad-text)' : undefined }}>{detail.verdict.regressed.length}</b>
                      <span>worse with routes</span>
                    </div>
                    <div className="stat">
                      <b style={{ color: detail.verdict.improved.length ? 'var(--verified-text)' : undefined }}>{detail.verdict.improved.length}</b>
                      <span>better with routes</span>
                    </div>
                    <div className="stat">
                      <b style={{ color: detail.verdict.inconclusive.length ? 'var(--gap-text)' : undefined }}>{detail.verdict.inconclusive.length}</b>
                      <span>got no answer</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-h">
                  <h3>What G9 does with it</h3>
                  <span className="grow" />
                  {!detail.g9.refused && (detail.g9.hold.some((h) => routes.get(h.id)?.status !== 'held') || detail.g9.release.length) ? (
                    <ApplyVerdict productId={pid} file={current.file} hold={detail.g9.hold.length} release={detail.g9.release.length} />
                  ) : null}
                </div>
                <div className="card-b col" style={{ gap: 6 }}>
                  {detail.g9.refused ? <p className="muted">{detail.g9.refused}</p> : null}
                  {detail.g9.hold.map((h) => (
                    <div key={h.id} className="row">
                      <span className="pill" data-s="held">
                        hold
                      </span>
                      <Link href={`${base}/map?route=${h.id}&compare=1`} className="grow ellipsis">
                        {routes.get(h.id)?.name ?? h.id}
                      </Link>
                      <span className="faint">{routes.get(h.id)?.status === 'held' ? 'held now' : `was ${h.was}`}</span>
                    </div>
                  ))}
                  {detail.g9.release.map((r) => (
                    <div key={r.id} className="row">
                      <span className="pill" data-s="verified">
                        release
                      </span>
                      <span className="grow ellipsis">{routes.get(r.id)?.name ?? r.id}</span>
                    </div>
                  ))}
                  {detail.g9.keep.map((k) => (
                    <div key={k.id} className="row" style={{ alignItems: 'flex-start' }}>
                      <span className="pill">stays held</span>
                      <span className="grow">
                        {routes.get(k.id)?.name ?? k.id}
                        <span className="faint" style={{ display: 'block', fontSize: 11.5 }}>
                          {k.why.replace(/some scenarios got no answer \(([^)]*)\)/, (_, ids: string) => `${ids.split(', ').length} scenarios got no answer`)}
                        </span>
                      </span>
                    </div>
                  ))}
                  {!detail.g9.refused && !detail.g9.hold.length && !detail.g9.release.length && !detail.g9.keep.length ? <p className="muted">Nothing to hold or release.</p> : null}
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-h">
                  <h3>Scenarios</h3>
                  <span className="faint">worst first</span>
                </div>
                {detail.scenarios.map((s) => {
                  const c = CHANGE[s.change];
                  return (
                    <details key={s.id} className="scn" open={s.change === 'regressed'}>
                      <summary>
                        <span className="pill" data-s={c.s || undefined}>
                          {c.label}
                        </span>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {s.id}
                        </span>
                        <span className="muted grow ellipsis">{s.goal}</span>
                        <span className="faint mono" style={{ fontSize: 11.5 }}>
                          {s.docsOnly?.outcome ?? '?'} → {s.withRoutes?.outcome ?? '?'}
                        </span>
                        <Icon name="chevron-down" size={13} />
                      </summary>
                      <div className="body">
                        <div className="sides">
                          {[
                            { t: 'Docs only', x: s.docsOnly },
                            { t: 'With routes', x: s.withRoutes },
                          ].map(({ t, x }) => (
                            <div key={t} className="side">
                              <h4>
                                {t}: <b style={{ color: 'var(--text)' }}>{x?.outcome ?? 'not run'}</b>
                              </h4>
                              {x?.error ? <p className="faint">{x.error.slice(0, 160)}</p> : null}
                              {x?.limitation ? <p className="muted" style={{ fontSize: 12 }}>{x.limitation}</p> : null}
                              {x?.problems.length ? (
                                <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--bad-text)', fontSize: 12 }}>
                                  {x.problems.map((p, i) => (
                                    <li key={i}>{p}</li>
                                  ))}
                                </ul>
                              ) : x && !x.error ? (
                                <p className="faint" style={{ fontSize: 12 }}>
                                  Passed the automatic checks.
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        {s.lines.length ? (
                          <div className="diff">
                            <div className="head">
                              <span>- docs only</span>
                              <span>+ with routes</span>
                              {s.followed ? <span>followed {routes.get(s.followed)?.name ?? s.followed}</span> : null}
                            </div>
                            {s.lines.map((l, i) => (
                              <div key={i} className="l" data-op={l.op}>
                                <span className="op">{l.op}</span>
                                <span>{l.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {s.offered.length ? (
                          <div className="row" style={{ flexWrap: 'wrap', fontSize: 12 }}>
                            <span className="muted">Routes offered:</span>
                            {s.offered.map((id) => (
                              <Link key={id} href={`${base}/map?route=${id}&compare=1`} className="chip" style={{ height: 22 }}>
                                <span className="dot" data-s={routes.get(id)?.status} />
                                {routes.get(id)?.name ?? id}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                        {s.why ? <p className="faint" style={{ fontSize: 12 }}>{s.why}</p> : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
