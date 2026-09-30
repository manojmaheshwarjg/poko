import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync } from 'node:sqlite';

/* Model spend: what was used, what is left today, and whether a run fits.
 *
 * Every model call records what the provider reported for it (lib/planner.ts), so the
 * token meter and every "left today" figure are sums of stored rows (G11). Estimates
 * exist only for runs that have not happened yet, are always shown as estimates, and
 * come from the average of recorded calls once there are enough of them.
 *
 * The limits are the provider's, not ours: the on-demand tier this prototype uses
 * allows 200,000 tokens a day and 8,000 a minute. Both can be overridden for another
 * tier. "Today" is local calendar day, which is what a person reading the meter means
 * by it; the provider's own window may differ, so the meter says it is a record, not
 * the provider's figure. */

export const DAILY_TOKENS = Number(process.env.COPILOT_DAILY_TOKENS) || 200_000;
export const MINUTE_TOKENS = Number(process.env.COPILOT_MINUTE_TOKENS) || 8_000;
/* Used until at least MIN_SAMPLES calls of a purpose have been recorded. Measured on
   the Jira corpus: a planning call is mostly the system prompt and retrieved docs. */
export const DEFAULT_TOKENS_PER_CALL = 3_700;
const MIN_SAMPLES = 3;
/* When a queued run that did not fit is scheduled for: the next morning. */
export const QUEUE_HOUR = 9;

export type Usage = { purpose: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number };

/* Which queued job a call belongs to, carried through async calls so a run's cost can
   be read back per run. Unset outside a job. */
export const usageContext = new AsyncLocalStorage<{ jobId?: number }>();

export function recordUsage(db: DatabaseSync, u: Usage, at = Date.now()): void {
  const jobId = usageContext.getStore()?.jobId ?? null;
  db.prepare(
    'INSERT INTO model_usage (at, purpose, model, prompt_tokens, completion_tokens, total_tokens, job_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(at, u.purpose, u.model, u.promptTokens, u.completionTokens, u.totalTokens, jobId);
}

export function startOfDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function tokensSince(db: DatabaseSync, since: number): number {
  return (db.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS n FROM model_usage WHERE at >= ?').get(since) as { n: number }).n;
}

export function tokensForJob(db: DatabaseSync, jobId: number): { calls: number; tokens: number } {
  const r = db.prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens FROM model_usage WHERE job_id = ?').get(jobId) as {
    calls: number;
    tokens: number;
  };
  return r;
}

/* Average recorded tokens per call, for one purpose or all, falling back to the
   measured default until there is enough history to average. */
export function tokensPerCall(db: DatabaseSync, purposes?: string[]): { perCall: number; measured: boolean; samples: number } {
  const where = purposes && purposes.length ? `WHERE purpose IN (${purposes.map(() => '?').join(', ')})` : '';
  const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(AVG(total_tokens), 0) AS avg FROM model_usage ${where}`).get(...(purposes ?? [])) as {
    n: number;
    avg: number;
  };
  if (r.n >= MIN_SAMPLES) return { perCall: Math.round(r.avg), measured: true, samples: r.n };
  return { perCall: DEFAULT_TOKENS_PER_CALL, measured: false, samples: r.n };
}

export type Budget = {
  usedToday: number;
  limit: number;
  left: number;
  minuteLimit: number;
  /* Tokens already promised to runs queued for today but not started. */
  reservedToday: number;
};

export function budget(db: DatabaseSync, now = Date.now()): Budget {
  const since = startOfDay(now);
  const usedToday = tokensSince(db, since);
  const end = since + 86_400_000;
  const reservedToday = (
    db
      .prepare("SELECT COALESCE(SUM(est_tokens), 0) AS n FROM jobs WHERE status = 'queued' AND run_after < ?")
      .get(end) as { n: number }
  ).n;
  return { usedToday, limit: DAILY_TOKENS, left: Math.max(0, DAILY_TOKENS - usedToday), minuteLimit: MINUTE_TOKENS, reservedToday };
}

export type Estimate = {
  calls: number;
  tokens: number;
  measured: boolean;
  /* Whether it fits in what is left today once runs already queued for today are
     counted. A run that does not fit is offered for the next morning instead. */
  fitsToday: boolean;
  /* The per-minute limit paces a run: a large one takes this long however much of the
     daily budget is left. */
  minutes: number;
  nextSlot: number;
};

export function estimate(db: DatabaseSync, calls: number, purposes?: string[], now = Date.now()): Estimate {
  const per = tokensPerCall(db, purposes);
  const tokens = calls * per.perCall;
  const b = budget(db, now);
  return {
    calls,
    tokens,
    measured: per.measured,
    fitsToday: tokens <= b.left - b.reservedToday,
    minutes: Math.max(1, Math.ceil(tokens / b.minuteLimit)),
    nextSlot: nextMorning(now),
  };
}

export function nextMorning(now = Date.now(), hour = QUEUE_HOUR): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/* 41k, 1.2k, 830: how token counts are shown everywhere. */
export function kTokens(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
