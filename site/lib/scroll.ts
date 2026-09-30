import type Lenis from 'lenis';
import { reducedMotion } from './gsap';

let lenis: Lenis | null = null;

export function setLenis(instance: Lenis | null) {
  lenis = instance;
}

/* Scrolls to a section by id, smoothly when Lenis is running, and briefly marks its
   heading so the eye lands in the right place. */
export function goTo(id: string, { mark = false, offset = -84 }: { mark?: boolean; offset?: number } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset, duration: 1.3 });
  else el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  if (mark) {
    const head = el.querySelector('[data-mark]') ?? el;
    head.classList.remove('marked');
    void (head as HTMLElement).offsetWidth;
    head.classList.add('marked');
    window.setTimeout(() => head.classList.remove('marked'), 2400);
  }
}

export function scrollToY(y: number) {
  if (lenis) lenis.scrollTo(y, { duration: 1.1 });
  else window.scrollTo({ top: y, behavior: reducedMotion() ? 'auto' : 'smooth' });
}
