import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { verificationPreview } from '../onboard.ts';
import { budget, estimate, nextMorning, usageContext } from '../usage.ts';

/* Paid runs, queued.
 *
 * Nothing that costs money starts from a page load or a single click. A person opens
 * a confirmation that shows the exact number of calls, the tokens it is expected to
 * use and what is left today, and confirms. That confirmation IS the approval, for
 * exactly that run: the job stores the call count it showed, and refuses to start if
 * the run would now make more calls than that. A queued run can be cancelled at any
 * time before it starts.
 *
 * A run that does not fit today's budget is offered for the next morning instead of
 * starting and hitting the provider's daily cap half way, which is what cut the second
 * comparison short. Just before starting, the budget is checked again: if the day's
 * spend grew since it was queued and it no longer fits, it moves to the next morning
 * rather than start.
 *
 * Execution is injected, so the rules here are tested without a model anywhere near. */

export type JobKind = 'verify' | 'compare';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobRow = {
  id: number;
  product_id: string;
  kind: JobKind;
  status: JobStatus;
  calls: number;
  est_tokens: number;
  run_after: number;
  options_json: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  result_json: string | null;
  error: string | null;
};
export type JobOptions = { includeHeld?: boolean; apply?: boolean; note?: string };

/* The purposes a run's calls are recorded under, for estimating from history. */
export const PURPOSES: Record<JobKind, string[]> = { verify: ['label', 'verify'], compare: ['plan'] };

export function scenarioCount(): number {
  const dir = join(process.cwd(), '..', 'eval');
  const read = (f: string) => {
    const p = join(dir, f);
    if (!existsSync(p)) return [];
    try {
      const v = JSON.parse(readFileSync(p, 'utf8'));
      return Array.isArray(v) ? (v as Array<{ id: string }>) : [];
    } catch {
      return [];
    }
  };
  const hand = read('scenarios.json');
  const added = read('scenarios.added.json').filter((a) => !hand.some((h) => h.id === a.id));
  return hand.length + added.length;
}

/* What a run would do if started now: the exact number of calls. */
export function callsFor(db: DatabaseSync, product: { id: string; tool: string }, kind: JobKind): number {
  if (kind === 'verify') return verificationPreview(db, product.id, product.tool).calls;
  return scenarioCount() * 2;
}

export function offer(db: DatabaseSync, product: { id: string; tool: string }, kind: JobKind, now = Date.now()) {
  const calls = callsFor(db, product, kind);
  return { kind, ...estimate(db, calls, PURPOSES[kind], now), budget: budget(db, now) };
}

export type EnqueueResult = { ok: true; job: JobRow } | { ok: false; reason: string; calls?: number };

export function enqueue(
  db: DatabaseSync,
  product: { id: string; tool: string },
  req: { kind: JobKind; calls: number; when: 'now' | 'next-morning'; options?: JobOptions },
  now = Date.now()
): EnqueueResult {
  const calls = callsFor(db, product, req.kind);
  if (!calls) return { ok: false, reason: req.kind === 'verify' ? 'there is nothing to verify' : 'there are no scenarios to compare' };
  /* The approval was for the number that was shown. */
  if (calls !== req.calls) return { ok: false, reason: `this run would now make ${calls} calls, not the ${req.calls} you confirmed; look again`, calls };
  const already = db
    .prepare("SELECT id FROM jobs WHERE product_id = ? AND kind = ? AND status IN ('queued', 'running')")
    .get(product.id, req.kind) as { id: number } | undefined;
  if (already) return { ok: false, reason: `a ${req.kind === 'verify' ? 'verification' : 'comparison'} for this product is already queued (#${already.id})` };
  const est = estimate(db, calls, PURPOSES[req.kind], now);
  const runAfter = req.when === 'now' ? now : est.nextSlot;
  const info = db
    .prepare('INSERT INTO jobs (product_id, kind, status, calls, est_tokens, run_after, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(product.id, req.kind, 'queued', calls, est.tokens, runAfter, JSON.stringify(req.options ?? {}), now);
  return { ok: true, job: getJob(db, Number(info.lastInsertRowid))! };
}

export function getJob(db: DatabaseSync, id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function cancel(db: DatabaseSync, id: number, now = Date.now()): boolean {
  return db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'").run(now, id).changes === 1;
}

export function listJobs(db: DatabaseSync, productId: string, limit = 30): JobRow[] {
  return db.prepare('SELECT * FROM jobs WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(productId, limit) as JobRow[];
}

export function dueJobs(db: DatabaseSync, now = Date.now()): JobRow[] {
  return db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY run_after, id").all(now) as JobRow[];
}

/* A job left running by a service that stopped cannot be resumed half way. */
export function recoverInterrupted(db: DatabaseSync, now = Date.now()): number {
  return Number(
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = 'interrupted: the service stopped while it ran' WHERE status = 'running'").run(now).changes
  );
}

export type Executors = {
  verify: (job: JobRow, product: { id: string; origin: string; tool: string }) => Promise<unknown>;
  compare: (job: JobRow, product: { id: string; origin: string; tool: string }) => Promise<unknown>;
};

export type RunOutcome = { status: JobStatus | 'deferred'; note?: string };

export async function runJob(db: DatabaseSync, job: JobRow, exec: Executors, now = () => Date.now()): Promise<RunOutcome> {
  const product = db.prepare('SELECT id, origin, tool FROM products WHERE id = ?').get(job.product_id) as { id: string; origin: string; tool: string } | undefined;
  const fail = (error: string): RunOutcome => {
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(now(), error, job.id);
    return { status: 'failed', note: error };
  };
  if (!product) return fail('the product no longer exists');
  /* Never more calls than were approved. */
  const calls = callsFor(db, product, job.kind);
  if (calls > job.calls) return fail(`it would now make ${calls} calls, more than the ${job.calls} that were approved; queue it again`);
  if (!calls) return fail(job.kind === 'verify' ? 'nothing is left to verify' : 'there are no scenarios to compare');
  const b = budget(db, now());
  if (job.est_tokens > b.left) {
    const next = nextMorning(now());
    db.prepare('UPDATE jobs SET run_after = ? WHERE id = ?').run(next, job.id);
    return { status: 'deferred', note: `does not fit what is left today (${b.left} tokens); moved to the next morning` };
  }
  const claimed = db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'").run(now(), job.id).changes;
  if (claimed !== 1) return { status: 'cancelled', note: 'it was cancelled or started elsewhere' };
  try {
    const result = await usageContext.run({ jobId: job.id }, () => exec[job.kind]({ ...job, status: 'running' }, product));
    db.prepare("UPDATE jobs SET status = 'done', finished_at = ?, result_json = ? WHERE id = ?").run(now(), JSON.stringify(result ?? null), job.id);
    return { status: 'done' };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
