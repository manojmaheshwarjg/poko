import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getDb } from '../db.ts';
import { dueJobs, recoverInterrupted, runJob, type Executors, type JobOptions } from './queue.ts';

/* Runs queued paid jobs when they are due. Started once per server (instrumentation.ts).
 *
 * It only ever runs what a person queued, one job at a time, and never creates work of
 * its own. The two executors below are the only code in the console that can reach a
 * model: verification in process, comparisons by running the eval exactly as a person
 * would from a terminal, marked with the job so each call's cost is recorded against
 * it. */

const TICK_MS = 5_000;

function evalRun(job: { id: number; options_json: string }, origin: string): Promise<{ file: string | null; exitCode: number | null; tail: string }> {
  const opts = JSON.parse(job.options_json) as JobOptions;
  const args = ['eval/run.mjs', '--confirm', '--origin', origin, '--compare', ...(opts.includeHeld ? ['--include-held'] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: join(process.cwd(), '..'),
      env: { ...process.env, SEKVA_JOB: String(job.id) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const m = out.match(/Results: eval\/results\/([\w.-]+\.json)/);
      resolve({ file: m ? m[1] : null, exitCode: code, tail: out.slice(-1200) });
    });
  });
}

export const realExecutors: Executors = {
  async verify(job, product) {
    const { modelDeps } = await import('../learn/model-deps.ts');
    const { runVerification } = await import('../learn/verify.ts');
    const { contextFor } = await import('../retrieval.ts');
    const result = await runVerification(getDb(), product.id, modelDeps(), {
      tool: product.tool,
      maxCalls: job.calls,
      docs: (q) => contextFor(product.tool, q).text,
    });
    return { callsUsed: result.callsUsed, stoppedBecause: result.stoppedBecause, processed: result.processed };
  },
  async compare(job, product) {
    const run = await evalRun(job, product.origin);
    if (!run.file) throw new Error(`the eval wrote no results (exit ${run.exitCode}): ${run.tail.split('\n').filter(Boolean).slice(-3).join(' / ')}`);
    const opts = JSON.parse(job.options_json) as JobOptions;
    let applied: unknown = null;
    if (opts.apply !== false) {
      /* G9 is enforced, not suggested: the verdict holds and releases routes exactly as
         service/scripts/g9.mts --apply would. */
      const { applyG9, planG9 } = await import('../learn/g9.ts');
      const { readResults } = await import('./evaluations.ts');
      const rows = readResults(run.file) ?? [];
      const plan = planG9(getDb(), product.id, rows);
      if (!plan.refused) {
        applyG9(getDb(), plan, run.file.replace(/\.json$/, ''));
        applied = { held: plan.hold.map((h) => h.id), released: plan.release.map((r) => r.id) };
      } else applied = { refused: plan.refused };
    }
    return { file: run.file, exitCode: run.exitCode, applied };
  },
};

type WorkerState = { timer: ReturnType<typeof setInterval> | null; busy: boolean };
const g = globalThis as unknown as { __sekvaWorker?: WorkerState };

export function startWorker(exec: Executors = realExecutors): void {
  if (g.__sekvaWorker?.timer) return;
  const state: WorkerState = { timer: null, busy: false };
  g.__sekvaWorker = state;
  try {
    recoverInterrupted(getDb());
  } catch {}
  state.timer = setInterval(async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      const db = getDb();
      const [job] = dueJobs(db);
      if (job) await runJob(db, job, exec);
    } catch {
      /* A failure is recorded on the job itself; the loop keeps going. */
    } finally {
      state.busy = false;
    }
  }, TICK_MS);
  state.timer.unref?.();
  console.log('Sekva queue worker started: it runs only paid runs someone queued, one at a time.');
}
