'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { runLearning } from './actions';

type Product = { id: string; origin: string; tool: string; screens: number };
type Item = { kind: 'page' | 'screen' | 'route' | 'action'; label: string; hint: string; href?: string; action?: string; status?: string };
type Budget = { usedToday: number; limit: number; left: number; minuteLimit: number; reservedToday: number };

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

function host(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function TopBar({ products, product, budget, palette }: { products: Product[]; product: Product; budget: Budget; palette: Item[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/p/${product.id}`;
  const onMapOrTable = pathname === `${base}/map` || pathname === `${base}/table`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const share = budget.limit ? budget.usedToday / budget.limit : 0;
  return (
    <header className="topbar">
      <ProductSwitcher products={products} product={product} pathname={pathname} />
      {onMapOrTable ? (
        <div className="seg" role="group" aria-label="View">
          <Link href={`${base}/map`} aria-current={pathname === `${base}/map` ? 'page' : undefined}>
            Map
          </Link>
          <Link href={`${base}/table`} aria-current={pathname === `${base}/table` ? 'page' : undefined}>
            Table
          </Link>
        </div>
      ) : null}
      <button className="searchbox" onClick={() => setOpen(true)} aria-label="Search or run a command">
        <Icon name="search" size={14} />
        <span>Find a screen or route, or run a command</span>
        <span className="kbd" style={{ marginLeft: 'auto' }}>
          ⌘K
        </span>
      </button>
      <div className="topbar-right">
        <LivePulse productId={product.id} />
        <Link
          href={`${base}/runs`}
          className="tokens"
          title={`Tokens recorded since midnight: ${budget.usedToday.toLocaleString()} of the provider's ${budget.limit.toLocaleString()} a day. ${budget.minuteLimit.toLocaleString()} a minute.`}
        >
          <span className="meter" data-tone={share > 0.85 ? 'bad' : share > 0.6 ? 'warn' : undefined}>
            <i style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
          </span>
          {k(budget.usedToday)}/{k(budget.limit)}
        </Link>
      </div>
      {open ? <CommandPalette items={palette} origin={product.origin} onClose={() => setOpen(false)} /> : null}
    </header>
  );
}

function ProductSwitcher({ products, product, pathname }: { products: Product[]; product: Product; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  /* The same page on another product. */
  const rest = pathname.replace(/^\/p\/[^/]+/, '');
  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {host(product.origin)}
        <Icon name="chevron-down" size={13} />
      </button>
      {open ? (
        <div className="menu" role="menu">
          {products.map((p) => (
            <Link key={p.id} role="menuitem" href={`/p/${p.id}${rest || '/map'}`} onClick={() => setOpen(false)} aria-selected={p.id === product.id}>
              <span className="mono grow ellipsis">{host(p.origin)}</span>
              <span className="faint mono">{p.screens} screens</span>
            </Link>
          ))}
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <Link role="menuitem" href="/products#add" onClick={() => setOpen(false)}>
            <Icon name="plus" size={14} />
            Add a product
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/* Polls a version stamp of everything the console shows and refreshes the page in
   place when it changes, so learning, runs and exploration appear without a reload. */
function LivePulse({ productId }: { productId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'live' | 'off'>('live');
  const last = useRef<string | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/pulse?pid=${encodeURIComponent(productId)}`, { cache: 'no-store' });
        const { v } = await res.json();
        if (stop) return;
        setState('live');
        if (last.current !== null && last.current !== v) router.refresh();
        last.current = v;
      } catch {
        if (!stop) setState('off');
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [productId, router]);
  return (
    <span className="row" style={{ gap: 6 }} title={state === 'live' ? 'Updates as data arrives' : 'Not reaching the service'}>
      <span className="dot" data-s={state} />
      {state === 'live' ? 'live' : 'offline'}
    </span>
  );
}

/* Subsequence match, with a bonus for a word start: "edp" finds "Edit permissions". */
function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  let i = 0;
  let s = 0;
  let prev = -2;
  for (const ch of q.toLowerCase()) {
    const at = t.indexOf(ch, i);
    if (at < 0) return 0;
    s += at === prev + 1 ? 3 : 1;
    if (at === 0 || t[at - 1] === ' ') s += 2;
    prev = at;
    i = at + 1;
  }
  return s;
}

const GROUPS: Record<Item['kind'], string> = { page: 'Go to', action: 'Run', screen: 'Screens', route: 'Routes' };

function CommandPalette({ items, origin, onClose }: { items: Item[]; origin: string; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useMemo(() => {
    const scored = items.map((it) => ({ it, s: Math.max(score(q, it.label), score(q, it.hint) * 0.5) })).filter((x) => x.s > 0);
    if (q) scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.it).slice(0, 40);
  }, [items, q]);
  const run = useCallback(
    async (it: Item) => {
      onClose();
      if (it.action === 'learn') {
        if (await runLearning(origin)) router.refresh();
        return;
      }
      if (it.href) router.push(it.href);
    },
    [onClose, origin, router]
  );
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(list.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && list[sel]) run(list[sel]);
  };
  let lastKind: string | null = null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command bar" onKeyDown={onKey}>
        <div className="palette-in">
          <Icon name="search" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Find a screen or route, or run a command"
            aria-label="Search"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" role="listbox">
          {list.length ? null : <div className="empty">Nothing matches.</div>}
          {list.map((it, i) => {
            const head = !q && it.kind !== lastKind ? GROUPS[it.kind] : null;
            lastKind = it.kind;
            return (
              <div key={`${it.kind}:${it.label}:${it.hint}`}>
                {head ? <div className="palette-group">{head}</div> : null}
                <div className="palette-item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
                  {it.kind === 'route' ? <span className="dot" data-s={it.status} /> : <Icon name={it.kind === 'screen' ? 'grid' : it.kind === 'action' ? 'bolt' : 'arrow'} size={14} />}
                  <span className="ellipsis">{it.label}</span>
                  <span className="hint ellipsis mono">{it.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> move
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span>Paid actions open their cost first</span>
        </div>
      </div>
    </div>
  );
}
