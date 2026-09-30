import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { corpusStatus } from '@/lib/corpus';
import { docsCoverage } from '@/lib/console/docs';
import { when } from '@/lib/console/format';
import { gapsFor } from '@/lib/console/scenarios';
import { enrollmentsFor } from '@/lib/enroll';
import { explorationsFor, STOP_TEXT } from '@/lib/explore';
import { needsEnrollment } from '@/lib/ingest';
import rules from '../../../../../core/explore-rules.js';
import { Icon } from '../../../_ui/icons';
import { IngestDocs, IssueCode } from './SourceActions';

export const dynamic = 'force-dynamic';

const REFUSED = new Set(['unsafe', 'action-link', 'action-param', 'download', 'confirm']);

/* Where everything the map knows comes from: the docs, exploration, and the browsers
   that capture real use. */
export default async function SourcesPage({ params, searchParams }: { params: Promise<{ pid: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { pid } = await params;
  const { tab = 'docs' } = await searchParams;
  const db = getDb();
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(pid) as { id: string; origin: string; tool: string } | undefined;
  if (!product) notFound();
  const base = `/p/${pid}`;
  const now = Date.now();

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-h">
        <h1>Sources</h1>
        <span className="muted">Where the map comes from. The docs say what the product can do; exploration and real use show where things are.</span>
      </div>
      <nav className="tabs" aria-label="Sources">
        <Link href={`${base}/sources?tab=docs`} aria-current={tab === 'docs' ? 'page' : undefined}>
          Docs
        </Link>
        <Link href={`${base}/sources?tab=exploration`} aria-current={tab === 'exploration' ? 'page' : undefined}>
          Exploration
        </Link>
        <Link href={`${base}/sources?tab=browsers`} aria-current={tab === 'browsers' ? 'page' : undefined}>
          Browsers
        </Link>
      </nav>
      {tab === 'docs' ? <Docs db={db} product={product} base={base} now={now} /> : null}
      {tab === 'exploration' ? <Exploration db={db} product={product} base={base} now={now} /> : null}
      {tab === 'browsers' ? <Browsers db={db} product={product} now={now} /> : null}
    </div>
  );
}

type P = { id: string; origin: string; tool: string };
type Db = ReturnType<typeof getDb>;

function Docs({ db, product, base, now }: { db: Db; product: P; base: string; now: number }) {
  const status = corpusStatus(product.tool);
  const screens = db.prepare('SELECT id, display_name FROM screens WHERE product_id = ? ORDER BY display_name').all(product.id) as Array<{ id: string; display_name: string }>;
  const coverage = docsCoverage(product.tool, screens.map((s) => ({ id: s.id, name: s.display_name })));
  const gaps = gapsFor(db, product.id);
  const mentioned = screens.filter((s) => coverage.get(s.id)?.length).length;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="stat-grid">
        <div className="stat">
          <b>{status ? status.handWritten : 0}</b>
          <span>hand-written docs in {product.tool}</span>
        </div>
        <div className="stat">
          <b>{status ? status.ingested : 0}</b>
          <span>pages ingested{status?.sources ? ` from ${status.sources.site}` : ''}</span>
        </div>
        <div className="stat">
          <b>
            {mentioned}/{screens.length}
          </b>
          <span>screens the docs mention</span>
        </div>
        <div className="stat">
          <b>{gaps.length}</b>
          <span>docs gaps noted</span>
        </div>
      </div>
      <div className="card">
        <div className="card-h">
          <h3>Ingest from the help site</h3>
          {status?.sources ? <span className="faint">last from {status.sources.site}, {when(Date.parse(status.sources.fetchedAt), now)}</span> : null}
        </div>
        <div className="card-b">
          <IngestDocs productId={product.id} tool={product.tool} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-h">
            <h3>Screens and the docs</h3>
            <span className="faint">whole-name match</span>
          </div>
          <table className="tbl">
            <tbody>
              {screens.map((s) => {
                const hits = coverage.get(s.id) ?? [];
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`${base}/map?screen=${s.id}&layers=traffic,routes,docs`}>{s.display_name}</Link>
                    </td>
                    <td className="muted ellipsis" style={{ maxWidth: 260 }}>
                      {hits.length ? hits.map((h) => `${h.doc} › ${h.heading}`).join(', ') : <span className="faint">not mentioned</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {screens.length ? null : <div className="empty">No screens mapped yet.</div>}
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-h">
            <h3>Docs gaps</h3>
            <span className="faint">noted from struggles and the map</span>
          </div>
          <div className="card-b col" style={{ gap: 8 }}>
            {gaps.length ? (
              gaps.map((g) => (
                <div key={g.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <Icon name="note" size={14} style={{ color: 'var(--docs)', marginTop: 2 }} />
                  <span className="grow">
                    {g.note}
                    <span className="faint" style={{ display: 'block', fontSize: 11.5 }}>
                      {g.screen ?? 'the product'} &middot; {when(g.created_at, now)}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <p className="muted">None yet. Turn a struggle into one when the docs leave something out.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Exploration({ db, product, base, now }: { db: Db; product: P; base: string; now: number }) {
  const runs = explorationsFor(db, product.id);
  const latest = runs[0];
  const skipped = latest ? (JSON.parse(latest.skipped_json) as Array<{ url: string | null; reason: string; word: string | null }>) : [];
  const refused = skipped.filter((s) => REFUSED.has(s.reason));
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-h">
          <h3>Explore it safely</h3>
        </div>
        <div className="card-b" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            ['1', 'Use a demo account', 'Exploration opens pages, and opening a page can do what viewing it does. Only on an account with no real customer data.'],
            ['2', 'Enroll the browser as a vendor', 'In the extension settings: learning on, mode Vendor, tick that the account holds no real data. A real web address also needs an enrollment code.'],
            ['3', 'Press Explore in the panel', 'It opens links in a hidden frame, never clicks or types, and refuses links that could change something. The map grows as pages arrive.'],
          ].map(([n, t, d]) => (
            <div key={n} className="col" style={{ gap: 4 }}>
              <span className="pill" data-s="explored" style={{ alignSelf: 'flex-start' }}>
                step {n}
              </span>
              <b style={{ fontWeight: 600 }}>{t}</b>
              <span className="muted" style={{ fontSize: 12 }}>
                {d}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-h">
          <h3>Runs</h3>
          <span className="grow" />
          <Link className="btn btn-sm" href={`${base}/map?layers=traffic,routes,explored`}>
            <Icon name="map" size={13} /> See on the map
          </Link>
        </div>
        {runs.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Started</th>
                <th>From</th>
                <th className="num">Pages</th>
                <th>Ended because</th>
                <th className="num">Refused</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const sk = JSON.parse(r.skipped_json) as Array<{ reason: string }>;
                return (
                  <tr key={r.id}>
                    <td className="mono faint nowrap">{when(r.started_at, now)}</td>
                    <td className="mono ellipsis" style={{ maxWidth: 300 }}>
                      {r.start_url ?? ''}
                    </td>
                    <td className="num">{r.pages}</td>
                    <td className="muted">{r.stopped ? STOP_TEXT[r.stopped] ?? r.stopped : 'still running'}</td>
                    <td className="num">{sk.filter((s) => REFUSED.has(s.reason)).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">No exploration yet.</div>
        )}
      </div>
      {refused.length ? (
        <div className="card">
          <div className="card-h">
            <h3>Links the last run refused to open</h3>
          </div>
          <div className="card-b col" style={{ gap: 5 }}>
            {refused.map((s, i) => (
              <div key={i} className="row">
                <span className="pill" data-s="bad">
                  {s.word ?? s.reason}
                </span>
                <code className="ellipsis grow">{s.url ?? '(another site)'}</code>
                <span className="faint">{rules.describe(s.reason, null)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Browsers({ db, product, now }: { db: Db; product: P; now: number }) {
  const installs = db
    .prepare(
      `SELECT i.id, i.mode, i.attested, i.first_seen, i.last_seen,
              (SELECT COUNT(*) FROM transitions t WHERE t.install_id = i.id) AS actions,
              (SELECT COUNT(*) FROM decisions d WHERE d.install_id = i.id) AS decisions,
              (SELECT COUNT(*) FROM explorations e WHERE e.install_id = i.id) AS explorations
         FROM installs i WHERE i.product_id = ? ORDER BY i.last_seen DESC`
    )
    .all(product.id) as Array<{ id: string; mode: string; attested: number; first_seen: number; last_seen: number; actions: number; decisions: number; explorations: number }>;
  const codes = enrollmentsFor(db, product.id);
  const local = !needsEnrollment(product.origin);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-h">
          <h3>Enrollment</h3>
          <span className="grow" />
          <IssueCode origin={product.origin} />
        </div>
        <div className="card-b col" style={{ gap: 8 }}>
          <p className="muted">
            {local
              ? 'This product is on this machine, so a vendor browser needs no code. A product on a real web address does: vendor mode sends labels in clear and may explore, so an install cannot simply claim it.'
              : 'A vendor browser needs a one-time code the first time it sends anything. Customer mode never does.'}
          </p>
          {codes.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Issued</th>
                  <th>Expires</th>
                  <th>Used by</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.created_at}>
                    <td className="mono faint">{when(c.created_at, now)}</td>
                    <td className="mono faint">{c.expires_at < now ? 'expired' : when(c.expires_at, now)}</td>
                    <td className="mono">{c.used_by ? `${c.used_by.slice(0, 12)}… at ${when(c.used_at, now)}` : <span className="faint">unused</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-h">
          <h3>Browsers</h3>
          <span className="faint">{installs.length} installs; one per browser per product</span>
        </div>
        {installs.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Install</th>
                <th>Mode</th>
                <th className="num">Actions</th>
                <th className="num">Copilot decisions</th>
                <th className="num">Explorations</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {installs.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.id.length > 22 ? `${i.id.slice(0, 22)}…` : i.id}</td>
                  <td>
                    <span className="pill" data-s={i.mode === 'vendor' ? 'accent' : undefined}>
                      {i.mode}
                      {i.mode === 'vendor' && i.attested ? ', demo account' : ''}
                    </span>
                  </td>
                  <td className="num">{i.actions}</td>
                  <td className="num">{i.decisions}</td>
                  <td className="num">{i.explorations}</td>
                  <td className="mono faint nowrap">{when(i.last_seen, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No browser has sent anything yet.</div>
        )}
      </div>
    </div>
  );
}
