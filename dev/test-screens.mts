/* Screen identity tests. Built from the fixture's real screens plus deliberate
   perturbations, each aimed at one way clustering can silently go wrong.

   The bar: zero merges (precision 1.0) wherever the screens are distinguishable at
   all, and where they genuinely are not, every merge must be flagged ambiguous. A
   silent merge is the one outcome this suite exists to rule out. */
import { clusterScreens, scoreScreens, type ObsRecord, type StoredObs, type StoredNode } from '../service/lib/learn/screens.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const L = (text: string) => ({ hash: 'x' + text.toLowerCase().replace(/\W+/g, '_'), text });
const n = (role: string, text: string, extra: Partial<StoredNode> = {}): StoredNode => ({ role, name: L(text), region: 'chrome', ...extra });
const rail = (): StoredNode[] => [n('link', 'Backlog'), n('link', 'Board'), n('link', 'Issues'), n('link', 'Project settings')];

type Variant = { truth: string; obs: StoredObs; count?: number };
let seq = 0;
const variant = (truth: string, heading: string | null, nodes: StoredNode[], url = 'http://fixture/app', count = 1): Variant => ({
  truth,
  count,
  obs: { url, title: L('Mock Jira'), heading: heading ? L(heading) : null, nodes: [...rail(), ...(heading ? [n('heading', heading)] : []), ...nodes] },
});
const box = (label: string, checked: boolean) => n('checkbox', label, { region: 'content', state: { checked } });
const perms = ['Browse projects', 'Edit issues', 'Delete issues'];
const roles = ['Developers', 'Contractors'];
const matrix = (flip?: string) =>
  perms.flatMap((p) => roles.map((r) => { const l = `${p} for ${r}`; return box(l, l === flip ? false : l !== 'Delete issues for Contractors'); }));

function fixtureVariants(headings = true): Variant[] {
  const h = (t: string) => (headings ? t : null);
  return [
    variant('board', h('Board'), []),
    variant('project-settings', h('Project settings'), [n('link', 'Details'), n('link', 'Access'), n('link', 'Permissions'), n('link', 'Notifications')]),
    variant('access', h('Access'), [n('button', 'Add people'), ...roles.concat('Administrators').map((r) => n('button', `Remove ${r}`, { region: 'content' }))]),
    variant('access', h('Access'), [n('button', 'Add people'), n('button', 'Remove Administrators', { region: 'content' }), n('button', 'Remove Developers', { region: 'content' })]),
    variant('notifications', h('Notifications'), []),
    variant('permissions', h('Permissions'), [n('button', 'Actions', { state: { expanded: false } })]),
    variant('permissions', h('Permissions'), [n('button', 'Actions', { state: { expanded: true } }), n('menuitem', 'Edit permissions'), n('menuitem', 'Use a different scheme'), n('menuitem', 'Copy scheme')]),
    variant('edit-permissions', h('Edit permissions'), matrix()),
    variant('edit-permissions', h('Edit permissions'), matrix('Edit issues for Contractors')),
    variant('edit-permissions', h('Edit permissions'), matrix('Browse projects for Contractors')),
  ];
}

function run(variants: Variant[], opts = {}) {
  const records: ObsRecord[] = variants.map((v) => ({ hash: `o${String(seq++).padStart(4, '0')}`, obs: v.obs, count: v.count ?? 1 }));
  const truth = new Map(records.map((r, i) => [r.hash, new Set([variants[i].truth])]));
  const screens = clusterScreens(records, opts);
  return { screens, score: scoreScreens(screens, truth), records };
}
const fmt = (s: ReturnType<typeof run>['score']) => `precision ${s.precision.toFixed(2)} recall ${s.recall.toFixed(2)}`;

/* A. The fixture's screens, with state changes, an open menu and a removed row */
{
  const { screens, score } = run(fixtureVariants());
  check('A. no merges on the fixture', score.precision === 1, fmt(score));
  check('A. no splits either', score.recall === 1, fmt(score));
  check('A. exactly 6 screens', screens.length === 6, `got ${screens.length}`);
  check('A. an open menu is the same screen, not a new one', !score.splits.some((s) => s.truth === 'permissions'));
  check('A. a toggled checkbox is the same screen', !score.splits.some((s) => s.truth === 'edit-permissions'));
  check('A. none flagged ambiguous', screens.every((s) => !s.ambiguous), screens.filter((s) => s.ambiguous).map((s) => s.displayName).join(','));
  check('A. screens named from their headings', screens.map((s) => s.displayName).sort().join('|') === 'Access|Board|Edit permissions|Notifications|Permissions|Project settings');
}

/* B. One screen dominates traffic. Its keys must not become "global" and erase its
      identity, and the rail must still be recognised as global. */
{
  const v = fixtureVariants().map((x) => (x.truth === 'permissions' ? { ...x, count: 60 } : x));
  const { score } = run(v);
  check('B. a dominant screen does not swallow the others', score.precision === 1 && score.recall === 1, fmt(score));
}

/* C. Data varies per record. Unique row content must not split one screen into many. */
{
  /* A real table page carries many rows, and it is the volume of one-off data that
     dilutes similarity. One unique row per record was too little to notice. */
  const rows = Array.from({ length: 12 }, (_, i) =>
    variant('access', 'Access', [
      n('button', 'Add people'),
      n('button', 'Remove Developers', { region: 'content' }),
      ...Array.from({ length: 10 }, (_, j) => n('link', `Record ${i}-${j} summary`, { region: 'content' })),
    ]));
  const { screens, score } = run([...fixtureVariants(), ...rows]);
  check('C. twelve different records are still one screen', !score.splits.some((s) => s.truth === 'access'), fmt(score));
  check('C. and still no merges', score.precision === 1, fmt(score));
  check('C. screen count unchanged', screens.length === 6, `got ${screens.length}`);
}

/* D. No headings at all (the Groq console had zero h1s). Board and Notifications
      then consist of nothing but the global rail and are genuinely identical. The
      requirement is not that they separate (nothing could) but that any merge is
      flagged ambiguous rather than trusted. */
{
  const { screens, score } = run(fixtureVariants(false));
  check('D. every merge is flagged ambiguous', score.merges.every((m) => m.ambiguous), JSON.stringify(score.merges.map((m) => [m.screen, m.ambiguous])));
  check('D. the only merge is the pair that is genuinely identical',
    score.merges.length === 1 && score.merges[0].truths.sort().join() === 'board,notifications', JSON.stringify(score.merges.map((m) => m.truths)));
  const names = screens.map((s) => s.displayName);
  check('D. headless screens get distinct, readable names', new Set(names).size === names.length && !names.some((x) => x === '/app'), names.join(' | '));
  const distinct = ['project-settings', 'access', 'permissions', 'edit-permissions'];
  check('D. screens with their own controls still separate', !score.merges.some((m) => m.truths.some((t) => distinct.includes(t))), JSON.stringify(score.merges));
}

/* E. Distinct URLs are never merged, even when the structure is identical. */
{
  const v = fixtureVariants(false).map((x) => ({ ...x, obs: { ...x.obs, url: `http://fixture/${x.truth}` } }));
  const { score } = run(v);
  check('E. identical structure, different URL: kept apart', score.precision === 1, fmt(score));
  check('E. and an open menu no longer splits off with no heading to anchor it', score.recall === 1, fmt(score));
}

/* F. Ids in URLs are normalised upstream, so one screen reached from two projects
      arrives with the same pattern and must be one screen. */
{
  const a = variant('board', 'Board', [], 'http://app/projects/:id/board');
  const b = variant('board', 'Board', [], 'http://app/projects/:id/board');
  const c = variant('notifications', 'Notifications', [], 'http://app/projects/:id/notifications');
  const { score } = run([a, b, c]);
  check('F. normalised ids: same screen joins, different screen stays apart', score.precision === 1 && score.recall === 1, fmt(score));
}

/* G. Determinism: the same observations in a different order give the same screens. */
{
  const base = fixtureVariants();
  const recs = base.map((v, i) => ({ hash: `d${i}`, obs: v.obs, count: 1 }));
  const shuffled = [...recs].reverse();
  const sig = (s: ReturnType<typeof clusterScreens>) => s.map((x) => x.members.join(',')).sort().join('|');
  check('G. order of input does not change the result', sig(clusterScreens(recs)) === sig(clusterScreens(shuffled)));
}

/* H. The scorer itself: a clustering known to be wrong must score as wrong. */
{
  const v = fixtureVariants();
  const records = v.map((x, i) => ({ hash: `s${i}`, obs: x.obs, count: 1 }));
  const truth = new Map(records.map((r, i) => [r.hash, new Set([v[i].truth])]));
  const allOne = [{ key: 'k', members: records.map((r) => r.hash), count: 10, urlPattern: '', displayName: 'all', coreKeys: [], informativeWeight: 0, ambiguous: true }];
  const singletons = records.map((r) => ({ key: r.hash, members: [r.hash], count: 1, urlPattern: '', displayName: r.hash, coreKeys: [], informativeWeight: 5, ambiguous: false }));
  check('H. scorer catches a total merge', scoreScreens(allOne, truth).precision < 0.5);
  check('H. scorer catches a total split', scoreScreens(singletons, truth).recall === 0);
  const clash = new Map([['z', new Set(['a', 'b'])]]);
  check('H. scorer reports observations no algorithm could separate', scoreScreens([], clash).indistinguishable.length === 1);
}

/* I. Margin: how wide is the band of thresholds that still gets the fixture right?
      A narrow band would mean the result is luck, not design. */
{
  const band: string[] = [];
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const { score } = run(fixtureVariants(), { threshold: t });
    band.push(`${t}:${score.precision === 1 && score.recall === 1 ? 'ok' : `p${score.precision.toFixed(2)}/r${score.recall.toFixed(2)}`}`);
  }
  const okCount = band.filter((b) => b.endsWith('ok')).length;
  check('I. default threshold sits inside a wide correct band', okCount >= 4, band.join('  '));
}

/* J. Cold start: the first few observations, before there is enough data to detect
      a nav rail as global. Two screens share a whole toolbar and differ only by
      heading. The heading's weight is what keeps them apart at this stage. */
{
  const toolbar = () => ['Search', 'Filter', 'Export', 'Share', 'Help'].map((x) => n('button', x));
  const a = variant('reports', 'Reports', toolbar());
  const b = variant('dashboards', 'Dashboards', toolbar());
  const { score } = run([a, b]);
  check('J. cold start: shared toolbar, different heading, kept apart', score.precision === 1, fmt(score));
}

/* K. Chaining. B is an overlay state of screen X that happens to contain controls
      also found on screen Y. A resembles B, B resembles C, A and C share little.
      Single linkage would chain X and Y together through B. */
{
  const bare = (names: string[]) => names.map((x) => n('button', x));
  const A = variant('x', null, bare(['p', 'q', 'r', 's']), 'http://one');
  const B = variant('x', null, bare(['p', 'q', 'r', 's', 't', 'u']), 'http://one');
  const C = variant('y', null, bare(['r', 's', 't', 'u', 'v']), 'http://one');
  const noRail = (v: Variant) => ({ ...v, obs: { ...v.obs, nodes: v.obs.nodes.filter((x) => !['Backlog', 'Board', 'Issues', 'Project settings'].includes(x.name?.text ?? '')) } });
  const { score } = run([A, B, C].map(noRail));
  check('K. no chaining two screens together through an in-between state', score.precision === 1, fmt(score));
}

/* L. Same control names, different sections. On the Groq console the same button
      sat under four category headings. Two screens built from identical names in
      different sections must not merge, and if they did, it would be SILENT: the
      merged screen would look perfectly well identified. */
{
  const sectioned = (section: string) => ['Edit', 'Delete', 'Archive'].map((x) => n('button', x, { within: L(section) }));
  const a = variant('invoices', null, sectioned('Invoices'), 'http://one');
  const b = variant('customers', null, sectioned('Customers'), 'http://one');
  const { score } = run([a, b]);
  check('L. same names under different sections are different screens', score.precision === 1, fmt(score));
}

/* M. Determinism under ties. Four observations overlapping in a chain, every
      adjacent pair exactly as similar as the next, so which pair merges first
      decides the outcome. Every ordering of the input must still agree. */
{
  const mk = (h: string, names: string[]): ObsRecord => ({
    hash: h, count: 1,
    obs: { url: 'http://one', title: null, heading: null, nodes: names.map((x) => n('button', x)) },
  });
  const base = [mk('a', ['1', '2']), mk('b', ['2', '3']), mk('c', ['3', '4']), mk('d', ['4', '5'])];
  const perms = (xs: ObsRecord[]): ObsRecord[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  const sig = (s: ReturnType<typeof clusterScreens>) => s.map((x) => x.members.join(',')).sort().join('|');
  const results = new Set(perms(base).map((p) => sig(clusterScreens(p, { threshold: 0.3 }))));
  check('M. all 24 input orders give the same screens despite exact ties', results.size === 1, [...results].join('  vs  '));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
