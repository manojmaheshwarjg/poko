import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { fixtureStart, splitFor, type Split } from '@/lib/console/evaluations';
import { plain, when } from '@/lib/console/format';
import { loadMap } from '@/lib/console/model';
import { offer } from '@/lib/console/queue';
import { MapWorkspace } from './MapWorkspace';

export const dynamic = 'force-dynamic';

/* The map: the product's screens as stations, routes as lines, struggles, docs and
   exploration as layers. Everything is loaded and laid out here; the workspace only
   toggles and selects. Loading it makes no model call. */
export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ pid: string }>;
  searchParams: Promise<{ route?: string; screen?: string; compare?: string; layers?: string }>;
}) {
  const { pid } = await params;
  const sp = await searchParams;
  const db = getDb();
  const model = loadMap(db, pid, `/p/${pid}`);
  if (!model) notFound();

  const start = fixtureStart(db, pid);
  const splits: Record<string, Split> = {};
  for (const r of model.routes) {
    if (!r.compareFile) continue;
    const s = splitFor(db, pid, r.compareFile, r.id, start);
    if (s) splits[r.id] = s;
  }
  const now = Date.now();
  const routes = model.routes.map((r) => ({ ...r, history: r.history.map((h) => ({ ...h, when: when(h.at, now) })) }));
  const offers = { verify: offer(db, model.product, 'verify'), compare: offer(db, model.product, 'compare') };

  return (
    <MapWorkspace
      model={plain({ ...model, routes })}
      splits={plain(splits)}
      offers={plain(offers)}
      initial={{ route: sp.route ?? null, screen: sp.screen ?? null, compare: sp.compare === '1', layers: sp.layers ?? null }}
    />
  );
}
