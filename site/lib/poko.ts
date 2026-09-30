/* Shared state for every Poko on the page: the spots the traveling Poko visits, one
   pointer listener that moves every pair of eyes, the idle nap, and pointing at
   whatever the visitor hovers. Plain module state: none of it needs React renders. */

export type Mood = 'idle' | 'happy' | 'think' | 'peek' | 'sleep' | 'wink' | 'confused' | 'plain';

export type Spot = {
  id: string;
  el: HTMLElement;
  mood: Mood;
  size: number;
  hat: boolean;
  color?: string;
  dive: boolean;
  say?: string;
  /* Which side of Poko the speech bubble sits on. */
  sayAt?: 'right' | 'left';
};

export const POKO_VIOLET = '#6D5DFC';

/* The traveling Poko runs only where it has room and the visitor wants motion. */
export const TRAVEL_QUERY = '(min-width: 1024px) and (prefers-reduced-motion: no-preference) and (pointer: fine)';

const spots = new Map<string, Spot>();

export function registerSpot(spot: Spot) {
  spots.set(spot.id, spot);
  return () => {
    if (spots.get(spot.id) === spot) spots.delete(spot.id);
  };
}

export function updateSpot(id: string, patch: Partial<Omit<Spot, 'id' | 'el'>>) {
  const spot = spots.get(id);
  if (spot) Object.assign(spot, patch);
}

export function allSpots() {
  return [...spots.values()];
}

/* Eyes: one listener, one frame loop, every registered pupil. Offsets are in the
   120-unit viewBox of the character, capped so the pupils stay inside the eyes. */
type Pupil = { el: SVGCircleElement; x: number; y: number };
const pupils = new Set<Pupil>();
let pointer: { x: number; y: number } | null = null;
let loopStarted = false;

function startEyes() {
  if (loopStarted || typeof window === 'undefined') return;
  loopStarted = true;
  const frame = () => {
    if (pointer && pupils.size) {
      const boxes = new Map<SVGSVGElement, DOMRect>();
      for (const p of pupils) {
        const svg = p.el.ownerSVGElement;
        if (!svg) continue;
        let box = boxes.get(svg);
        if (!box) {
          box = svg.getBoundingClientRect();
          boxes.set(svg, box);
        }
        if (!box.width) continue;
        const sx = box.left + (p.x / 120) * box.width;
        const sy = box.top + (p.y / 120) * box.height;
        const dx = pointer.x - sx;
        const dy = pointer.y - sy;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(3, d / 28);
        p.el.setAttribute('cx', (p.x + (dx / d) * k).toFixed(2));
        p.el.setAttribute('cy', (p.y + (dy / d) * k).toFixed(2));
      }
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

export function trackPupil(pupil: Pupil) {
  pupils.add(pupil);
  startEyes();
  listen();
  return () => {
    pupils.delete(pupil);
  };
}

/* Nap: twenty quiet seconds and every Poko dozes off; any movement wakes them. */
const NAP_AFTER = 20000;
let napping = false;
let lastActive = 0;
const napSubs = new Set<() => void>();

function wake() {
  lastActive = Date.now();
  if (napping) {
    napping = false;
    napSubs.forEach((f) => f());
  }
}

export function subscribeNap(fn: () => void) {
  napSubs.add(fn);
  listen();
  return () => {
    napSubs.delete(fn);
  };
}

export function isNapping() {
  return napping;
}

/* Pointing: any element marked data-poko-point pulls the traveling Poko over. */
let pointEl: HTMLElement | null = null;

export function pointTarget() {
  return pointEl && pointEl.isConnected ? pointEl : null;
}

/* A short cheer, for copying the command or finishing something. */
let cheerUntil = 0;

export function cheer(ms = 1400) {
  cheerUntil = Date.now() + ms;
}

export function cheering() {
  return Date.now() < cheerUntil;
}

let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  lastActive = Date.now();
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      wake();
    },
    { passive: true },
  );
  for (const type of ['wheel', 'keydown', 'touchstart', 'scroll'] as const) {
    window.addEventListener(type, wake, { passive: true });
  }
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.('[data-poko-point]');
    pointEl = el instanceof HTMLElement ? el : null;
  });
  document.addEventListener('pointerleave', () => {
    pointEl = null;
    pointer = null;
  });
  window.setInterval(() => {
    if (!napping && Date.now() - lastActive > NAP_AFTER) {
      napping = true;
      napSubs.forEach((f) => f());
    }
  }, 1000);
}
