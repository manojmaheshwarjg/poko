import type { DatabaseSync } from 'node:sqlite';
import { corpusStatus } from '../corpus.ts';
import type { ComparisonSummary } from './evaluations.ts';

/* Where a product is in onboarding, and what needs a person's attention.
 *
 * Six steps, each done or not by what is stored, never by a flag someone set: a
 * product is mapped when it has screens, capturing when real use has arrived, and
 * so on. "Needs attention" lists only what someone can act on, each with where to
 * go, most serious first. */

export type SetupStep = { key: string; title: string; done: boolean; detail: string; href: string | null; cta: string | null };
export type Attention = { tone: 'bad' | 'warn' | 'info'; text: string; href: string; cta: string };
export type Counts = {
  screens: number;
  exploredOnly: number;
  transitions: number;
  people: number;
  routes: Record<string, number>;
  explorePages: number;
  newActions: number;
  newPages: number;
  lastLearn: number | null;
  copilotStruggles: number;
};

export function counts(db: DatabaseSync, productId: string): Counts {
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...(args as [])) as { n: number } | undefined)?.n ?? 0;
  const lastLearn = (db.prepare('SELECT MAX(at) AS at FROM learn_runs WHERE product_id = ?').get(productId) as { at: number | null }).at;
  const routes: Record<string, number> = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM routes WHERE product_id = ? GROUP BY status').all(productId) as Array<{ status: string; n: number }>) routes[r.status] = r.n;
  const exploredOnly = one(
    `SELECT COUNT(*) AS n FROM screens s WHERE s.product_id = ? AND NOT EXISTS (
       SELECT 1 FROM screen_members m JOIN transitions t ON t.before_hash = m.obs_hash OR t.after_hash = m.obs_hash
        WHERE m.screen_id = s.id)`,
    productId
  );
  return {
    screens: one('SELECT COUNT(*) AS n FROM screens WHERE product_id = ?', productId),
    exploredOnly,
    transitions: one("SELECT COUNT(*) AS n FROM transitions WHERE product_id = ? AND source = 'user'", productId),
    people: one("SELECT COUNT(DISTINCT install_id) AS n FROM transitions WHERE product_id = ? AND source = 'user'", productId),
    routes,
    explorePages: one('SELECT COUNT(*) AS n FROM explore_pages WHERE product_id = ?', productId),
    newActions: one('SELECT COUNT(*) AS n FROM transitions WHERE product_id = ? AND received_at > ?', productId, lastLearn ?? 0),
    newPages: one('SELECT COUNT(*) AS n FROM explore_pages WHERE product_id = ? AND received_at > ?', productId, lastLearn ?? 0),
    lastLearn,
    copilotStruggles: one("SELECT COALESCE(SUM(installs), 0) AS n FROM struggles WHERE product_id = ? AND kind LIKE 'copilot%'", productId),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function setupSteps(base: string, c: Counts, tool: string, latest: ComparisonSummary | null, verifyCalls: number): SetupStep[] {
  const r = (k: string) => c.routes[k] ?? 0;
  const learned = Object.entries(c.routes).filter(([k]) => k !== 'blocked').reduce((s, [, n]) => s + n, 0);
  const checked = r('verified') + r('held') + r('rejected') + r('gap') + r('demoted');
  const docs = corpusStatus(tool);
  const clean = !!latest && latest.verdict.complete && !latest.verdict.regressed.length && !latest.verdict.inconclusive.length;
  return [
    { key: 'product', title: 'Add the product', done: true, detail: docs ? `docs corpus: ${tool}` : `no docs yet for ${tool}`, href: `${base}/sources?tab=docs`, cta: docs ? null : 'Add docs' },
    {
      key: 'screens',
      title: 'Map its screens',
      done: c.screens > 0,
      detail: c.screens ? `${plural(c.screens, 'screen')}${c.exploredOnly ? `, ${c.exploredOnly} only explored` : ''}` : 'explore it safely, or learn from real use',
      href: `${base}/sources?tab=exploration`,
      cta: c.screens ? null : 'Explore',
    },
    {
      key: 'capture',
      title: 'Capture real use',
      done: c.transitions > 0,
      detail: c.transitions ? `${plural(c.transitions, 'action')} from ${plural(c.people, 'person', 'people')}` : 'enroll a browser, then use the product normally',
      href: `${base}/sources?tab=browsers`,
      cta: c.transitions ? null : 'Enroll a browser',
    },
    {
      key: 'routes',
      title: 'Learn routes',
      done: learned > 0,
      detail: learned ? `${plural(learned, 'route')}${r('blocked') ? `, ${r('blocked')} need more evidence` : ''}` : c.transitions ? 'run learning; it is free' : 'needs real use first',
      href: base,
      cta: c.newActions || c.newPages ? 'Run learning' : null,
    },
    {
      key: 'verify',
      title: 'Verify routes',
      done: learned > 0 && r('candidate') === 0 && checked > 0,
      detail: learned ? `${r('verified')} verified, ${r('held')} held, ${r('candidate')} waiting` : 'needs routes first',
      href: `${base}/runs`,
      cta: verifyCalls ? `Verify, ${plural(verifyCalls, 'call')}` : null,
    },
    {
      key: 'compare',
      title: 'Compare with docs only',
      done: clean && r('held') === 0,
      detail: latest
        ? `last: ${latest.verdict.regressed.length} worse, ${latest.verdict.improved.length} better${latest.verdict.inconclusive.length ? `, ${latest.verdict.inconclusive.length} unanswered` : ''}; ${r('held')} held`
        : 'not run yet',
      href: `${base}/runs`,
      cta: clean && !r('held') ? null : 'Queue a comparison',
    },
  ];
}

export function needsAttention(base: string, c: Counts, tool: string, latest: ComparisonSummary | null, verifyCalls: number): Attention[] {
  const out: Attention[] = [];
  const r = (k: string) => c.routes[k] ?? 0;
  if (latest?.verdict.regressed.length) {
    out.push({ tone: 'bad', text: `${plural(latest.verdict.regressed.length, 'scenario')} worse with routes than without`, href: `${base}/evaluations?file=${encodeURIComponent(latest.file)}`, cta: 'Open' });
  }
  if (r('held')) out.push({ tone: 'warn', text: `${plural(r('held'), 'route')} held back until a clean comparison`, href: `${base}/runs`, cta: 'Queue' });
  if (latest?.verdict.inconclusive.length) {
    out.push({ tone: 'warn', text: `Last comparison cut short: ${plural(latest.verdict.inconclusive.length, 'scenario')} got no answer`, href: `${base}/evaluations?file=${encodeURIComponent(latest.file)}`, cta: 'Open' });
  }
  if (r('demoted')) out.push({ tone: 'warn', text: `${plural(r('demoted'), 'route')} demoted by real use`, href: `${base}/table?tab=routes`, cta: 'Review' });
  if (c.copilotStruggles) out.push({ tone: 'warn', text: `The copilot was turned down or wrong ${plural(c.copilotStruggles, 'time')}`, href: `${base}/struggles?kind=copilot`, cta: 'Look' });
  if (c.newActions || c.newPages) {
    const what = [c.newActions ? plural(c.newActions, 'new action') : '', c.newPages ? plural(c.newPages, 'new explored page') : ''].filter(Boolean).join(' and ');
    out.push({ tone: 'info', text: `${what} since learning last ran`, href: base, cta: 'Run learning' });
  }
  if (verifyCalls && r('candidate')) out.push({ tone: 'info', text: `${plural(r('candidate'), 'route')} waiting to be verified`, href: `${base}/runs`, cta: 'Verify' });
  if (!corpusStatus(tool)) out.push({ tone: 'info', text: 'No docs for this product yet', href: `${base}/sources?tab=docs`, cta: 'Add docs' });
  return out;
}
