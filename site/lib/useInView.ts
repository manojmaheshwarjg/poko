'use client';

import { useEffect, useState, type RefObject } from 'react';

/* True once the element is on screen (or while it is, with once: false). Every section
   uses it to start its own small moment when the visitor actually gets there. */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { threshold = 0.35, once = true, rootMargin = '0px' }: { threshold?: number; once?: boolean; rootMargin?: string } = {},
) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, once, rootMargin]);
  return inView;
}
