/* Pure-logic check of the matching layer: no DOM, no browser.
   Observations below mirror what observer.js produces on each fixture screen. */
global.window = {};
require('../core/target.js');
const { locate } = global.window.CC.target;
const plan = require('../plans/jira-contractor-permissions.json');

const n = (role, name, state) => ({ role, name, state });

const screens = {
  project: [
    n('navigation', 'Payments'), n('link', 'Backlog'), n('link', 'Board'),
    n('link', 'Issues'), n('link', 'Project settings'), n('heading', 'Board'),
  ],
  'project-settings': [
    n('link', 'Project settings'), n('heading', 'Project settings'),
    n('link', 'Details'), n('link', 'Access'), n('link', 'Permissions'), n('link', 'Notifications'),
  ],
  permissions: [
    n('link', 'Project settings'), n('heading', 'Permissions'),
    n('button', 'Actions', { expanded: false }),
  ],
  'permissions-menu-open': [
    n('link', 'Project settings'), n('heading', 'Permissions'),
    n('button', 'Actions', { expanded: true }),
    n('menuitem', 'Edit permissions'), n('menuitem', 'Use a different scheme'), n('menuitem', 'Copy scheme'),
  ],
  'edit-permissions': [
    n('heading', 'Edit permissions'),
    n('checkbox', 'Browse projects for Developers', { checked: true }),
    n('checkbox', 'Browse projects for Contractors', { checked: true }),
    n('checkbox', 'Edit issues for Developers', { checked: true }),
    n('checkbox', 'Edit issues for Contractors', { checked: true }),
    n('checkbox', 'Delete issues for Developers', { checked: true }),
    n('checkbox', 'Delete issues for Contractors', { checked: false }),
  ],
};

for (const key of Object.keys(screens)) {
  screens[key] = { nodes: screens[key].map((node, id) => ({ ...node, id })) };
}

const cases = [
  ['s1 on project',            'project',                 0, 'Project settings'],
  ['s2 on project-settings',   'project-settings',        1, 'Permissions'],
  ['s3 on permissions',        'permissions',             2, 'Actions'],
  ['s4 with menu open',        'permissions-menu-open',   3, 'Edit permissions'],
  ['s5 on edit-permissions',   'edit-permissions',        4, 'Edit issues for Contractors'],
];

let failures = 0;
for (const [label, screen, stepIndex, expected] of cases) {
  const step = plan.steps[stepIndex];
  const res = locate(screens[screen], step.target);
  const got = res.found ? res.node.name : '(not found)';
  const ok = res.found && got === expected && !res.ambiguous;
  if (!ok) failures++;
  const note = res.ambiguous ? `  AMBIGUOUS across ${res.candidates.length}` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(26)} -> ${got}${note}`);
}

/* Negative cases: the plan must not resolve on the wrong screen, otherwise the
   runner would happily act somewhere it should have failed loudly. */
const negatives = [
  ['s4 before menu is open', 'permissions', 3],
  ['s5 before reaching edit', 'permissions', 4],
  ['s2 from the board screen', 'project', 1],
];
for (const [label, screen, stepIndex] of negatives) {
  const res = locate(screens[screen], plan.steps[stepIndex].target);
  const ok = !res.found;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(26)} -> correctly ${res.found ? 'FOUND (bad)' : 'not found'}`);
}

/* Null role: the planner declining to guess about a screen it had not seen.
   Should match on name, and prefer the link over the heading with the same text. */
const nullRole = [
  ['null role picks the link over the heading', 'project-settings', { role: null, name: 'Permissions' }, 'Permissions', 'link'],
  ['null role still finds the button',          'permissions',      { role: null, name: 'Actions' },      'Actions',     'button'],
  ['null role finds the right checkbox',        'edit-permissions', { role: null, name: 'Edit issues for Contractors' }, 'Edit issues for Contractors', 'checkbox'],
];
for (const [label, screen, target, expectedName, expectedRole] of nullRole) {
  const res = locate(screens[screen], target);
  const ok = res.found && res.node.name === expectedName && res.node.role === expectedRole;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(26)} -> ${res.found ? `${res.node.role}/${res.node.name}` : '(not found)'}`);
}

/* Section disambiguation: the real console page had the same model button under
   four category headings, which {role, name} alone cannot address. */
const sectioned = {
  nodes: [
    { role: 'button', name: 'GPT OSS 120B', within: 'Reasoning' },
    { role: 'button', name: 'GPT OSS 120B', within: 'Function Calling' },
    { role: 'button', name: 'GPT OSS 20B', within: 'Reasoning' },
  ].map((n, id) => ({ ...n, id })),
};

const withinCases = [
  ['within picks the right section', { role: 'button', name: 'GPT OSS 120B', within: 'Function Calling' }, 1],
  ['within picks the other one',     { role: 'button', name: 'GPT OSS 120B', within: 'Reasoning' }, 0],
];
for (const [label, target, expectedId] of withinCases) {
  const res = locate(sectioned, target);
  const ok = res.found && res.node.id === expectedId && !res.ambiguous;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(26)} -> id ${res.found ? res.node.id : '?'}${res.ambiguous ? ' AMBIGUOUS' : ''}`);
}

/* A wrong section must not disqualify the only sensible match, or a guessed
   `within` becomes the `tab` role failure all over again. */
{
  const res = locate(sectioned, { role: 'button', name: 'GPT OSS 20B', within: 'Nonexistent Section' });
  const ok = res.found && res.node.name === 'GPT OSS 20B';
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${'wrong within still matches'.padEnd(26)} -> ${res.found ? res.node.name : '(not found)'}`);
}

/* Without `within`, identical names must be reported ambiguous rather than
   silently resolved. */
{
  const res = locate(sectioned, { role: 'button', name: 'GPT OSS 120B' });
  const ok = res.found && res.ambiguous;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${'no within is ambiguous'.padEnd(26)} -> ambiguous=${res.ambiguous}`);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
