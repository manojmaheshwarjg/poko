'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, Logo } from './icons';

type Badges = { struggles: number; queued: number; running: number; routes: number; screens: number; setupDone: number; setupTotal: number };

const KEY = 'sekva:sidebar-collapsed';

export function Sidebar({ base, badges }: { base: string; badges: Badges }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  /* A per-person convenience, so browser storage; it may be unavailable. */
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === '1');
    } catch {}
  }, []);
  const set = (value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch {}
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((c) => {
          try {
            localStorage.setItem(KEY, c ? '0' : '1');
          } catch {}
          return !c;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const item = (href: string, icon: string, label: string, badge?: string | number | null) => {
    const current = pathname === href.split('?')[0];
    return (
      <Link className="navlink" href={href} aria-current={current ? 'page' : undefined} title={collapsed ? label : undefined}>
        <Icon name={icon} />
        <span className="hide-collapsed">{label}</span>
        {badge ? <span className="badge hide-collapsed">{badge}</span> : null}
      </Link>
    );
  };
  const runs = badges.running ? `${badges.running} running` : badges.queued ? `${badges.queued} queued` : null;

  return (
    <aside className="sidebar" data-collapsed={collapsed}>
      <div className="sidebar-top">
        <Logo />
        <span className="wordmark hide-collapsed">sekva</span>
        <button
          className="btn btn-ghost btn-sm hide-collapsed"
          style={{ marginLeft: 'auto', padding: '0 5px' }}
          onClick={() => set(true)}
          aria-label="Collapse the sidebar"
          title="Collapse (⌘B)"
        >
          <Icon name="sidebar" size={14} />
        </button>
      </div>
      <nav aria-label="Console">
        {item(`${base}/map`, 'map', 'Map', badges.screens || null)}
        {item(`${base}/table`, 'table', 'Table', badges.routes ? `${badges.routes} routes` : null)}
        <div className="navgroup">Learning</div>
        {item(`${base}/struggles`, 'alert', 'Struggles', badges.struggles || null)}
        {item(`${base}/evaluations`, 'compare', 'Evaluations')}
        {item(`${base}/runs`, 'clock', 'Runs', runs)}
        <div className="navgroup">Onboarding</div>
        {item(`${base}/sources`, 'database', 'Sources')}
        {item(`${base}/setup`, 'checklist', 'Setup', `${badges.setupDone}/${badges.setupTotal}`)}
      </nav>
      <div className="sidebar-foot">
        {collapsed ? (
          <button className="navlink" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => set(false)} aria-label="Expand the sidebar" title="Expand (⌘B)">
            <Icon name="sidebar" />
          </button>
        ) : null}
        {item('/products', 'grid', 'All products')}
      </div>
    </aside>
  );
}
