import Link from 'next/link';
import { getDb } from '@/lib/db';
import { when } from '@/lib/console/format';
import { Icon, Logo } from '../_ui/icons';

export const dynamic = 'force-dynamic';

/* Every product Sekva is learning, and adding one. Loading it never calls the planner. */
export default function ProductsPage() {
  const db = getDb();
  const products = db
    .prepare(
      `SELECT p.id, p.origin, p.tool,
              (SELECT COUNT(*) FROM screens s WHERE s.product_id = p.id) AS screens,
              (SELECT COUNT(*) FROM routes r WHERE r.product_id = p.id AND r.status <> 'blocked') AS routes,
              (SELECT COUNT(*) FROM installs i WHERE i.product_id = p.id) AS installs,
              (SELECT MAX(at) FROM learn_runs l WHERE l.product_id = p.id) AS learned
         FROM products p ORDER BY p.created_at`
    )
    .all() as Array<{ id: string; origin: string; tool: string; screens: number; routes: number; installs: number; learned: number | null }>;
  const hasKey = Boolean(process.env.GROQ_API_KEY);
  const model = process.env.GROQ_MODEL ?? null;
  const now = Date.now();
  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <Logo />
        <b style={{ fontWeight: 650, letterSpacing: '-0.02em', fontSize: 14 }}>sekva</b>
        <span className="faint">/</span>
        <span>Products</span>
        <span className="topbar-right">
          <span className="row" style={{ gap: 6 }} title="The service's model settings. Only whether a key is set is shown, never the key.">
            <span className="dot" data-s={hasKey && model ? 'live' : 'off'} />
            <span className="mono">{model ?? 'no model set'}</span>
            <span className="faint">{hasKey ? 'key set' : 'no key'}</span>
          </span>
        </span>
      </header>
      <div className="page" style={{ margin: '0 auto', maxWidth: 980 }}>
        <div className="page-h">
          <h1>Products</h1>
          <span className="muted">Each product has its own map, routes and browsers.</span>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {products.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Docs</th>
                  <th className="num">Screens</th>
                  <th className="num">Routes</th>
                  <th className="num">Browsers</th>
                  <th>Learned</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/p/${p.id}/map`} className="mono">
                        {p.origin}
                      </Link>
                    </td>
                    <td className="muted">{p.tool}</td>
                    <td className="num">{p.screens}</td>
                    <td className="num">{p.routes}</td>
                    <td className="num">{p.installs}</td>
                    <td className="mono faint">{p.learned ? when(p.learned, now) : 'never'}</td>
                    <td>
                      <Link className="btn btn-sm" href={`/p/${p.id}/map`}>
                        <Icon name="map" size={13} /> Map
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No products yet. Add the first one below.</div>
          )}
        </div>
        <div className="card" id="add" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>Add a product</h3>
          </div>
          <form className="card-b" method="post" action="/api/products" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <label className="field">
              <span>Web address of the product</span>
              <input className="input" name="origin" placeholder="https://app.example.com" required />
            </label>
            <label className="field">
              <span>Docs corpus</span>
              <input className="input" name="tool" placeholder="jira" />
            </label>
            <button className="btn btn-primary" type="submit">
              <Icon name="plus" size={14} /> Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
