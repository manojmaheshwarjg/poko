import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { when } from '@/lib/console/format';
import { loadMap } from '@/lib/console/model';
import { NavTable } from '../../../_ui/NavTable';

export const dynamic = 'force-dynamic';

/* The map's data as tables: the same routes, screens and struggles, for scanning,
   sorting by eye and copying ids. Every row opens the same thing on the map. */
export default async function TablePage({ params, searchParams }: { params: Promise<{ pid: string }>; searchParams: Promise<{ tab?: string; status?: string }> }) {
  const { pid } = await params;
  const { tab = 'routes', status } = await searchParams;
  const base = `/p/${pid}`;
  const model = loadMap(getDb(), pid, base);
  if (!model) notFound();
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  const now = Date.now();
  const statuses = [...new Set(model.routes.map((r) => r.status))];
  const routes = status ? model.routes.filter((r) => r.status === status) : model.routes;
  const struggles = model.nodes.flatMap((n) => n.struggles.map((s) => ({ ...s, screen: n })));

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      <div className="page-h">
        <h1>Table</h1>
        <span className="muted">Everything on the map, as rows. J and K move, Enter opens.</span>
      </div>
      <nav className="tabs" aria-label="Tables">
        <Link href={`${base}/table?tab=routes`} aria-current={tab === 'routes' ? 'page' : undefined}>
          Routes <span className="mono faint">{model.routes.length}</span>
        </Link>
        <Link href={`${base}/table?tab=screens`} aria-current={tab === 'screens' ? 'page' : undefined}>
          Screens <span className="mono faint">{model.nodes.length}</span>
        </Link>
        <Link href={`${base}/table?tab=struggles`} aria-current={tab === 'struggles' ? 'page' : undefined}>
          Struggles <span className="mono faint">{struggles.length}</span>
        </Link>
      </nav>

      {tab === 'routes' ? (
        <>
          <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            <Link className="chip" aria-pressed={!status} href={`${base}/table?tab=routes`}>
              All <span className="n">{model.routes.length}</span>
            </Link>
            {statuses.map((s) => (
              <Link key={s} className="chip" aria-pressed={status === s} href={`${base}/table?tab=routes&status=${s}`}>
                <span className="dot" data-s={s} />
                {s} <span className="n">{model.routes.filter((r) => r.status === s).length}</span>
              </Link>
            ))}
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <NavTable label="Routes">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Route</th>
                  <th>Id</th>
                  <th className="num">People</th>
                  <th className="num">Steps</th>
                  <th>Through</th>
                  <th>Last change</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id} data-href={`${base}/map?route=${r.id}`}>
                    <td>
                      <span className="pill" data-s={r.status}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ maxWidth: 340 }}>
                      <div className="ellipsis">{r.name}</div>
                      {r.reason ? <div className="faint ellipsis" style={{ fontSize: 11.5 }}>{r.reason}</div> : null}
                    </td>
                    <td className="mono faint">{r.id}</td>
                    <td className="num">{r.people}</td>
                    <td className="num">{r.steps.length}</td>
                    <td className="muted ellipsis" style={{ maxWidth: 320 }}>
                      {r.screens.map(name).join(' › ')}
                    </td>
                    <td className="mono faint nowrap">{when(r.history[0]?.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </NavTable>
            {routes.length ? null : <div className="empty">No routes{status ? ` with status ${status}` : ''}.</div>}
          </div>
        </>
      ) : null}

      {tab === 'screens' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <NavTable label="Screens">
            <thead>
              <tr>
                <th>Screen</th>
                <th>Path</th>
                <th>Drawn as</th>
                <th className="num">People</th>
                <th className="num">Seen</th>
                <th className="num">Controls</th>
                <th className="num">Struggles</th>
                <th>Docs</th>
              </tr>
            </thead>
            <tbody>
              {[...model.nodes]
                .sort((a, b) => b.people - a.people || b.seen - a.seen)
                .map((n) => (
                  <tr key={n.id} data-href={`${base}/map?screen=${n.id}`}>
                    <td>
                      {n.name} {n.exploredOnly ? <span className="pill" data-s="explored">only explored</span> : null}
                    </td>
                    <td className="mono faint ellipsis" style={{ maxWidth: 300 }}>
                      {n.path}
                    </td>
                    <td className="muted">{n.thumb}</td>
                    <td className="num">{n.people}</td>
                    <td className="num">{n.seen}</td>
                    <td className="num">{n.controls}</td>
                    <td className="num" style={{ color: n.signals ? 'var(--bad-text)' : undefined }}>
                      {n.signals || ''}
                    </td>
                    <td>{n.docs.length ? <span className="pill" data-s="docs">mentioned</span> : <span className="faint">not mentioned</span>}</td>
                  </tr>
                ))}
            </tbody>
          </NavTable>
        </div>
      ) : null}

      {tab === 'struggles' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <NavTable label="Struggles">
            <thead>
              <tr>
                <th>Kind</th>
                <th>What happens</th>
                <th>Screen</th>
                <th className="num">People</th>
              </tr>
            </thead>
            <tbody>
              {struggles
                .sort((a, b) => b.people - a.people)
                .map((s) => (
                  <tr key={s.id} data-href={`${base}/struggles?id=${s.id}`}>
                    <td>
                      <span className="pill" data-s={s.kind.startsWith('copilot') ? 'accent' : 'bad'}>
                        {s.chip}
                      </span>
                    </td>
                    <td>{s.title}</td>
                    <td className="muted">{s.screen.name}</td>
                    <td className="num">{s.people}</td>
                  </tr>
                ))}
            </tbody>
          </NavTable>
          {struggles.length ? null : <div className="empty">No struggles seen yet.</div>}
        </div>
      ) : null}
    </div>
  );
}
