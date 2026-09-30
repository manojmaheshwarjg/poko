import type { DatabaseSync } from 'node:sqlite';
import { controlName, type PathAction } from './steps.ts';

/* Struggles, as a person reads them, and what happened around each one.
 *
 * The text says only what the signal is: "4 people open Access and come straight
 * back", never why. The why is for the person looking, and the context is there to
 * help: where those people went next, and for the copilot's own mistakes, what it
 * proposed next to what the person did instead. All of it is read from stored rows. */

export type StruggleRow = {
  screen_id: string;
  kind: string;
  control: string;
  action_json: string | null;
  attempts: number;
  installs: number;
};

export type Struggle = StruggleRow & {
  id: string;
  screenName: string;
  control_text: string | null;
  title: string;
  chip: string;
  copilot: boolean;
};

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export const STRUGGLE_CHIPS: Record<string, string> = {
  backtrack: 'Came straight back',
  peek: 'Opened, chose nothing',
  deadClick: 'Does nothing',
  loop: 'Went round in circles',
  undo: 'Changed and changed back',
  abandon: 'Gave up here',
  copilotRejected: 'Copilot turned down',
  copilotFailed: 'Copilot step failed',
  copilotMissed: 'Copilot missed',
  copilotWrongScreen: 'Copilot on wrong screen',
};

export function struggleTitle(kind: string, n: number, screenName: string, control: string | null): string {
  const c = control ? `"${control}"` : 'a control';
  /* The verb agrees with the count: 1 person opens, 2 people open. */
  const v = (plural: string, singular: string) => (n === 1 ? singular : plural);
  switch (kind) {
    case 'backtrack':
      return `${people(n)} ${v('open', 'opens')} ${screenName} and ${v('come', 'comes')} straight back`;
    case 'peek':
      return `${people(n)} ${v('open', 'opens')} ${c} and ${v('close', 'closes')} it without choosing`;
    case 'deadClick':
      return `${c} does nothing for ${people(n)}`;
    case 'loop':
      return `${people(n)} ${v('go', 'goes')} round in a loop through ${screenName}`;
    case 'undo':
      return `${people(n)} ${v('change', 'changes')} ${c} and ${v('change', 'changes')} it back`;
    case 'abandon':
      return `${people(n)} ${v('give', 'gives')} up on ${screenName}`;
    case 'copilotRejected':
      return `${people(n)} turned down the copilot's step ${c}`;
    case 'copilotFailed':
      return `The copilot's step ${c} failed for ${people(n)}`;
    case 'copilotMissed':
      return `The copilot pointed at ${c}, which was not there, for ${people(n)}`;
    case 'copilotWrongScreen':
      return `The copilot refused a learned step here for ${people(n)}: wrong screen`;
    default:
      return `${people(n)}: ${kind}`;
  }
}

export function struggleId(r: Pick<StruggleRow, 'screen_id' | 'kind' | 'control'>): string {
  return Buffer.from(`${r.screen_id}|${r.kind}|${r.control}`).toString('base64url');
}

export function parseStruggleId(id: string): { screen_id: string; kind: string; control: string } | null {
  try {
    const [screen_id, kind, ...rest] = Buffer.from(id, 'base64url').toString('utf8').split('|');
    if (!screen_id || !kind) return null;
    return { screen_id, kind, control: rest.join('|') };
  } catch {
    return null;
  }
}

export function listStruggles(db: DatabaseSync, productId: string, screenName: (id: string) => string): Struggle[] {
  const rows = db
    .prepare('SELECT screen_id, kind, control, action_json, attempts, installs FROM struggles WHERE product_id = ? ORDER BY installs DESC, attempts DESC, screen_id, kind')
    .all(productId) as StruggleRow[];
  return rows.map((r) => {
    const action = r.action_json ? (JSON.parse(r.action_json) as PathAction) : null;
    const text = controlName(action);
    const name = screenName(r.screen_id);
    return {
      ...r,
      id: struggleId(r),
      screenName: name,
      control_text: text,
      title: struggleTitle(r.kind, r.installs, name, text),
      chip: STRUGGLE_CHIPS[r.kind] ?? r.kind,
      copilot: r.kind.startsWith('copilot'),
    };
  });
}

type Step = { install: string; episode: string; seq: number; at: number; source: string; from: string | null; to: string | null; nameHash: string | null; action: PathAction };

function episodes(db: DatabaseSync, productId: string): Map<string, Step[]> {
  const rows = db
    .prepare(
      `SELECT t.install_id, t.episode, t.seq, t.at, t.source, bm.screen_id AS b, am.screen_id AS a, t.action_json
         FROM transitions t
         LEFT JOIN screen_members bm ON bm.obs_hash = t.before_hash
         LEFT JOIN screen_members am ON am.obs_hash = t.after_hash
        WHERE t.product_id = ?
        ORDER BY t.install_id, t.episode, t.seq`
    )
    .all(productId) as Array<{ install_id: string; episode: string; seq: number; at: number; source: string; b: string | null; a: string | null; action_json: string }>;
  const out = new Map<string, Step[]>();
  for (const r of rows) {
    const action = JSON.parse(r.action_json) as PathAction;
    const key = `${r.install_id}\u0000${r.episode}`;
    const list = out.get(key) ?? [];
    list.push({ install: r.install_id, episode: r.episode, seq: r.seq, at: r.at, source: r.source, from: r.b, to: r.a, nameHash: action.target?.name?.hash ?? null, action });
    out.set(key, list);
  }
  return out;
}

export type Afterwards = { episodes: number; next: Array<{ screen: string; count: number }> };

/* Where people went after this struggle: the first screen, other than the one they
   struggled on, that each episode moved to next. Counted per episode. */
export function afterStruggle(db: DatabaseSync, productId: string, s: Pick<StruggleRow, 'screen_id' | 'kind' | 'action_json'>): Afterwards {
  const hash = s.action_json ? ((JSON.parse(s.action_json) as PathAction).target?.name?.hash ?? null) : null;
  const counts = new Map<string, number>();
  let matched = 0;
  for (const steps of episodes(db, productId).values()) {
    let hit = -1;
    let back: string | null = null;
    for (let i = 0; i < steps.length; i++) {
      const t = steps[i];
      if (s.kind === 'backtrack') {
        /* Arrived here by that control, then left straight back where they came from. */
        const nxt = steps[i + 1];
        if (t.to === s.screen_id && t.from !== s.screen_id && (!hash || t.nameHash === hash) && nxt && nxt.from === s.screen_id && nxt.to === t.from) {
          hit = i + 1;
          back = t.from;
          break;
        }
      } else if (t.from === s.screen_id && (!hash || t.nameHash === hash)) {
        hit = i;
        break;
      }
    }
    if (hit < 0) continue;
    matched++;
    const leftFrom = back ?? s.screen_id;
    for (let j = hit + 1; j < steps.length; j++) {
      const t = steps[j];
      if (t.to && t.to !== t.from && t.to !== s.screen_id && t.to !== leftFrom) {
        counts.set(t.to, (counts.get(t.to) ?? 0) + 1);
        break;
      }
    }
  }
  return {
    episodes: matched,
    next: [...counts.entries()].map(([screen, count]) => ({ screen, count })).sort((a, b) => b.count - a.count || (a.screen < b.screen ? -1 : 1)),
  };
}

export type CopilotCase = { at: number; kind: string; proposed: string; didNext: string[] };

/* For the copilot's own mistakes on a screen: what it proposed, and the next few things
   the same person did themselves within ten minutes. */
export function copilotCases(db: DatabaseSync, productId: string, screenId: string, kinds: string[], limit = 5): CopilotCase[] {
  const decisionKinds: Record<string, string[]> = {
    copilotRejected: ['skipped'],
    copilotFailed: ['failed'],
    copilotMissed: ['repaired', 'repair-failed'],
    copilotWrongScreen: ['wrongScreen'],
  };
  const wanted = kinds.flatMap((k) => decisionKinds[k] ?? []);
  if (!wanted.length) return [];
  const rows = db
    .prepare(
      `SELECT d.install_id, d.at, d.kind, d.url, d.heading_json, d.planned_json, d.action_json
         FROM decisions d
        WHERE d.product_id = ? AND d.kind IN (${wanted.map(() => '?').join(', ')})
        ORDER BY d.at DESC`
    )
    .all(productId, ...wanted) as Array<{ install_id: string; at: number; kind: string; url: string | null; heading_json: string | null; planned_json: string | null; action_json: string | null }>;
  /* Placed the way learning placed them: by the page heading, which a screen lists
     among its keys as "H:<hash>". */
  const screen = db.prepare('SELECT core_keys_json FROM screens WHERE id = ?').get(screenId) as { core_keys_json: string } | undefined;
  const headings = new Set((screen ? (JSON.parse(screen.core_keys_json) as string[]) : []).filter((k) => k.startsWith('H:')).map((k) => k.slice(2)));
  const nextUser = db.prepare(
    `SELECT t.action_json, am.screen_id AS a
       FROM transitions t LEFT JOIN screen_members am ON am.obs_hash = t.after_hash
      WHERE t.product_id = ? AND t.install_id = ? AND t.source = 'user' AND t.at > ? AND t.at <= ?
      ORDER BY t.at LIMIT 3`
  );
  const out: CopilotCase[] = [];
  for (const d of rows) {
    const heading = d.heading_json ? (JSON.parse(d.heading_json) as { hash?: string } | null) : null;
    if (!heading?.hash || !headings.has(heading.hash)) continue;
    const planned = d.planned_json ? (JSON.parse(d.planned_json) as { role: string | null; name: { text?: string } | null } | null) : null;
    const act = d.action_json ? (JSON.parse(d.action_json) as { type: string; value?: boolean }) : null;
    const name = planned?.name?.text ?? 'a control (its label is private)';
    const verb = act?.type === 'setChecked' ? (act.value === false ? 'Untick' : 'Tick') : act?.type === 'setValue' ? 'Fill in' : 'Click';
    const did = (nextUser.all(productId, d.install_id, d.at, d.at + 600_000) as Array<{ action_json: string; a: string | null }>).map((t) => {
      const a = JSON.parse(t.action_json) as PathAction;
      const n = controlName(a) ?? 'a control (its label is private)';
      return a.type === 'setChecked' ? `${a.value === false ? 'Untick' : 'Tick'} ${n}` : a.type === 'setValue' ? `Fill in ${n}` : n;
    });
    out.push({ at: d.at, kind: d.kind, proposed: `${verb} ${name}`, didNext: did });
    if (out.length >= limit) break;
  }
  return out;
}
