/* A behavioural model of the fixture: given its state and an action, produce the
   next state and the observation a recorder would have captured. Used to generate
   human sessions for mining tests, so that effect classification is exercised on
   real before/after diffs rather than on effects someone labelled by hand. */
import type { StoredObs, StoredNode } from '../service/lib/learn/screens.ts';
import type { Step } from '../service/lib/learn/mine.ts';

export const L = (t: string) => ({ hash: 'x' + t.toLowerCase().replace(/\W+/g, '_'), text: t });
const nd = (role: string, t: string, extra: Partial<StoredNode> = {}): StoredNode => ({ role, name: L(t), region: 'chrome', ...extra });

type Screen = 'board' | 'ps' | 'access' | 'notif' | 'perms' | 'edit';
type World = { screen: Screen; menu: boolean; boxes: Record<string, boolean>; rows: string[] };
export type Act = { type: 'click' | 'setChecked'; role: string; name: string; value?: boolean };

export const BOXES = ['Browse projects', 'Edit issues', 'Delete issues'].flatMap((p) => ['Developers', 'Contractors'].map((r) => `${p} for ${r}`));
const fresh = (): World => ({
  screen: 'board', menu: false,
  boxes: Object.fromEntries(BOXES.map((b) => [b, b !== 'Delete issues for Contractors'])),
  rows: ['Administrators', 'Developers', 'Contractors'],
});

function observe(w: World): StoredObs {
  const rail = ['Backlog', 'Board', 'Issues', 'Project settings'].map((t) => nd('link', t));
  const H = (t: string) => [nd('heading', t)];
  let body: StoredNode[] = [];
  let heading = '';
  switch (w.screen) {
    case 'board': heading = 'Board'; break;
    case 'ps': heading = 'Project settings'; body = ['Details', 'Access', 'Permissions', 'Notifications'].map((t) => nd('link', t)); break;
    case 'access': heading = 'Access'; body = [nd('button', 'Add people'), ...w.rows.map((r) => nd('button', `Remove ${r}`, { region: 'content' }))]; break;
    case 'notif': heading = 'Notifications'; break;
    case 'perms':
      heading = 'Permissions';
      body = [nd('button', 'Actions', { state: { expanded: w.menu } }), ...(w.menu ? ['Edit permissions', 'Use a different scheme', 'Copy scheme'].map((t) => nd('menuitem', t)) : [])];
      break;
    case 'edit': heading = 'Edit permissions'; body = BOXES.map((b) => nd('checkbox', b, { region: 'content', state: { checked: w.boxes[b] } })); break;
  }
  return { url: 'http://localhost:4500/app', title: L('Mock Jira'), heading: L(heading), nodes: [...rail, ...H(heading), ...body] };
}

function apply(w: World, a: Act): World {
  const next: World = { ...w, boxes: { ...w.boxes }, rows: [...w.rows] };
  if (a.role === 'link' && a.name === 'Project settings') return { ...next, screen: 'ps', menu: false };
  if (a.role === 'link' && ['Backlog', 'Board', 'Issues'].includes(a.name)) return { ...next, screen: 'board', menu: false };
  if (w.screen === 'ps' && a.role === 'link') {
    const to: Record<string, Screen> = { Details: 'ps', Access: 'access', Permissions: 'perms', Notifications: 'notif' };
    if (to[a.name]) return { ...next, screen: to[a.name] };
  }
  if (w.screen === 'perms' && a.name === 'Actions') return { ...next, menu: !w.menu };
  if (w.screen === 'perms' && w.menu && a.role === 'menuitem') return a.name === 'Edit permissions' ? { ...next, screen: 'edit', menu: false } : { ...next, menu: false };
  if (w.screen === 'edit' && a.type === 'setChecked') { next.boxes[a.name] = !!a.value; return next; }
  if (w.screen === 'access' && a.name.startsWith('Remove ')) { next.rows = w.rows.filter((r) => `Remove ${r}` !== a.name); return next; }
  return next;
}

let clock = 1_790_000_000_000;
/* One person, one sitting. `pauses` maps a step index to extra seconds of idle
   before it. `copilotAt` marks steps the copilot performed instead of the person. */
export function session(install: string, episode: string, acts: Act[], opts: { pauses?: Record<number, number>; copilotAt?: number[]; source?: 'user' | 'copilot'; start?: Screen } = {}): Step[] {
  let w = { ...fresh(), ...(opts.start ? { screen: opts.start } : {}) };
  const steps: Step[] = [];
  acts.forEach((a, seq) => {
    clock += 3000 + (opts.pauses?.[seq] ?? 0) * 1000;
    const next = apply(w, a);
    const region = a.role === 'checkbox' || a.name.startsWith('Remove ') ? 'content' : 'chrome';
    steps.push({
      at: clock, install, episode, seq,
      source: opts.source ?? (opts.copilotAt?.includes(seq) ? 'copilot' : 'user'),
      from: w.screen, to: next.screen,
      before: observe(w), after: observe(next),
      action: { type: a.type, target: { role: a.role, name: L(a.name), within: null, region }, ...(a.type === 'setChecked' ? { value: a.value } : {}) } as Step['action'],
    });
    w = next;
  });
  return steps;
}

export const click = (role: string, name: string): Act => ({ type: 'click', role, name });
export const tick = (name: string, value: boolean): Act => ({ type: 'setChecked', role: 'checkbox', name, value });
