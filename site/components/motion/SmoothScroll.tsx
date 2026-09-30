'use client';

import Lenis from 'lenis';
import { useEffect } from 'react';
import { motion } from '@/lib/gsap';
import { setLenis } from '@/lib/scroll';

/* Smooth scrolling that ScrollTrigger can follow. Lenis honors reduce-motion itself. */
export function SmoothScroll() {
  useEffect(() => {
    const { gsap, ScrollTrigger } = motion();
    const lenis = new Lenis({ anchors: { offset: -84 }, allowNestedScroll: true, stopInertiaOnNavigate: true });
    setLenis(lenis);
    /* Development only: lets browser checks jump between sections without fighting Lenis,
       and keep animating in a background tab (gsap.ticker.useRAF(false)). */
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __lenis: lenis, __gsap: gsap });
    const off = lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      off();
      gsap.ticker.remove(tick);
      lenis.destroy();
      setLenis(null);
    };
  }, []);
  return null;
}
