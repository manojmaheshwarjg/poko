'use client';

import { useEffect } from 'react';
import { goTo } from '@/lib/scroll';

export function focusAfterScroll(id: string) {
  window.setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), 1100);
}

/* E for early access, D for the demo up top, / to ask Poko. Never while typing or with modifiers. */
export function Shortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === 'e') {
        e.preventDefault();
        goTo('join');
        focusAfterScroll('join-email');
      } else if (key === 'd') {
        e.preventDefault();
        goTo('top');
      } else if (e.key === '/') {
        e.preventDefault();
        goTo('faq');
        focusAfterScroll('faq-input');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
