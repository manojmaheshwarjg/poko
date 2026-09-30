'use client';

import { useEffect, useRef } from 'react';

/* Poko's cursor in the hero, drawn in 3D with edges only. The front outline is the nav
   logo exactly: the same angle and the same rounded corners. The back outline sits
   behind it to the right, fainter, joined at every corner. Every edge shares one
   gradient, violet on the left through lilac to sky. It holds still: drawn once, and
   again only when the hero changes size. */

type Pt = readonly [number, number];

/* The logo's outline on its 120-unit grid (y down): tip, wing, notch, tail. The logo
   draws it with a 12-unit round stroke, so its corners round off at half that. */
const MARK: Pt[] = [
  [23.5, 15],
  [96.6, 61.9],
  [64, 71.6],
  [49, 105],
];
const ROUND = 6;
/* The light comes from the left and a little below, so the depth runs to the right and
   a little up. */
const LIGHT: Pt = [-0.96, 0.27];

/* The logo's silhouette: every edge pushed out by the stroke, round at the outside
   corners and sharp in the notch. Returned one unit tall and centered, with the four
   corners where the depth edges join. */
function logoOutline() {
  const n = MARK.length;
  let area = 0;
  MARK.forEach((p, i) => {
    const q = MARK[(i + 1) % n];
    area += p[0] * q[1] - q[0] * p[1];
  });
  const side = area > 0 ? 1 : -1;
  const normal = (i: number): Pt => {
    const p = MARK[i];
    const q = MARK[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(side * (q[1] - p[1])) / len, (-side * (q[0] - p[0])) / len];
  };
  const pts: Pt[] = [];
  const corners: Pt[] = [];
  MARK.forEach((v, i) => {
    const a = normal((i + n - 1) % n);
    const b = normal(i);
    const turn = a[0] * b[1] - a[1] * b[0];
    if (turn * side > 0) {
      let from = Math.atan2(a[1], a[0]);
      let to = Math.atan2(b[1], b[0]);
      if (side > 0 && to < from) to += Math.PI * 2;
      if (side < 0 && to > from) from += Math.PI * 2;
      for (let s = 0; s <= 12; s++) {
        const ang = from + ((to - from) * s) / 12;
        pts.push([v[0] + Math.cos(ang) * ROUND, v[1] + Math.sin(ang) * ROUND]);
      }
      const mid = (from + to) / 2;
      corners.push([v[0] + Math.cos(mid) * ROUND, v[1] + Math.sin(mid) * ROUND]);
    } else {
      const k = ROUND / (1 + a[0] * b[0] + a[1] * b[1]);
      const inner: Pt = [v[0] + (a[0] + b[0]) * k, v[1] + (a[1] + b[1]) * k];
      pts.push(inner);
      corners.push(inner);
    }
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const unit = 1 / (Math.max(...ys) - Math.min(...ys));
  const fit = (p: Pt): Pt => [(p[0] - cx) * unit, (p[1] - cy) * unit];
  return { pts: pts.map(fit), corners: corners.map(fit) };
}

export function HeroArrow() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current;
    const canvas = canvasRef.current;
    const hero = el?.closest<HTMLElement>('.hero');
    const ctx = canvas?.getContext('2d');
    if (!el || !canvas || !hero || !ctx) return;

    const shape = logoOutline();
    let w = 1;
    let h = 1;
    let cx = 0;
    let cy = 0;
    let size = 1;

    /* Fit the canvas to the hero and place the arrow right of the headline (above it on
       a phone), with the end of its tail behind the demo. */
    function layout() {
      if (!canvas || !ctx || !hero) return;
      const rect = hero.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const phone = w <= 760;
      let left = 0;
      let right = w;
      const content = hero.querySelector<HTMLElement>('.wrap');
      if (content) {
        const r = content.getBoundingClientRect();
        const cs = getComputedStyle(content);
        left = r.left - rect.left + parseFloat(cs.paddingLeft);
        right = r.right - rect.left - parseFloat(cs.paddingRight);
      }
      size = phone ? Math.min(200, w * 0.5) : w >= 1400 ? 400 : w >= 1100 ? 360 : 300;
      cx = phone ? w * 0.5 : left + (right - left) * (w >= 1100 ? 0.73 : 0.77);
      cy = phone ? 190 : w >= 1400 ? 330 : w >= 1100 ? 320 : 310;
    }

    function draw() {
      if (!ctx) return;
      const l = Math.hypot(LIGHT[0], LIGHT[1]);
      const lx = LIGHT[0] / l;
      const ly = LIGHT[1] / l;

      /* The depth runs away from the light, a ninth of the arrow's height. */
      const deep = size * 0.11;
      const dx = -lx * deep;
      const dy = -ly * deep;
      const front = shape.pts.map(([x, y]) => [cx + x * size, cy + y * size] as const);
      const back = front.map(([x, y]) => [x + dx, y + dy] as const);

      /* One gradient for every edge: violet on the side the light comes from, to sky. */
      const reach = size * 0.75;
      const paint = ctx.createLinearGradient(cx + lx * reach, cy + ly * reach, cx - lx * reach, cy - ly * reach);
      paint.addColorStop(0, '#5646e0');
      paint.addColorStop(0.5, '#b19dff');
      paint.addColorStop(1, '#5fb6ff');
      const thick = Math.max(0.7, size / 400);

      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = paint;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const loop = (pts: readonly Pt[], width: number, alpha: number) => {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width * thick;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.stroke();
      };
      loop(back, 1.6, 0.55);
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2.2 * thick;
      ctx.beginPath();
      for (const [x, y] of shape.corners) {
        ctx.moveTo(cx + x * size, cy + y * size);
        ctx.lineTo(cx + x * size + dx, cy + y * size + dy);
      }
      ctx.stroke();
      loop(front, 3, 1);
      ctx.globalAlpha = 1;
    }

    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(hero);
    layout();
    draw();
    el.classList.add('on');
    return () => ro.disconnect();
  }, []);

  return (
    <div className="arrow-wrap" ref={wrap} aria-hidden="true">
      <canvas ref={canvasRef} className="arrow-canvas" />
    </div>
  );
}
