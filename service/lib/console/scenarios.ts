import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/* Turning what happened into something checked.
 *
 * A struggle becomes an evaluation scenario: a request, the recorded screen it starts
 * on, and what a good plan must and must not do. Scenarios added here go to their own
 * file beside the hand-written set (eval/scenarios.added.json), which the eval reads
 * too, so the reviewed set is never edited by the console. Adding one makes no call;
 * it runs in the next comparison someone queues.
 *
 * A struggle can also become a docs gap: a note of something the docs do not say,
 * kept with the screen it is about. */

export const OUTCOMES = ['plan', 'partial', 'cannot', 'nothing_to_do'] as const;

export const ScenarioInput = z.object({
  goal: z.string().trim().min(8, 'write the request as a person would ask it').max(300),
  from: z.string().min(1).max(64),
  outcome: z.enum(OUTCOMES),
  routeShouldReach: z.string().trim().max(120).optional().nullable(),
  mustNotTouch: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  why: z.string().trim().min(1).max(600),
});
export type ScenarioInput = z.infer<typeof ScenarioInput>;

const evalDir = () => join(process.cwd(), '..', 'eval');
const read = (file: string): Array<{ id: string }> => {
  const p = join(evalDir(), file);
  if (!existsSync(p)) return [];
  const v = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(v) ? v : [];
};

export function slug(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-') || 'scenario';
}

export function addScenario(input: unknown): { ok: true; id: string } | { ok: false; error: string } {
  const parsed = ScenarioInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid scenario' };
  const s = parsed.data;
  let screens: Record<string, unknown> = {};
  try {
    screens = JSON.parse(readFileSync(join(evalDir(), 'screens.json'), 'utf8'));
  } catch {
    return { ok: false, error: 'the eval has no recorded screens to start from' };
  }
  if (!Object.hasOwn(screens, s.from)) return { ok: false, error: `the eval has no recorded screen "${s.from}" to start on` };
  const hand = read('scenarios.json');
  const added = read('scenarios.added.json');
  const taken = new Set([...hand, ...added].map((x) => x.id));
  let id = `added-${slug(s.goal)}`;
  for (let n = 2; taken.has(id); n++) id = `added-${slug(s.goal)}-${n}`;
  const expect: Record<string, unknown> = { outcome: s.outcome };
  if (s.routeShouldReach) expect.routeShouldReach = s.routeShouldReach;
  if (s.mustNotTouch?.length) expect.mustNotTouch = s.mustNotTouch;
  added.push({ id, goal: s.goal, from: s.from, why: s.why, expect } as { id: string });
  writeFileSync(join(evalDir(), 'scenarios.added.json'), JSON.stringify(added, null, 2) + '\n');
  return { ok: true, id };
}

export function addedScenarios(): Array<{ id: string; goal: string; from: string; why: string; expect: Record<string, unknown> }> {
  return read('scenarios.added.json') as never;
}

export const GapInput = z.object({
  screenId: z.string().max(64).optional().nullable(),
  note: z.string().trim().min(8, 'say what the docs leave out').max(1000),
  source: z.string().max(200).optional().nullable(),
});

export function addGap(db: DatabaseSync, productId: string, input: unknown, now = Date.now()): { ok: true; id: number } | { ok: false; error: string } {
  const parsed = GapInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid note' };
  const g = parsed.data;
  if (g.screenId && !db.prepare('SELECT 1 FROM screens WHERE id = ? AND product_id = ?').get(g.screenId, productId)) {
    return { ok: false, error: 'that screen is not part of this product' };
  }
  const info = db
    .prepare('INSERT INTO docs_gaps (product_id, screen_id, note, source, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(productId, g.screenId ?? null, g.note, g.source ?? null, now);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function gapsFor(db: DatabaseSync, productId: string) {
  return db
    .prepare(
      `SELECT g.id, g.screen_id, g.note, g.source, g.created_at, s.display_name AS screen
         FROM docs_gaps g LEFT JOIN screens s ON s.id = g.screen_id
        WHERE g.product_id = ? ORDER BY g.created_at DESC`
    )
    .all(productId) as Array<{ id: number; screen_id: string | null; note: string; source: string | null; created_at: number; screen: string | null }>;
}
