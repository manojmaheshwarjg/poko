import { createHash } from 'node:crypto';

/* Screen ids that survive re-running the pipeline.
 *
 * Clustering is recomputed from scratch each run, which keeps it honest, but a
 * learned route has to point at a screen by id, and that id must not change just
 * because a few new observations arrived. Observations are content-hashed and
 * immutable, so the overlap in members between an old screen and a new one is a
 * reliable way to recognise it again.
 *
 * Matching is greedy by overlap, largest first, so a small new cluster cannot take
 * the id that belongs to the large cluster it split from. A new cluster that does
 * not overlap enough with any previous one gets a fresh id. */

export type Prior = Map<string, Set<string>>;

export function freshId(members: string[]): string {
  return 's_' + createHash('sha256').update([...members].sort().join(',')).digest('hex').slice(0, 10);
}

export function assignIds(screens: Array<{ key: string; members: string[] }>, prior: Prior, minShare = 0.5): Map<string, string> {
  const candidates: Array<{ key: string; id: string; overlap: number; ok: boolean }> = [];
  for (const s of screens) {
    const mine = new Set(s.members);
    for (const [id, theirs] of prior) {
      let overlap = 0;
      for (const m of mine) if (theirs.has(m)) overlap++;
      if (overlap === 0) continue;
      const ok = overlap >= minShare * Math.min(mine.size, theirs.size);
      candidates.push({ key: s.key, id, overlap, ok });
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap || (a.key < b.key ? -1 : 1));

  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const c of candidates) {
    if (!c.ok || out.has(c.key) || taken.has(c.id)) continue;
    out.set(c.key, c.id);
    taken.add(c.id);
  }
  for (const s of screens) {
    if (out.has(s.key)) continue;
    let id = freshId(s.members);
    /* A fresh id derived from members could in principle equal a retired one. */
    while (taken.has(id)) id = 's_' + createHash('sha256').update(id).digest('hex').slice(0, 10);
    out.set(s.key, id);
    taken.add(id);
  }
  return out;
}
