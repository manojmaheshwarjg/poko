import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { comparisonsFor } from '@/lib/console/evaluations';
import { plain, when } from '@/lib/console/format';
import { listJobs, offer, type JobOptions } from '@/lib/console/queue';
import { verificationPreview } from '@/lib/onboard';
import { budget, kTokens, tokensForJob } from '@/lib/usage';
import { PaidAction } from '../../../_ui/PaidAction';
import { CancelJob } from './CancelJob';

export const dynamic = 'force-dynamic';

/* Runs: everything that costs money, in one place. What today's spend is, what
   verification and a comparison would cost now, what is queued and when, and what
   ran. Nothing here starts a run without the confirmation in PaidAction. */
export default async function RunsPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const db = getDb();
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(pid) as { id: string; origin: string; tool: string } | undefined;
  if (!product) notFound();
  const base = `/p/${pid}`;
  const now = Date.now();
  const b = budget(db, now);
  const verify = plain(offer(db, product, 'verify', now));
  const compare = plain(offer(db, product, 'compare', now));
  const preview = verificationPreview(db, pid, product.tool);
  const held = (db.prepare("SELECT COUNT(*) AS n FROM routes WHERE product_id = ? AND status = 'held'").get(pid) as { n: number }).n;
  const jobs = listJobs(db, pid).map((j) => ({ ...j, used: tokensForJob(db, j.id), options: JSON.parse(j.options_json) as JobOptions, result: j.result_json ? JSON.parse(j.result_json) : null }));
  const checks = db
    .prepare('SELECT v.at, v.outcome, v.reason, v.calls, v.route_id, COALESCE(r.title, v.title, v.route_id) AS name FROM verifications v LEFT JOIN routes r ON r.id = v.route_id WHERE v.product_id = ? ORDER BY v.at DESC LIMIT 12')
    .all(pid) as Array<{ at: number; outcome: string; reason: string | null; calls: number; route_id: string; name: string }>;
  const comparisons = comparisonsFor(db, pid, product.origin, 6);
  const share = b.limit ? b.usedToday / b.limit : 0;

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-h">
        <h1>Runs</h1>
        <span className="muted">Everything that makes paid model calls. Each one shows its cost and waits for your approval.</span>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <b>{kTokens(b.usedToday)}</b>
          <span>tokens recorded since midnight</span>
          <div className="meter" data-tone={share > 0.85 ? 'bad' : share > 0.6 ? 'warn' : undefined} style={{ width: '100%', marginTop: 8 }}>
            <i style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
          </div>
        </div>
        <div className="stat">
          <b>{kTokens(b.left)}</b>
          <span>left today of the provider&apos;s {kTokens(b.limit)}</span>
        </div>
        <div className="stat">
          <b>{kTokens(b.reservedToday)}</b>
          <span>promised to runs queued for today</span>
        </div>
        <div className="stat">
          <b>{kTokens(b.minuteLimit)}</b>
          <span>a minute at most, so big runs take a while</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <div className="card" id="verify">
          <div className="card-h">
            <h3>Verify routes</h3>
            <span className="grow" />
            <PaidAction
              productId={pid}
              offer={verify}
              title="Verify routes"
              explain="Each route waiting is named by the model, then planned from its first screen with only that name. A route passes only if the plan is exactly the route; two calls a route."
            />
          </div>
          <div className="card-b col" style={{ gap: 6 }}>
            {preview.routes.length ? (
              preview.routes.map((r) => (
                <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="pill" data-s={r.willCall ? (r.held ? 'held' : 'candidate') : undefined}>
                    {r.willCall ? (r.held ? 're-check' : 'check') : 'skip'}
                  </span>
                  <Link href={`${base}/map?route=${r.id}`} className="grow">
                    {r.title}
                    {r.skipReason ? <span className="faint" style={{ display: 'block', fontSize: 11.5 }}>{r.skipReason}</span> : null}
                  </Link>
                </div>
              ))
            ) : (
              <p className="muted">Nothing waiting. Verified routes stay verified until the path people take changes.</p>
            )}
          </div>
        </div>
        <div className="card" id="compare">
          <div className="card-h">
            <h3>Compare with docs only</h3>
            <span className="grow" />
            <PaidAction
              productId={pid}
              offer={compare}
              variant="default"
              label="Queue a comparison"
              held={held}
              title="Compare with and without learned routes"
              explain="Every eval scenario is planned twice, with learned routes offered and without. The verdict holds routes that made planning worse and releases held ones that did no harm."
            />
          </div>
          <div className="card-b col" style={{ gap: 6 }}>
            <p className="muted">
              {compare.calls / 2} scenarios, planned twice. {held ? `${held} held ${held === 1 ? 'route is' : 'routes are'} released only by a clean one that offered ${held === 1 ? 'it' : 'them'}.` : 'No routes are held.'}
            </p>
            {comparisons.slice(0, 3).map((c) => (
              <Link key={c.file} href={`${base}/evaluations?file=${encodeURIComponent(c.file)}`} className="row">
                <span className="mono" style={{ fontSize: 12 }}>
                  {when(c.at, now)}
                </span>
                <span className="grow faint">
                  {c.verdict.regressed.length} worse, {c.verdict.improved.length} better{c.verdict.inconclusive.length ? `, ${c.verdict.inconclusive.length} unanswered` : ''}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Queue</h2>
        <div className="card" style={{ overflow: 'hidden' }}>
          {jobs.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Run</th>
                  <th>Status</th>
                  <th className="num">Calls</th>
                  <th className="num">Tokens</th>
                  <th>When</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="mono faint">{j.id}</td>
                    <td>
                      {j.kind === 'verify' ? 'Verification' : 'Comparison'}
                      {j.kind === 'compare' && j.options.includeHeld ? <span className="faint"> with held</span> : null}
                    </td>
                    <td>
                      <span className="pill" data-s={j.status}>
                        {j.status}
                      </span>
                    </td>
                    <td className="num">{j.status === 'done' || j.status === 'running' ? `${j.used.calls}/${j.calls}` : j.calls}</td>
                    <td className="num">{j.used.tokens ? kTokens(j.used.tokens) : `~${kTokens(j.est_tokens)}`}</td>
                    <td className="mono faint nowrap">
                      {j.status === 'queued' ? `at ${when(j.run_after, now)}` : when(j.finished_at ?? j.started_at ?? j.created_at, now)}
                    </td>
                    <td className="muted" style={{ maxWidth: 340 }}>
                      {j.error ? <span style={{ color: 'var(--bad-text)' }}>{j.error}</span> : null}
                      {j.result && j.kind === 'compare' && j.result.file ? (
                        <Link href={`${base}/evaluations?file=${encodeURIComponent(j.result.file)}`} style={{ color: 'var(--accent-text)' }}>
                          {j.result.file}
                        </Link>
                      ) : null}
                      {j.result && j.kind === 'verify' ? `${j.result.processed?.length ?? 0} routes checked${j.result.stoppedBecause ? `; stopped: ${j.result.stoppedBecause}` : ''}` : null}
                    </td>
                    <td>{j.status === 'queued' ? <CancelJob id={j.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Nothing queued. A run you confirm appears here, and can be cancelled until it starts.</div>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Recent verification checks</h2>
        <div className="card" style={{ overflow: 'hidden' }}>
          {checks.length ? (
            <table className="tbl">
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i}>
                    <td className="mono faint nowrap" style={{ width: 120 }}>
                      {when(c.at, now)}
                    </td>
                    <td style={{ width: 90 }}>
                      <span className="pill" data-s={c.outcome === 'verified' ? 'verified' : c.outcome === 'skipped' ? undefined : 'bad'}>
                        {c.outcome}
                      </span>
                    </td>
                    <td>
                      <Link href={`${base}/map?route=${c.route_id}`}>{c.name}</Link>
                      {c.reason && c.outcome !== 'verified' ? <div className="faint ellipsis" style={{ fontSize: 11.5, maxWidth: 640 }}>{c.reason}</div> : null}
                    </td>
                    <td className="num">{c.calls} calls</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No route has been verified yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
