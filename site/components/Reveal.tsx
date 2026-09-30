'use client';

import { useEffect } from 'react';

/* Marks each section as seen the first time it comes into view, so its highlighter
   swipes and pencil marks draw themselves then and not before. */
export function Reveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-zone], .reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('seen');
          io.unobserve(e.target);
        }
      },
      { threshold: 0.18 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
