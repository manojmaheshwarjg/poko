'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapLink, MapModel, MapNode, MapRoute } from '@/lib/console/model';
import type { Split } from '@/lib/console/evaluations';
import { Icon } from '../../../_ui/icons';
import { PaidAction, type Offer } from '../../../_ui/PaidAction';
import { runLearning } from '../../../_ui/actions';
import { toast } from '../../../_ui/Toaster';

type Route = Omit<MapRoute, 'history'> & { history: Array<MapRoute['history'][number] & { when: string }> };
type Model = Omit<MapModel, 'routes'> & { routes: Route[] };
type LayerKey = 'traffic' | 'routes' | 'struggles' | 'docs' | 'explored';
type Layers = Record<LayerKey, boolean>;
type Sel = { kind: 'screen' | 'route'; id: string } | null;

const LAYERS: Array<{ key: LayerKey; label: string; swatch: string; hint: string }> = [
  { key: 'traffic', label: 'Traffic', swatch: '#b6bdc7', hint: 'How many people move along each link' },
  { key: 'routes', label: 'Routes', swatch: '#d97706', hint: 'Learned routes, coloured by status' },
  { key: 'struggles', label: 'Struggles', swatch: '#dc2626', hint: 'Where people get stuck' },
  { key: 'docs', label: 'Docs', swatch: '#0d9488', hint: 'Whether the docs mention each screen' },
  { key: 'explored', label: 'Explored', swatch: '#7c3aed', hint: 'Screens and links only exploration has seen' },
];
const DEFAULT_LAYERS: Layers = { traffic: true, routes: true, struggles: true, docs: false, explored: true };
const STATUS_COLOR: Record<string, string> = { verified: '#16a34a', held: '#d97706', candidate: '#2563eb', demoted: '#dc2626', rejected: '#dc2626', gap: '#ea580c', stale: '#9ca3af', blocked: '#9ca3af' };
const DRAWN = new Set(['verified', 'held', 'candidate', 'demoted']);
const ACCENT = '#4f46e5';

function parseLayers(s: string | null): Layers {
  if (!s) return DEFAULT_LAYERS;
  const on = new Set(s.split(','));
  return { traffic: on.has('traffic'), routes: on.has('routes'), struggles: on.has('struggles'), docs: on.has('docs'), explored: on.has('explored') };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function MapWorkspace({
  model,
  splits,
  offers,
  initial,
}: {
  model: Model;
  splits: Record<string, Split>;
  offers: { verify: Offer; compare: Offer };
  initial: { route: string | null; screen: string | null; compare: boolean; layers: string | null };
}) {
  const router = useRouter();
  const base = `/p/${model.product.id}`;
  const [layers, setLayers] = useState<Layers>(() => parseLayers(initial.layers));
  const [sel, setSel] = useState<Sel>(() =>
    initial.route && model.routes.some((r) => r.id === initial.route)
      ? { kind: 'route', id: initial.route }
      : initial.screen && model.nodes.some((n) => n.id === initial.screen)
        ? { kind: 'screen', id: initial.screen }
        : null
  );
  const [compare, setCompare] = useState(initial.compare);

  const nodeBy = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
  const linkBy = useMemo(() => new Map(model.links.map((l) => [`${l.from}>${l.to}`, l])), [model.links]);
  const route = sel?.kind === 'route' ? model.routes.find((r) => r.id === sel.id) ?? null : null;
  const screen = sel?.kind === 'screen' ? nodeBy.get(sel.id) ?? null : null;
  const split = route && compare ? splits[route.id] ?? null : null;
  const listed = model.routes.filter((r) => r.status !== 'blocked');

  /* The address says what is on screen, so it can be shared or reloaded. */
  useEffect(() => {
    const q = new URLSearchParams();
    if (sel) q.set(sel.kind, sel.id);
    if (split) q.set('compare', '1');
    const l = LAYERS.filter((x) => layers[x.key]).map((x) => x.key).join(',');
    if (l !== LAYERS.filter((x) => DEFAULT_LAYERS[x.key]).map((x) => x.key).join(',')) q.set('layers', l || 'none');
    const next = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
    window.history.replaceState(window.history.state, '', next);
  }, [sel, split, layers]);

  const selectRoute = useCallback((id: string | null) => {
    setSel(id ? { kind: 'route', id } : null);
    setCompare(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest('[role=dialog]'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        setSel(null);
        setCompare(false);
      } else if (e.key >= '1' && e.key <= '5') {
        const key = LAYERS[Number(e.key) - 1].key;
        setLayers((l) => ({ ...l, [key]: !l[key] }));
      } else if ((e.key === 'j' || e.key === 'k') && listed.length) {
        const i = route ? listed.findIndex((r) => r.id === route.id) : -1;
        const next = e.key === 'j' ? (i + 1) % listed.length : (i - 1 + listed.length) % listed.length;
        selectRoute(listed[next].id);
      } else if (e.key === 'c' && route && splits[route.id]) setCompare((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listed, route, splits, selectRoute]);

  const learn = async () => {
    if (await runLearning(model.product.origin)) router.refresh();
  };

  const empty = model.nodes.length === 0;
  const pending = model.counts.newActions + model.counts.newPages;

  return (
    <div className="mapws">
      <div className="mapcanvas">
        {empty ? (
          <EmptyMap base={base} origin={model.product.origin} />
        ) : (
          <Canvas model={model} layers={layers} route={route} screen={screen} split={split} nodeBy={nodeBy} linkBy={linkBy} onSelect={setSel} onCompare={setCompare} />
        )}
        {!empty ? (
          <div className="map-over map-layers">
            <span className="lbl">Layers</span>
            {LAYERS.map((l, i) => (
              <button key={l.key} className="chip" aria-pressed={layers[l.key]} title={`${l.hint} (${i + 1})`} onClick={() => setLayers((x) => ({ ...x, [l.key]: !x[l.key] }))}>
                <span className="sw" style={{ background: l.swatch }} />
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
        {pending && !route ? (
          <div className="map-over map-banner" style={{ top: 48 }}>
            <Icon name="bolt" size={13} />
            <span>
              {[model.counts.newActions ? `${model.counts.newActions} new actions` : '', model.counts.newPages ? `${model.counts.newPages} explored pages` : ''].filter(Boolean).join(' and ')} since learning ran
            </span>
            <button className="btn btn-sm btn-primary" onClick={learn}>
              Run learning, free
            </button>
          </div>
        ) : null}
        <div className="map-over map-bottom">
          {route ? (
            split ? (
              <SplitStrip split={split} nodeBy={nodeBy} />
            ) : (
              <div className="map-film" aria-label="Steps of the route">
                {route.steps.map((s, i) => (
                  <span key={i} className="step">
                    {i ? <Icon name="chevron-right" size={13} style={{ color: 'var(--text-4)' }} /> : null}
                    <span className="n">{i + 1}</span>
                    <span>{s.text}</span>
                    <span className="faint">on {nodeBy.get(s.screen)?.name ?? 'an unmapped screen'}</span>
                  </span>
                ))}
              </div>
            )
          ) : (
            <SetupRail steps={model.setup} onLearn={learn} />
          )}
        </div>
      </div>
      <aside className="inspector" aria-label="Inspector">
        {route ? (
          <RouteInspector route={route} base={base} split={splits[route.id] ?? null} comparing={!!split} onCompare={() => setCompare((c) => !c)} onExit={() => selectRoute(null)} nodeBy={nodeBy} offers={offers} productId={model.product.id} />
        ) : screen ? (
          <ScreenInspector node={screen} base={base} routes={model.routes.filter((r) => r.screens.includes(screen.id))} onRoute={selectRoute} onExit={() => setSel(null)} />
        ) : (
          <DefaultInspector model={model} base={base} onRoute={selectRoute} onLearn={learn} />
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ canvas */

type Box = { x: number; y: number; w: number; h: number };

function Canvas({
  model,
  layers,
  route,
  screen,
  split,
  nodeBy,
  linkBy,
  onSelect,
  onCompare,
}: {
  model: Model;
  layers: Layers;
  route: Route | null;
  screen: MapNode | null;
  split: Split | null;
  nodeBy: Map<string, MapNode>;
  linkBy: Map<string, MapLink>;
  onSelect: (s: Sel) => void;
  onCompare: (c: boolean) => void;
}) {
  const W = model.nodeW;
  const H = model.nodeH;
  const ref = useRef<HTMLDivElement>(null);
  const ghost = split && split.docsOnly.unseen.length && split.splitAt ? nodeBy.get(split.splitAt) ?? null : null;
  const bounds = useMemo<Box>(() => {
    const top = ghost ? Math.min(0, ghost.y - 60) : 0;
    return { x: -12, y: top - 12, w: model.width + 24, h: model.height - top + 24 };
  }, [model.width, model.height, ghost]);
  const [vb, setVb] = useState<Box>(bounds);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; vb: Box } | null>(null);

  const fit = useCallback(() => setVb(bounds), [bounds]);
  useEffect(() => fit(), [fit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest('[role=dialog]'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f') fit();
      if (e.key === '=' || e.key === '+') zoom(0.8);
      if (e.key === '-') zoom(1.25);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const zoom = (factor: number, cx?: number, cy?: number) =>
    setVb((v) => {
      const w = Math.min(Math.max(v.w * factor, 120), bounds.w * 4);
      const h = (v.h * w) / v.w;
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });

  /* Screen pixels to map units, for the pointer. */
  const toMap = (clientX: number, clientY: number) => {
    const el = ref.current!.getBoundingClientRect();
    const s = Math.max(vb.w / el.width, vb.h / el.height);
    const ox = (el.width * s - vb.w) / 2;
    const oy = (el.height * s - vb.h) / 2;
    return { x: vb.x - ox + (clientX - el.left) * s, y: vb.y - oy + (clientY - el.top) * s, s };
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const p = toMap(e.clientX, e.clientY);
      zoom(Math.exp(e.deltaY * 0.01), p.x, p.y);
    } else {
      const { s } = toMap(e.clientX, e.clientY);
      setVb((v) => ({ ...v, x: v.x + e.deltaX * s, y: v.y + e.deltaY * s }));
    }
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-node]')) return;
    drag.current = { x: e.clientX, y: e.clientY, vb };
    setPanning(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { s } = toMap(e.clientX, e.clientY);
    const d = drag.current;
    setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.x) * s, y: d.vb.y - (e.clientY - d.y) * s });
  };
  const onUp = () => {
    drag.current = null;
    setPanning(false);
  };

  const pathScreens = useMemo(() => {
    if (split) return new Set([...split.docsOnly.screens, ...split.withRoute.screens]);
    if (route) return new Set(route.screens);
    return null;
  }, [route, split]);
  const onPath = (a: string, b: string, seq: string[]) => seq.some((x, i) => x === a && seq[i + 1] === b);
  const dFor = (a: string, b: string) => {
    const l = linkBy.get(`${a}>${b}`);
    if (l) return l.d;
    const p = nodeBy.get(a);
    const q = nodeBy.get(b);
    return p && q ? `M${p.x + W / 2} ${p.y + H / 2} L${q.x + W / 2} ${q.y + H / 2}` : '';
  };
  const backtracked = useMemo(() => new Set(model.nodes.filter((n) => n.struggles.some((s) => s.kind === 'backtrack')).map((n) => n.id)), [model.nodes]);
  const zoomPct = Math.round((bounds.w / vb.w) * 100);

  return (
    <div ref={ref} className="mapcanvas" style={{ position: 'absolute', inset: 0 }} data-panning={panning} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <svg className="mapsvg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Map of ${model.nodes.length} screens`}>
        <defs>
          <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#e1e4e9" />
          </pattern>
        </defs>
        <rect x={bounds.x - 4000} y={bounds.y - 4000} width={bounds.w + 8000} height={bounds.h + 8000} fill="url(#dots)" />

        {/* links */}
        {model.links.map((l) => {
          const dim = pathScreens && !(route && onPath(l.from, l.to, route.screens)) && !(split && (onPath(l.from, l.to, split.docsOnly.screens) || onPath(l.from, l.to, split.withRoute.screens)));
          const exploredOnly = l.explored && !l.used;
          let stroke = '#cbd2da';
          let width = 1.2;
          let dash: string | undefined;
          if (layers.traffic && l.used) {
            stroke = '#b6bdc7';
            width = 1 + Math.min(l.people, 16) / 4;
          }
          if (exploredOnly) {
            dash = '4 3';
            stroke = layers.explored ? '#c4b5fd' : '#cbd2da';
          }
          if (l.back && layers.struggles && backtracked.has(l.from)) stroke = '#fca5a5';
          return (
            <g key={`${l.from}>${l.to}`} style={{ opacity: dim ? 0.22 : 1 }}>
              <path d={l.d} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" />
            </g>
          );
        })}

        {/* routes as transit lines, when nothing is focused */}
        {layers.routes && !route
          ? model.routes
              .filter((r) => DRAWN.has(r.status))
              .map((r, i, all) => {
                const off = (i - (all.length - 1) / 2) * 2.4;
                return (
                  <g key={r.id} transform={`translate(${off} ${off})`} style={{ cursor: 'pointer' }} onClick={() => onSelect({ kind: 'route', id: r.id })}>
                    {r.screens.slice(0, -1).map((a, j) => (
                      <path key={j} d={dFor(a, r.screens[j + 1])} fill="none" stroke={STATUS_COLOR[r.status]} strokeWidth={1.7} strokeDasharray={r.status === 'held' ? '5 3' : undefined} opacity={0.85}>
                        <title>{`${r.name} (${r.status})`}</title>
                      </path>
                    ))}
                  </g>
                );
              })
          : null}

        {/* a focused route, or the two paths of a comparison */}
        {split ? (
          <>
            {split.docsOnly.screens.slice(0, -1).map((a, j) => (
              <path key={`d${j}`} d={dFor(a, split.docsOnly.screens[j + 1])} fill="none" stroke="#0d9488" strokeWidth={3} transform="translate(-2 -2)" />
            ))}
            {split.withRoute.screens.slice(0, -1).map((a, j) => (
              <path key={`w${j}`} d={dFor(a, split.withRoute.screens[j + 1])} fill="none" stroke="#d97706" strokeWidth={3} strokeDasharray="6 4" transform="translate(2 2)" />
            ))}
          </>
        ) : route ? (
          route.screens.slice(0, -1).map((a, j) => <path key={j} d={dFor(a, route.screens[j + 1])} fill="none" stroke={ACCENT} strokeWidth={3.2} strokeLinejoin="round" />)
        ) : null}

        {/* counts on the lines, above the route lines so they stay readable */}
        {layers.traffic
          ? model.links
              .filter((l) => l.people && !(pathScreens && !(route && onPath(l.from, l.to, route.screens))))
              .map((l) => (
                <g key={`n${l.from}>${l.to}`}>
                  <rect x={l.label.x - 10} y={l.label.y - 8} width={20} height={15} rx={4} fill="#fff" stroke="#e5e7eb" />
                  <text x={l.label.x} y={l.label.y + 3.5} textAnchor="middle" fontSize="10.5" fill="#6b7280" fontFamily="var(--mono)">
                    {l.people}
                  </text>
                </g>
              ))
          : null}

        {/* stations */}
        {model.nodes.map((n) => (
          <Station
            key={n.id}
            n={n}
            W={W}
            H={H}
            layers={layers}
            selected={screen?.id === n.id}
            dim={!!pathScreens && !pathScreens.has(n.id)}
            onClick={() => onSelect({ kind: 'screen', id: n.id })}
          />
        ))}

        {/* step numbers on a focused route */}
        {route && !split
          ? (() => {
              const seen = new Map<string, number>();
              return route.steps.map((s, i) => {
                const n = nodeBy.get(s.screen);
                if (!n) return null;
                const k = seen.get(s.screen) ?? 0;
                seen.set(s.screen, k + 1);
                return (
                  <g key={i}>
                    <circle cx={n.x + k * 21} cy={n.y} r={9} fill={ACCENT} stroke="#fff" strokeWidth={1.5} />
                    <text x={n.x + k * 21} y={n.y + 3.8} textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff">
                      {i + 1}
                    </text>
                  </g>
                );
              });
            })()
          : null}

        {/* where the two plans part, and a step only the docs know */}
        {split && split.splitAt
          ? (() => {
              const n = nodeBy.get(split.splitAt);
              if (!n) return null;
              return (
                <g>
                  <rect x={n.x + W / 2 - 52} y={n.y + H + 5} width={104} height={18} rx={4} fill="#fffbeb" stroke="#fde68a" />
                  <text x={n.x + W / 2} y={n.y + H + 17.5} textAnchor="middle" fontSize="11" fill="#92400e">
                    paths split here
                  </text>
                  <circle cx={n.x + W} cy={n.y + H / 2} r={7} fill="#fff" stroke="#d97706" strokeWidth={1.5} />
                  <text x={n.x + W} y={n.y + H / 2 + 3.8} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#92400e">
                    !
                  </text>
                </g>
              );
            })()
          : null}
        {ghost && split ? (
          <g>
            <path d={`M${ghost.x + W / 2} ${ghost.y} V${ghost.y - 18}`} stroke="#0d9488" strokeWidth={2} strokeDasharray="3 3" />
            <rect x={ghost.x + W / 2 - 78} y={ghost.y - 56} width={156} height={38} rx={7} fill="#f0fdfa" stroke="#2dd4bf" strokeDasharray="4 3" />
            <text x={ghost.x + W / 2 - 68} y={ghost.y - 40} fontSize="11" fontWeight="600" fill="#115e59">
              {clip(split.docsOnly.unseen[0], 24)}
            </text>
            <text x={ghost.x + W / 2 - 68} y={ghost.y - 26} fontSize="10.5" fill="#0f766e">
              in the docs, never used
            </text>
          </g>
        ) : null}
      </svg>
      {!route ? (
        <div className="map-over map-zoom">
          <button onClick={() => zoom(1.25)} aria-label="Zoom out">
            <Icon name="minus" size={13} />
          </button>
          <span className="z">{zoomPct}%</span>
          <button onClick={() => zoom(0.8)} aria-label="Zoom in">
            <Icon name="plus" size={13} />
          </button>
          <button onClick={fit} aria-label="Fit the map" title="Fit (F)" style={{ borderLeft: '1px solid var(--line)' }}>
            <Icon name="maximize" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Station({ n, W, H, layers, selected, dim, onClick }: { n: MapNode; W: number; H: number; layers: Layers; selected: boolean; dim: boolean; onClick: () => void }) {
  const dashed = layers.explored && n.exploredOnly;
  const struggling = layers.struggles && n.signals > 0;
  const stroke = selected ? ACCENT : struggling ? '#fca5a5' : dashed ? '#c4b5fd' : '#d5dae1';
  let footer: React.ReactNode;
  if (layers.docs) footer = <Tag x={9} y={H - 18} text={n.docs.length ? 'in docs' : 'not in docs'} tone={n.docs.length ? 'docs' : 'none'} />;
  else if (layers.explored && n.exploredOnly) footer = <Tag x={9} y={H - 18} text="only explored" tone="explored" />;
  else
    footer = (
      <text x={9} y={H - 8} fontSize="10.5" fill="#6b7280" fontFamily="var(--mono)">
        {n.people ? `${n.people} ${n.people === 1 ? 'person' : 'people'}` : `seen ${n.seen}x`}
      </text>
    );
  return (
    <g data-node={n.id} transform={`translate(${n.x} ${n.y})`} style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1 }} onClick={onClick}>
      <title>{`${n.name}\n${n.path}`}</title>
      <rect width={W} height={H} rx={8} fill={selected ? '#f5f7ff' : '#fff'} stroke={stroke} strokeWidth={selected ? 2 : 1} strokeDasharray={dashed && !selected ? '4 3' : undefined} />
      <text x={9} y={16} fontSize="11.5" fontWeight="600" fill="#111827">
        {clip(n.name, 18)}
      </text>
      <Wire kind={n.thumb} />
      {footer}
      {struggling ? (
        <g>
          <circle cx={W - 3} cy={3} r={9} fill="#fef2f2" stroke="#dc2626" />
          <text x={W - 3} y={6.8} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#991b1b">
            {n.signals}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function Tag({ x, y, text, tone }: { x: number; y: number; text: string; tone: 'docs' | 'explored' | 'none' }) {
  const c = { docs: ['#f0fdfa', '#99f6e4', '#115e59'], explored: ['#f5f3ff', '#ddd6fe', '#5b21b6'], none: ['#f3f4f6', '#e5e7eb', '#4b5563'] }[tone];
  const w = text.length * 5.6 + 14;
  return (
    <g>
      <rect x={x} y={y} width={w} height={14} rx={7} fill={c[0]} stroke={c[1]} />
      <text x={x + 7} y={y + 10.2} fontSize="10" fill={c[2]}>
        {text}
      </text>
    </g>
  );
}

/* The screen's drawing, from the kinds of controls it has (lib/console/thumbs.ts). */
function Wire({ kind }: { kind: string }) {
  const L = '#eceef2';
  const D = '#dde1e7';
  const A = '#c7d2fe';
  const r = (x: number, y: number, w: number, h: number, f: string, rx = 1, st?: string) => <rect key={`${x},${y},${w}`} x={x} y={y} width={w} height={h} rx={rx} fill={f} stroke={st} />;
  const out: React.ReactNode[] = [];
  if (kind === 'grid') for (let i = 0; i < 3; i++) { out.push(r(9, 25 + i * 8, 30, 3, L)); for (let c = 0; c < 4; c++) out.push(r(50 + c * 15, 23 + i * 8, 8, 6, D, 1.5)); }
  else if (kind === 'list') for (let i = 0; i < 4; i++) { out.push(r(9, 23 + i * 6.5, 4, 4, D)); out.push(r(16, 23.5 + i * 6.5, 74 - i * 11, 3, L)); }
  else if (kind === 'table') for (let i = 0; i < 3; i++) { out.push(<circle key={`c${i}`} cx={13} cy={26 + i * 8} r={2.5} fill={D} />); out.push(r(19, 24.5 + i * 8, 56, 3, L)); out.push(r(84, 22.5 + i * 8, 26, 6, '#f8f9fb', 2, '#e3e6eb')); }
  else if (kind === 'toggles') for (let i = 0; i < 3; i++) { out.push(r(9, 24.5 + i * 8, 64, 3, L)); out.push(r(92, 22.5 + i * 8, 17, 7, i === 2 ? D : A, 3.5)); }
  else if (kind === 'form') for (let i = 0; i < 2; i++) { out.push(r(9, 22 + i * 13, 30, 3, D)); out.push(r(9, 27 + i * 13, 96, 6, '#fff', 2, '#e3e6eb')); }
  else if (kind === 'menu') { out.push(r(9, 22, 28, 6, A, 2)); out.push(r(9, 30, 62, 21, '#fff', 3, '#dfe3e8')); for (let i = 0; i < 3; i++) out.push(r(14, 34 + i * 5.5, 44 - i * 8, 2.5, L)); }
  else if (kind === 'dialog') { out.push(r(20, 21, 80, 30, '#fff', 3, '#cfd5dc')); out.push(r(26, 26, 40, 3, D)); out.push(r(26, 32, 60, 3, L)); out.push(r(66, 41, 15, 5, A, 2)); out.push(r(84, 41, 11, 5, L, 2)); }
  else { out.push(r(9, 23, 70, 4, D)); out.push(r(9, 30, 94, 3, L)); out.push(r(9, 36, 66, 3, L)); out.push(r(9, 42, 30, 6, A, 2)); }
  return <g>{out}</g>;
}

/* ------------------------------------------------------------------ strips */

function SplitStrip({ split, nodeBy }: { split: Split; nodeBy: Map<string, MapNode> }) {
  const names = (ids: string[]) => ids.map((id) => nodeBy.get(id)?.name ?? id).join(' › ');
  return (
    <div className="map-film" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 16, height: 3, background: '#0d9488', display: 'inline-block' }} />
          Docs only: <b style={{ fontWeight: 600 }}>{split.docsOnly.outcome}</b>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 16, borderTop: '3px dashed #d97706', display: 'inline-block' }} />
          With this route: <b style={{ fontWeight: 600 }}>{split.withRoute.outcome}</b>
        </span>
        <span className="pill" data-s={split.change === 'regressed' ? 'regressed' : split.change === 'improved' ? 'improved' : split.change === 'inconclusive' ? 'inconclusive' : undefined} style={{ marginLeft: 'auto' }}>
          {split.change === 'regressed' ? 'worse with the route' : split.change === 'improved' ? 'better with the route' : split.change === 'inconclusive' ? 'no answer' : 'no change'}
        </span>
      </div>
      <div className="muted">
        <span className="mono">{split.scenario}</span>: &ldquo;{split.goal}&rdquo;.{' '}
        {split.splitAt ? (
          <>
            Docs only went {names(split.docsOnly.screens)}
            {split.docsOnly.unseen.length ? `, then used ${split.docsOnly.unseen.slice(0, 2).map((u) => `"${u}"`).join(' and ')}, which nobody has used in real sessions` : ''}. With the route it went {names(split.withRoute.screens)}.
          </>
        ) : (
          <>Both plans went through the same screens ({names(split.withRoute.screens)}); they differ in what they said: docs only {split.docsOnly.outcome}, with the route {split.withRoute.outcome}.</>
        )}
        {split.withRoute.problems.length ? ` Check: ${split.withRoute.problems[0]}` : ''}
      </div>
    </div>
  );
}

function SetupRail({ steps, onLearn }: { steps: Model['setup']; onLearn: () => void }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  return (
    <div className="map-rail">
      <b style={{ fontWeight: 600 }}>
        Setup {done} of {steps.length}
      </b>
      {steps.map((s) => (
        <span key={s.key} className="railstep" data-state={s.done ? 'done' : s === next ? 'next' : undefined} title={s.detail}>
          <Icon name={s.done ? 'check' : 'circle'} size={11} />
          {s.title}
        </span>
      ))}
      <span className="grow" />
      <span className="muted ellipsis" style={{ maxWidth: 280 }}>
        {next.detail}
      </span>
      {next.cta === 'Run learning' ? (
        <button className="btn btn-sm btn-primary" onClick={onLearn}>
          Run learning, free
        </button>
      ) : next.cta && next.href ? (
        <Link className="btn btn-sm btn-primary" href={next.href}>
          {next.cta}
        </Link>
      ) : null}
    </div>
  );
}

function EmptyMap({ base, origin }: { base: string; origin: string }) {
  const host = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  })();
  const ways = [
    { icon: 'compass', title: 'Explore it safely', text: 'Opens links in a hidden frame. Never clicks, types or submits, and refuses links that could change something.', href: `${base}/sources?tab=exploration`, cta: 'How to start' },
    { icon: 'monitor', title: 'Learn from real use', text: 'Enroll a vendor browser, then use the product normally. Labels are redacted before anything leaves it.', href: `${base}/sources?tab=browsers`, cta: 'Enroll a browser' },
    { icon: 'book', title: 'Read the docs', text: 'What the product can and cannot do, from its help site. Used to plan, never to draw the map.', href: `${base}/sources?tab=docs`, cta: 'Ingest docs' },
  ];
  return (
    <div className="empty-map">
      <div style={{ maxWidth: 720, width: '100%' }}>
        <div className="row" style={{ gap: 10 }}>
          <Icon name="map" size={18} />
          <h1>
            Map <span className="mono" style={{ fontSize: 15 }}>{host}</span>
          </h1>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          No screens yet. Pick any of these; each one adds to the same map.
        </p>
        <div className="ways">
          {ways.map((w) => (
            <Link key={w.title} href={w.href} className="way">
              <Icon name={w.icon} size={17} style={{ color: 'var(--accent)' }} />
              <b style={{ fontWeight: 600 }}>{w.title}</b>
              <span className="muted" style={{ fontSize: 12 }}>
                {w.text}
              </span>
              <span style={{ color: 'var(--accent-text)', fontSize: 12, marginTop: 'auto' }}>{w.cta} ›</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ inspector */

function DefaultInspector({ model, base, onRoute, onLearn }: { model: Model; base: string; onRoute: (id: string) => void; onLearn: () => void }) {
  const listed = model.routes.filter((r) => r.status !== 'blocked');
  const blocked = model.routes.length - listed.length;
  const withStruggles = model.nodes.filter((n) => n.signals > 0).length;
  const notInDocs = model.nodes.filter((n) => !n.docs.length).length;
  return (
    <>
      {model.attention.length ? (
        <div className="insp-sec">
          <div className="insp-h">Needs attention</div>
          <div className="col" style={{ gap: 6 }}>
            {model.attention.map((a) => (
              <div key={a.text} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="dot" data-s={a.tone === 'bad' ? 'rejected' : a.tone === 'warn' ? 'held' : 'candidate'} style={{ marginTop: 5 }} />
                <span className="grow">{a.text}</span>
                {a.cta === 'Run learning' ? (
                  <button className="btn btn-sm" onClick={onLearn}>
                    Run
                  </button>
                ) : (
                  <Link className="btn btn-sm" href={a.href}>
                    {a.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="insp-sec">
        <div className="insp-h">
          Routes <span className="mono faint">{listed.length}</span>
          <span className="grow" />
          <span className="faint" style={{ fontSize: 11 }}>
            <span className="kbd">J</span> <span className="kbd">K</span>
          </span>
        </div>
        {listed.length ? (
          listed.map((r) => (
            <div key={r.id} className="insp-item" onClick={() => onRoute(r.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onRoute(r.id)}>
              <span className="dot" data-s={r.status} />
              <span className="grow ellipsis">{r.name}</span>
              <span className="mono faint" title="people">
                {r.people}
              </span>
            </div>
          ))
        ) : (
          <p className="muted">None yet. Routes come from people using the product.</p>
        )}
        {blocked ? <p className="faint" style={{ marginTop: 6, fontSize: 11.5 }}>{blocked} more seen once so far; a route needs two people.</p> : null}
      </div>
      <div className="insp-sec">
        <div className="insp-h">Screens</div>
        <div className="kv">
          <span>Mapped</span>
          <span>{model.nodes.length}</span>
          <span>With struggles</span>
          <span>{withStruggles}</span>
          <span>Only explored</span>
          <span>{model.counts.exploredOnly}</span>
          <span>Not in the docs</span>
          <span>{notInDocs}</span>
        </div>
      </div>
      <div className="insp-sec faint" style={{ fontSize: 11.5 }}>
        Click a screen or a route. <span className="kbd">Esc</span> clears, <span className="kbd">1</span>-<span className="kbd">5</span> toggle layers, <span className="kbd">F</span> fits.
        <div style={{ marginTop: 6 }}>
          <Link href={`${base}/table`} style={{ color: 'var(--accent-text)' }}>
            Same data as tables ›
          </Link>
        </div>
      </div>
    </>
  );
}

function ScreenInspector({ node, base, routes, onRoute, onExit }: { node: MapNode; base: string; routes: Route[]; onRoute: (id: string) => void; onExit: () => void }) {
  return (
    <>
      <div className="insp-sec">
        <div className="row">
          <h2 className="grow ellipsis">{node.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onExit} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="mono faint" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
          {node.path}
        </div>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 5 }}>
          <span className="pill" data-s={node.docs.length ? 'docs' : undefined}>
            {node.docs.length ? 'mentioned in the docs' : 'not in the docs'}
          </span>
          {node.exploredOnly ? (
            <span className="pill" data-s="explored">
              only explored
            </span>
          ) : null}
          <span className="pill">{node.thumb}</span>
        </div>
        <div className="kv" style={{ marginTop: 10 }}>
          <span>People here</span>
          <span>{node.people}</span>
          <span>Times seen</span>
          <span>{node.seen}</span>
          <span>Controls</span>
          <span>{node.controls}</span>
        </div>
      </div>
      <div className="insp-sec">
        <div className="insp-h">Struggles here</div>
        {node.struggles.length ? (
          node.struggles.map((s) => (
            <Link key={s.id} className="insp-item" href={`${base}/struggles?id=${s.id}`}>
              <Icon name="alert" size={13} style={{ color: 'var(--bad)' }} />
              <span className="grow">{s.title}</span>
            </Link>
          ))
        ) : (
          <p className="muted">None seen.</p>
        )}
      </div>
      <div className="insp-sec">
        <div className="insp-h">Routes through here</div>
        {routes.length ? (
          routes.map((r) => (
            <div key={r.id} className="insp-item" onClick={() => onRoute(r.id)}>
              <span className="dot" data-s={r.status} />
              <span className="grow ellipsis">{r.name}</span>
            </div>
          ))
        ) : (
          <p className="muted">None.</p>
        )}
      </div>
      <div className="insp-sec">
        <div className="insp-h">In the docs</div>
        {node.docs.length ? (
          node.docs.map((d) => (
            <div key={`${d.doc}#${d.heading}`} className="row" style={{ padding: '2px 0' }}>
              <Icon name="book" size={13} style={{ color: 'var(--docs)' }} />
              <span className="mono ellipsis" style={{ fontSize: 11.5 }}>
                {d.doc} › {d.heading}
              </span>
            </div>
          ))
        ) : (
          <p className="muted">
            No docs section names this screen.{' '}
            <Link href={`${base}/struggles?note=${node.id}`} style={{ color: 'var(--accent-text)' }}>
              Note a docs gap
            </Link>
          </p>
        )}
      </div>
    </>
  );
}

function RouteInspector({
  route,
  base,
  split,
  comparing,
  onCompare,
  onExit,
  nodeBy,
  offers,
  productId,
}: {
  route: Route;
  base: string;
  split: Split | null;
  comparing: boolean;
  onCompare: () => void;
  onExit: () => void;
  nodeBy: Map<string, MapNode>;
  offers: { verify: Offer; compare: Offer };
  productId: string;
}) {
  const copy = () => {
    navigator.clipboard?.writeText(route.id).then(
      () => toast('Route id copied'),
      () => toast('Could not copy', 'bad')
    );
  };
  return (
    <>
      <div className="insp-sec">
        <div className="row">
          <button className="mono faint btn btn-ghost btn-sm" style={{ padding: 0, height: 18 }} onClick={copy} title="Copy the route id">
            {route.id} <Icon name="copy" size={11} />
          </button>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={onExit} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <h2 style={{ marginTop: 4 }}>{route.name}</h2>
        {route.label && route.label !== route.name ? <p className="muted" style={{ marginTop: 3 }}>&ldquo;{route.label}&rdquo;</p> : null}
        <div className="row" style={{ marginTop: 8 }}>
          <span className="pill" data-s={route.status}>
            {route.status}
          </span>
          <span className="muted">
            {route.people} {route.people === 1 ? 'person' : 'people'} &middot; {route.steps.length} steps &middot; {route.kind === 'effect' ? 'changes something' : 'only looks'}
          </span>
        </div>
        {route.status === 'held' ? (
          <div className="note" data-tone="warn" style={{ marginTop: 10 }}>
            Not offered to the planner until a comparison that includes it shows it does no harm.
          </div>
        ) : route.reason ? (
          <div className="note" style={{ marginTop: 10 }}>
            {route.reason}
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
          {split ? (
            <button className={`btn btn-sm ${comparing ? 'btn-on' : ''}`} onClick={onCompare} title="Compare (C)">
              <Icon name="compare" size={13} />
              {comparing ? 'Comparing' : 'Compare'}
            </button>
          ) : null}
          {route.status === 'candidate' ? (
            <PaidAction
              productId={productId}
              offer={offers.verify}
              size="sm"
              title="Verify routes"
              explain="Each route waiting is named by the model, then planned from its first screen with only that name. It passes only if the plan is exactly the route. Every route waiting is checked, not only this one."
            />
          ) : null}
          {route.status === 'held' ? (
            <PaidAction
              productId={productId}
              offer={offers.compare}
              size="sm"
              variant="default"
              label="Queue comparison"
              held={1}
              title="Compare with and without learned routes"
              explain="Every eval scenario is planned twice, with learned routes offered and without. A held route is released only by a clean comparison in which it was offered."
            />
          ) : null}
          {route.compareFile ? (
            <Link className="btn btn-sm btn-ghost" href={`${base}/evaluations?file=${encodeURIComponent(route.compareFile)}`}>
              Evaluation <Icon name="external" size={12} />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="insp-sec">
        <div className="insp-h">Steps</div>
        <ol className="steps-list">
          {route.steps.map((s, i) => (
            <li key={i}>
              <span className="n">{i + 1}</span>
              <span>
                {s.text} <span className="faint">on {nodeBy.get(s.screen)?.name ?? '?'}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="insp-sec">
        <div className="insp-h">History</div>
        <div className="hist">
          {route.history.map((h, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <span className="t">{h.when}</span>
              <span>
                {h.text}
                {h.detail ? <span className="faint" style={{ display: 'block', fontSize: 11.5 }}>{h.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="insp-sec faint" style={{ fontSize: 11.5 }}>
        <span className="kbd">Esc</span> exits, <span className="kbd">J</span> <span className="kbd">K</span> next route{split ? <>, <span className="kbd">C</span> compares</> : null}.
      </div>
    </>
  );
}
