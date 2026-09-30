/* A route's steps, as a person reads them: "Open Permissions", "Actions, then Edit
 * permissions", "Untick Edit issues for Contractors". Built only from what the route
 * stored (G11). A label that was redacted (customer mode, not yet promoted) has no
 * text, and is shown as private rather than guessed at. */

export type PathAction = {
  type: string;
  value?: boolean | string;
  target?: { role?: string | null; name?: { hash?: string; text?: string } | null } | null;
};
export type PathStep = { screen: string; key?: string; action: PathAction; effect?: string };

export type ReadableStep = {
  /* The screen the step is taken on. */
  screen: string;
  text: string;
  /* How many stored steps this line covers: a menu opened and an item chosen from it
     read as one step. */
  covers: number;
  changes: boolean;
};

export function controlName(action: PathAction | null | undefined): string | null {
  const text = action?.target?.name?.text;
  return text && text.trim() ? text.trim() : null;
}

function one(action: PathAction, effect?: string): { text: string; changes: boolean } {
  const name = controlName(action) ?? 'a control (its label is private)';
  const role = action.target?.role ?? '';
  if (action.type === 'setChecked') return { text: `${action.value === false ? 'Untick' : 'Tick'} ${name}`, changes: true };
  if (action.type === 'setValue') return { text: `Fill in ${name}`, changes: true };
  if (effect === 'navigate' || role === 'link' || role === 'menuitem' || role === 'tab') return { text: `Open ${name}`, changes: false };
  return { text: `Click ${name}`, changes: effect === 'mutate' };
}

export function readableSteps(path: PathStep[]): ReadableStep[] {
  const out: ReadableStep[] = [];
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    const next = path[i + 1];
    /* A button that only opens a menu, followed by a choice from it. */
    if (s.effect === 'open' && next && next.action.target?.role === 'menuitem') {
      const opener = controlName(s.action) ?? 'a menu';
      const item = controlName(next.action) ?? 'an item (its label is private)';
      out.push({ screen: s.screen, text: `${opener}, then ${item}`, covers: 2, changes: next.effect === 'mutate' });
      i++;
      continue;
    }
    const r = one(s.action, s.effect);
    out.push({ screen: s.screen, text: r.text, covers: 1, changes: r.changes });
  }
  return out;
}

/* The screens a route passes through, in order, without repeats in a row. The screen
   a step ends on is the next step's screen; the last step ends on the route's end. */
export function routeScreens(path: PathStep[], endScreen: string): string[] {
  const seq: string[] = [];
  for (const s of path) if (seq[seq.length - 1] !== s.screen) seq.push(s.screen);
  if (endScreen && seq[seq.length - 1] !== endScreen) seq.push(endScreen);
  return seq;
}
