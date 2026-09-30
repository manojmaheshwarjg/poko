import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { compareModes } from '../../eval/compare.mjs';
import { enrollmentsFor } from './enroll.ts';
import { needsEnrollment } from './ingest.ts';
import { planG9 } from './learn/g9.ts';
import { CALLS_PER_ROUTE, planVerification } from './learn/verify.ts';

/* Phase O: what the onboarding console shows. Every number is read from a stored row
   or file (G11), never estimated. */

export type ProductRow = { id: string; origin: string; tool: string; installs: number; transitions: number; explored: number; learned: number | null };

export function listProducts(db: DatabaseSync): ProductRow[] {
  return db
    .prepare(
      `SELECT p.id, p.origin, p.tool,
              (SELECT COUNT(*) FROM installs i WHERE i.product_id = p.id) AS installs,
              (SELECT COUNT(*) FROM transitions t WHERE t.product_id = p.id) AS transitions,
              (SELECT COUNT(*) FROM explore_pages e WHERE e.product_id = p.id) AS explored,
              (SELECT MAX(at) FROM learn_runs l WHERE l.product_id = p.id) AS learned
         FROM products p ORDER BY p.created_at`
    )
    .all() as ProductRow[];
}

export function overview(db: DatabaseSync, productId: string, origin: string) {
  const count = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n;
  const installs = db
    .prepare('SELECT mode, attested, COUNT(*) AS n FROM installs WHERE product_id = ? GROUP BY mode, attested')
    .all(productId) as Array<{ mode: string; attested: number; n: number }>;
  const decisions = db
    .prepare('SELECT kind, COUNT(*) AS n FROM decisions WHERE product_id = ? GROUP BY kind')
    .all(productId) as Array<{ kind: string; n: number }>;
  const routes = db
    .prepare("SELECT status, COUNT(*) AS n FROM routes WHERE product_id = ? GROUP BY status")
    .all(productId) as Array<{ status: string; n: number }>;
  const held = db
    .prepare("SELECT id, label, status_reason FROM routes WHERE product_id = ? AND status = 'held' ORDER BY attempts DESC")
    .all(productId) as Array<{ id: string; label: string | null; status_reason: string | null }>;
  const run = db.prepare('SELECT at, summary_json FROM learn_runs WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId) as
    | { at: number; summary_json: string }
    | undefined;
  return {
    installs,
    needsEnrollment: needsEnrollment(origin),
    enrollments: enrollmentsFor(db, productId),
    transitions: {
      user: count("SELECT COUNT(*) AS n FROM transitions WHERE product_id = ? AND source = 'user'", productId),
      copilot: count("SELECT COUNT(*) AS n FROM transitions WHERE product_id = ? AND source = 'copilot'", productId),
    },
    explored: { runs: count('SELECT COUNT(*) AS n FROM explorations WHERE product_id = ?', productId), pages: count('SELECT COUNT(*) AS n FROM explore_pages WHERE product_id = ?', productId) },
    decisions,
    routes,
    held,
    lastRun: run ? { at: run.at, summary: JSON.parse(run.summary_json) as Record<string, unknown> } : null,
  };
}

/* What a verification run would do right now, and what it would cost. */
export function verificationPreview(db: DatabaseSync, productId: string, tool: string) {
  const planned = planVerification(db, productId, { tool });
  const callable = planned.filter((p) => p.willCall);
  return {
    routes: planned.map((p) => ({ id: p.route.id, title: p.title, held: p.held, willCall: p.willCall, skipReason: p.skipReason })),
    calls: callable.length * CALLS_PER_ROUTE,
  };
}

/* With/without comparisons (eval/run.mjs --compare) recorded for this product, newest
   first, each with the verdict and what G9 would do with it now. */
export function comparisonsFor(db: DatabaseSync, productId: string, origin: string, limit = 5) {
  const dir = join(process.cwd(), '..', 'eval', 'results');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  const out: Array<{ file: string; verdict: ReturnType<typeof compareModes>; plan: ReturnType<typeof planG9> }> = [];
  for (const file of files) {
    if (out.length >= limit) break;
    let results: Array<{ origin?: string | null; useRoutes?: boolean }>;
    try {
      results = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(results) || !results.some((r) => r.useRoutes === false)) continue;
    /* Older runs did not record their product; only runs that did are shown here. */
    if (!results.some((r) => r.origin === origin)) continue;
    out.push({ file, verdict: compareModes(results), plan: planG9(db, productId, results) });
  }
  return out;
}

export function resultsFile(file: string): unknown[] | null {
  if (!/^[\w.-]+\.json$/.test(file)) return null;
  const path = join(process.cwd(), '..', 'eval', 'results', file);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
