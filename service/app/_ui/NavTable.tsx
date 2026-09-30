'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/* A dense table whose rows open something: click a row, or move with J and K and open
   with Enter. Rows opt in with data-href. */
export function NavTable({ children, label }: { children: React.ReactNode; label: string }) {
  const router = useRouter();
  const ref = useRef<HTMLTableElement>(null);
  const [sel, setSel] = useState(-1);

  const rows = () => Array.from(ref.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-href]') ?? []);
  useEffect(() => {
    rows().forEach((r, i) => r.setAttribute('aria-selected', String(i === sel)));
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.closest('[role=dialog]'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const list = rows();
      if (!list.length) return;
      if (e.key === 'j') setSel((s) => Math.min(list.length - 1, s + 1));
      else if (e.key === 'k') setSel((s) => Math.max(0, s - 1));
      else if (e.key === 'Enter' && sel >= 0 && list[sel]) router.push(list[sel].dataset.href!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, sel]);
  useEffect(() => {
    rows()[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <table
      ref={ref}
      className="tbl"
      aria-label={label}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button')) return;
        const tr = (e.target as HTMLElement).closest('tr[data-href]') as HTMLTableRowElement | null;
        if (tr) router.push(tr.dataset.href!);
      }}
    >
      {children}
    </table>
  );
}
