/* The small drawing of a screen on the map. Drawn from the kinds of controls the
 * screen was observed to have, never from a screenshot: a screen full of checkboxes
 * becomes a grid, one with several fields becomes a form. Nothing private is needed,
 * because only roles are read, and roles are never redacted. */

export type ThumbKind = 'grid' | 'toggles' | 'form' | 'table' | 'menu' | 'dialog' | 'list' | 'text';
export type Thumb = { kind: ThumbKind; controls: number; roles: Record<string, number> };

const INTERACTIVE = new Set([
  'button', 'link', 'checkbox', 'switch', 'radio', 'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'menuitem',
  'menuitemcheckbox', 'option', 'tab',
]);

/* Keys look like "checkbox:<name>@<section>" or "H:<heading>". */
export function rolesOf(keys: string[]): Record<string, number> {
  const roles: Record<string, number> = {};
  for (const k of keys) {
    const i = k.indexOf(':');
    if (i <= 0) continue;
    const role = k.slice(0, i);
    if (role === 'H') continue;
    roles[role] = (roles[role] ?? 0) + 1;
  }
  return roles;
}

export function thumbFor(keys: string[]): Thumb {
  const roles = rolesOf(keys);
  const n = (r: string) => roles[r] ?? 0;
  const controls = Object.entries(roles).reduce((sum, [r, c]) => sum + (INTERACTIVE.has(r) ? c : 0), 0);
  const fields = n('textbox') + n('searchbox') + n('combobox') + n('spinbutton');
  let kind: ThumbKind;
  if (n('dialog') || n('alertdialog')) kind = 'dialog';
  else if (n('checkbox') >= 4) kind = 'grid';
  else if (n('switch') >= 2) kind = 'toggles';
  else if (fields >= 2) kind = 'form';
  else if (n('menuitem') + n('menuitemcheckbox') >= 2) kind = 'menu';
  else if (n('button') >= 3) kind = 'table';
  else if (n('link') >= 3 && n('button') === 0) kind = 'list';
  else kind = 'text';
  return { kind, controls, roles };
}
