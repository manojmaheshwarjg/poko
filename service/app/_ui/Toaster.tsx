'use client';

import { useEffect, useState } from 'react';

/* Results appear where the person is, as a short note, instead of a separate page. */

type Toast = { id: number; text: string; tone?: 'ok' | 'bad' | 'info' };
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'info') {
  window.dispatchEvent(new CustomEvent('sekva:toast', { detail: { id: ++seq, text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'bad' ? 9000 : 5000);
    };
    window.addEventListener('sekva:toast', on);
    return () => window.removeEventListener('sekva:toast', on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
