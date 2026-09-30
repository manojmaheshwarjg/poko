import type { DatabaseSync } from 'node:sqlite';
import { budget, type Budget } from '../usage.ts';

/* What the frame around every console page shows: the products to switch between,
   the counts beside each place in the sidebar, today's token spend, and what the
   command bar can jump to. */

export type ProductItem = { id: string; origin: string; tool: string; screens: number };
export type PaletteItem = { kind: 'page' | 'screen' | 'route' | 'action'; label: string; hint: string; href?: string; action?: string; status?: string };
export type ShellData = {
  products: ProductItem[];
  product: ProductItem;
  badges: { struggles: number; queued: number; running: number; routes: number; screens: number; setupDone: number; setupTotal: number };
  budget: Budget;
  palette: PaletteItem[];
};

export function listProducts(db: DatabaseSync): ProductItem[] {
  return db
    .prepare(
      `SELECT p.id, p.origin, p.tool, (SELECT COUNT(*) FROM screens s WHERE s.product_id = p.id) AS screens
         FROM products p ORDER BY p.created_at`
    )
    .all() as ProductItem[];
}

export function shellData(db: DatabaseSync, productId: string, setup: { done: number; total: number }): ShellData | null {
  const products = listProducts(db);
  const product = products.find((p) => p.id === productId);
  if (!product) return null;
  const n = (sql: string) => (db.prepare(sql).get(productId) as { n: number }).n;
  const base = `/p/${productId}`;
  const screens = db.prepare('SELECT id, display_name, url_pattern FROM screens WHERE product_id = ? ORDER BY display_name').all(productId) as Array<{
    id: string;
    display_name: string;
    url_pattern: string;
  }>;
  const routes = db
    .prepare("SELECT id, status, COALESCE(title, label) AS name FROM routes WHERE product_id = ? AND status <> 'blocked' ORDER BY status, id")
    .all(productId) as Array<{ id: string; status: string; name: string | null }>;
  const pages: PaletteItem[] = [
    { kind: 'page', label: 'Map', hint: 'Screens, routes and struggles on one map', href: `${base}/map` },
    { kind: 'page', label: 'Table', hint: 'Routes, screens and struggles as tables', href: `${base}/table` },
    { kind: 'page', label: 'Struggles', hint: 'Where people get stuck', href: `${base}/struggles` },
    { kind: 'page', label: 'Evaluations', hint: 'With and without learned routes', href: `${base}/evaluations` },
    { kind: 'page', label: 'Runs', hint: 'Verification, comparisons and the queue', href: `${base}/runs` },
    { kind: 'page', label: 'Docs', hint: 'The docs corpus and gaps', href: `${base}/sources?tab=docs` },
    { kind: 'page', label: 'Exploration', hint: 'Safe exploration runs', href: `${base}/sources?tab=exploration` },
    { kind: 'page', label: 'Browsers', hint: 'Installs and enrollment codes', href: `${base}/sources?tab=browsers` },
    { kind: 'page', label: 'Setup', hint: 'Onboarding checklist', href: `${base}/setup` },
    { kind: 'page', label: 'Products', hint: 'Every product, and add one', href: '/products' },
  ];
  const actions: PaletteItem[] = [
    { kind: 'action', label: 'Run learning', hint: 'Free: clusters screens and mines routes', action: 'learn' },
    { kind: 'action', label: 'Verify routes', hint: 'Paid: opens the cost first', href: `${base}/runs#verify` },
    { kind: 'action', label: 'Queue a comparison', hint: 'Paid: opens the cost first', href: `${base}/runs#compare` },
    { kind: 'action', label: 'Issue an enrollment code', hint: 'For a vendor demo browser', href: `${base}/sources?tab=browsers#enroll` },
    { kind: 'action', label: 'Ingest docs', hint: 'From the vendor help site', href: `${base}/sources?tab=docs#ingest` },
  ];
  return {
    products,
    product,
    badges: {
      struggles: n('SELECT COUNT(*) AS n FROM struggles WHERE product_id = ?'),
      queued: n("SELECT COUNT(*) AS n FROM jobs WHERE product_id = ? AND status = 'queued'"),
      running: n("SELECT COUNT(*) AS n FROM jobs WHERE product_id = ? AND status = 'running'"),
      routes: routes.length,
      screens: screens.length,
      setupDone: setup.done,
      setupTotal: setup.total,
    },
    budget: budget(db),
    palette: [
      ...pages,
      ...actions,
      ...screens.map((s) => ({ kind: 'screen' as const, label: s.display_name, hint: s.url_pattern, href: `${base}/map?screen=${s.id}` })),
      ...routes.map((r) => ({ kind: 'route' as const, label: r.name ?? r.id, hint: r.id, href: `${base}/map?route=${r.id}`, status: r.status })),
    ],
  };
}
