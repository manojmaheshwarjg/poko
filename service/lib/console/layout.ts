/* The map's layout: screens as stations in columns, links as lines between them.
 *
 * Columns come from how far a screen is from where people start (the longest way in,
 * once links that go back are set aside), so the map reads left to right the way
 * people move through the product. Within a
 * column, screens are ordered to follow the screens that lead to them (barycentre
 * sweeps), then each is placed as close as possible to the height of those screens,
 * which keeps a path through the product a nearly straight line. That placement is
 * isotonic regression: the closest positions to the wanted ones that keep the order
 * and a fixed gap, solved exactly by pooling adjacent violators.
 *
 * Lines are orthogonal, like a transit map. A link that skips columns runs in a lane
 * under the map so it never crosses a station. A link that goes back (a person
 * returning to an earlier screen) leaves lower on the station and turns in the gap
 * between columns, or in the lane when it goes back further than one column.
 *
 * Pure and deterministic: every sort breaks ties by id, so the same product always
 * draws the same map, and a new screen moves as little else as possible. */

export type LayoutNode = { id: string; weight: number };
export type LayoutLink = { from: string; to: string; weight: number };
export type LayoutOptions = {
  nodeW?: number;
  nodeH?: number;
  gapX?: number;
  gapY?: number;
  pad?: number;
  /* Where people start. Otherwise: screens nothing leads to, heaviest first. */
  entries?: string[];
};

export type PlacedNode = { id: string; x: number; y: number; layer: number; order: number };
export type RoutedLink = {
  from: string;
  to: string;
  back: boolean;
  d: string;
  /* Where a count on this line is drawn. */
  label: { x: number; y: number };
};
export type Layout = { nodes: PlacedNode[]; links: RoutedLink[]; width: number; height: number; nodeW: number; nodeH: number };

const byWeightThenId = (w: Map<string, number>) => (a: string, b: string) => (w.get(b) ?? 0) - (w.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);

/* Pool adjacent violators: minimise sum (y_i - want_i)^2 subject to
   y_{i+1} - y_i >= step, by solving the plain isotonic problem on z_i = y_i - i*step. */
export function spaceOut(want: number[], step: number): number[] {
  const target = want.map((w, i) => w - i * step);
  const blocks: Array<{ sum: number; count: number }> = [];
  for (const t of target) {
    blocks.push({ sum: t, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  }
  const z: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.count; i++) z.push(b.sum / b.count);
  return z.map((v, i) => v + i * step);
}

export function layoutMap(nodes: LayoutNode[], links: LayoutLink[], opts: LayoutOptions = {}): Layout {
  const W = opts.nodeW ?? 120;
  const H = opts.nodeH ?? 72;
  const gapX = opts.gapX ?? 64;
  const gapY = opts.gapY ?? 28;
  const pad = opts.pad ?? 24;
  const step = H + gapY;
  if (!nodes.length) return { nodes: [], links: [], width: pad * 2 + W, height: pad * 2 + H, nodeW: W, nodeH: H };

  const ids = new Set(nodes.map((n) => n.id));
  const weight = new Map(nodes.map((n) => [n.id, n.weight]));
  const order = byWeightThenId(weight);

  /* One link per ordered pair, self links dropped: an action that stays on its screen
     is a control of that screen, not a line on the map. */
  const pair = new Map<string, LayoutLink>();
  for (const l of links) {
    if (l.from === l.to || !ids.has(l.from) || !ids.has(l.to)) continue;
    const k = `${l.from}\u0000${l.to}`;
    const prev = pair.get(k);
    pair.set(k, prev ? { ...prev, weight: prev.weight + l.weight } : { ...l });
  }
  const all = [...pair.values()].sort((a, b) => b.weight - a.weight || (a.from + a.to < b.from + b.to ? -1 : 1));
  const out = new Map<string, string[]>();
  const into = new Map<string, number>();
  for (const l of all) {
    out.set(l.from, [...(out.get(l.from) ?? []), l.to]);
    into.set(l.to, (into.get(l.to) ?? 0) + l.weight);
  }

  /* Layers. First find the links that go back, depth first from where people start,
     taking heavier links first: a link into a screen still being walked is a return,
     and so is any link into an entry, so where people start stays the first column.
     Then each screen goes one column past the furthest screen that leads to it, so a
     rare shortcut does not drag a deep screen forward; it becomes a long line in the
     lane instead. */
  const sorted = [...ids].sort(order);
  const entries = (opts.entries ?? []).filter((e) => ids.has(e));
  const entrySet = new Set(entries);
  const backSet = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const dfs = (v: string) => {
    state.set(v, 1);
    for (const w of out.get(v) ?? []) {
      const k = `${v}\u0000${w}`;
      if (entrySet.has(w) || state.get(w) === 1) backSet.add(k);
      else if (!state.has(w)) dfs(w);
    }
    state.set(v, 2);
  };
  for (const e of entries) if (!state.has(e)) dfs(e);
  const roots = sorted.filter((id) => !into.has(id));
  for (const r of roots) if (!state.has(r)) dfs(r);
  for (const id of sorted) if (!state.has(id)) dfs(id);

  const forward = all.filter((l) => !backSet.has(`${l.from}\u0000${l.to}`));
  const indeg = new Map(sorted.map((id) => [id, 0]));
  for (const l of forward) indeg.set(l.to, indeg.get(l.to)! + 1);
  const layer = new Map<string, number>();
  const ready = sorted.filter((id) => indeg.get(id) === 0);
  for (const id of ready) layer.set(id, 0);
  while (ready.length) {
    const v = ready.shift()!;
    for (const l of forward) {
      if (l.from !== v) continue;
      layer.set(l.to, Math.max(layer.get(l.to) ?? 0, layer.get(v)! + 1));
      indeg.set(l.to, indeg.get(l.to)! - 1);
      if (indeg.get(l.to) === 0) ready.push(l.to);
    }
  }

  const maxLayer = Math.max(...layer.values());
  const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of sorted) columns[layer.get(id)!].push(id);

  const forwardPreds = (id: string) => all.filter((l) => l.to === id && layer.get(l.from)! < layer.get(id)!);
  const forwardSuccs = (id: string) => all.filter((l) => l.from === id && layer.get(l.to)! > layer.get(id)!);

  /* Order within columns: barycentres of neighbours, a few sweeps each way. */
  const pos = new Map<string, number>();
  const index = () => columns.forEach((c) => c.forEach((id, i) => pos.set(id, i)));
  index();
  const sweep = (c: string[], neighbours: (id: string) => Array<{ id: string; w: number }>) => {
    const bary = new Map<string, number>();
    for (const id of c) {
      const ns = neighbours(id);
      const total = ns.reduce((s, n) => s + n.w, 0);
      bary.set(id, total ? ns.reduce((s, n) => s + (pos.get(n.id) ?? 0) * n.w, 0) / total : pos.get(id)!);
    }
    c.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
    c.forEach((id, i) => pos.set(id, i));
  };
  for (let round = 0; round < 4; round++) {
    for (let L = 1; L <= maxLayer; L++) sweep(columns[L], (id) => forwardPreds(id).map((l) => ({ id: l.from, w: l.weight || 1 })));
    for (let L = maxLayer - 1; L >= 0; L--) sweep(columns[L], (id) => forwardSuccs(id).map((l) => ({ id: l.to, w: l.weight || 1 })));
  }

  /* Heights: as close to the screens that lead here as the gaps allow, following the
     screens in the column just before when there are any, since a longer line runs in
     the lane and does not need to be straight. */
  const y = new Map<string, number>();
  columns.forEach((c, L) => {
    const want = c.map((id, i) => {
      const placedPreds = L === 0 ? [] : forwardPreds(id).filter((l) => y.has(l.from));
      const adjacent = placedPreds.filter((l) => layer.get(l.from) === L - 1);
      const preds = adjacent.length ? adjacent : placedPreds;
      const total = preds.reduce((s, l) => s + (l.weight || 1), 0);
      return total ? preds.reduce((s, l) => s + y.get(l.from)! * (l.weight || 1), 0) / total : i * step;
    });
    const placed = spaceOut(want, step);
    c.forEach((id, i) => y.set(id, placed[i]));
  });
  const minY = Math.min(...y.values());
  for (const [id, v] of y) y.set(id, Math.round(v - minY + pad));

  const placedNodes: PlacedNode[] = [];
  columns.forEach((c, L) => c.forEach((id, i) => placedNodes.push({ id, x: pad + L * (W + gapX), y: y.get(id)!, layer: L, order: i })));
  const at = new Map(placedNodes.map((n) => [n.id, n]));
  const bottom = Math.max(...placedNodes.map((n) => n.y)) + H;

  /* Lines. Links leaving one screen share a junction; links from different screens
     into the same gap get their own vertical, so they never run on top of each other. */
  const links2: RoutedLink[] = [];
  const junction = new Map<string, number>();
  for (let L = 0; L < maxLayer; L++) {
    const sources = columns[L].filter((id) => all.some((l) => l.from === id && layer.get(l.to) === L + 1));
    sources.forEach((id, k) => junction.set(id, (k - (sources.length - 1) / 2) * 6));
  }
  /* Verticals only ever run in the gaps between columns and horizontals only at a
     station's own height or in a lane under the whole map, so no line crosses a
     station. Returning links enter and leave lower on a station than forward ones,
     so the two directions of a two-way link read as two lines. */
  let lane = 0;
  const nextLane = () => bottom + 18 + lane++ * 8;
  const low = (n: PlacedNode) => n.y + Math.round(H * 0.74);
  for (const l of all) {
    const a = at.get(l.from)!;
    const b = at.get(l.to)!;
    const y1 = a.y + H / 2;
    const y2 = b.y + H / 2;
    if (b.layer === a.layer + 1) {
      const x1 = a.x + W;
      const x2 = b.x;
      const mx = Math.round(x1 + gapX / 2 + (junction.get(l.from) ?? 0));
      const d = y1 === y2 ? `M${x1} ${y1} H${x2}` : `M${x1} ${y1} H${mx} V${y2} H${x2}`;
      links2.push({ from: l.from, to: l.to, back: false, d, label: { x: mx, y: Math.round((y1 + y2) / 2) } });
    } else if (b.layer > a.layer + 1) {
      const x1 = a.x + W;
      const x2 = b.x;
      const laneY = nextLane();
      const m1 = Math.round(x1 + gapX / 2);
      const m2 = Math.round(x2 - gapX / 2);
      const d = `M${x1} ${y1} H${m1} V${laneY} H${m2} V${y2} H${x2}`;
      links2.push({ from: l.from, to: l.to, back: false, d, label: { x: Math.round((m1 + m2) / 2), y: laneY } });
    } else if (b.layer === a.layer - 1) {
      /* Back one column: out of the left of one station, into the right of the other,
         turning in the gap between them. */
      const ya = low(a);
      const yb = low(b);
      const cx = Math.round(a.x - gapX / 2 - 10);
      const d = ya === yb ? `M${a.x} ${ya} H${b.x + W}` : `M${a.x} ${ya} H${cx} V${yb} H${b.x + W}`;
      links2.push({ from: l.from, to: l.to, back: true, d, label: { x: Math.round((a.x + cx) / 2), y: ya } });
    } else {
      /* Back further, or within a column: down to a lane under the map and along it. */
      const ya = low(a);
      const yb = low(b);
      const laneY = nextLane();
      const c1 = Math.round(a.x - gapX / 2 - 10);
      const c2 = Math.round(b.x + W + gapX / 2 + 10);
      const d = b.layer === a.layer
        ? `M${a.x + W} ${ya} H${a.x + W + 14} V${yb} H${b.x + W}`
        : `M${a.x} ${ya} H${c1} V${laneY} H${c2} V${yb} H${b.x + W}`;
      links2.push({ from: l.from, to: l.to, back: true, d, label: { x: Math.round((c1 + c2) / 2), y: laneY } });
    }
  }

  const width = pad * 2 + (maxLayer + 1) * W + maxLayer * gapX;
  const height = (lane ? bottom + 18 + (lane - 1) * 8 : bottom) + pad;
  return { nodes: placedNodes, links: links2, width, height, nodeW: W, nodeH: H };
}
