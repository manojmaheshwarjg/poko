'use client';

import { useEffect } from 'react';
import { SplitText } from 'gsap/SplitText';
import { motion, reducedMotion } from '@/lib/gsap';

/* The scroll choreography, one effect per section, all in one place so the page moves
   as one piece. Everything is visible without it: these only bring things in or move
   them with the scroll. Reduced motion gets the still page. */
export function ScrollFX() {
  useEffect(() => {
    if (reducedMotion()) return;
    const { gsap, ScrollTrigger } = motion();
    gsap.registerPlugin(SplitText);
    const splits: SplitText[] = [];
    const mm = gsap.matchMedia();
    const one = (sel: string) => document.querySelector<HTMLElement>(sel);
    const all = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
    const once = (trigger: Element | string, start = 'top 82%') => ({ trigger, start, once: true });

    const ctx = gsap.context(() => {
      /* Every section head: the hairline draws, then the headline rises word by word. */
      all('.sh').forEach((sh) => {
        const ix = sh.querySelector('.ix');
        const h2 = sh.querySelector('.h2');
        const tl = gsap.timeline({ scrollTrigger: once(sh, 'top 86%') });
        if (ix) tl.fromTo(ix, { '--ix': 0 }, { '--ix': 1, duration: 1.1, ease: 'power3.out' }, 0);
        if (h2) {
          const split = SplitText.create(h2, { type: 'words', mask: 'words' });
          splits.push(split);
          tl.from(split.words, { yPercent: 110, duration: 0.9, ease: 'power4.out', stagger: 0.028 }, 0.05);
        }
      });

      /* Hero: the text lifts away and the console settles from a slight tilt as you start
         to scroll. */
      const hero = one('.hero');
      if (hero) {
        const out = { trigger: hero, start: 'top top', end: 'bottom top' };
        gsap.to('.hero-in', { y: -60, opacity: 0.3, ease: 'none', scrollTrigger: { ...out, scrub: 0.5 } });
        gsap.fromTo(
          '.hero-window .browser',
          { rotateX: 9, scale: 0.965, transformPerspective: 1600, transformOrigin: '50% 0%' },
          { rotateX: 0, scale: 1, ease: 'none', scrollTrigger: { trigger: '.hero-window', start: 'top 88%', end: 'top 28%', scrub: 0.6 } },
        );
      }

      /* 01 The problem: the wandering route draws with the scroll, picking up the course,
         the docs and the ticket; then Poko's short line snaps in. */
      mm.add('(min-width: 861px)', () => {
        if (!one('.pb-chart')) return;
        const tl = gsap.timeline({ scrollTrigger: { trigger: '.pb-chart', start: 'top 80%', end: 'bottom 78%', scrub: 0.8 } });
        tl.fromTo('.pb-wander', { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', duration: 3 }, 0)
          .from('.pb-course', { autoAlpha: 0, y: 22, duration: 0.5 }, 0.25)
          .from('.pb-docs', { autoAlpha: 0, y: 22, duration: 0.5 }, 1.15)
          .from('.pb-ticket', { autoAlpha: 0, y: 22, duration: 0.5 }, 2)
          .from('.pb-end', { autoAlpha: 0, duration: 0.3 }, 2.75)
          .from('.pb-line', { scaleX: 0, transformOrigin: 'left center', duration: 0.5 }, 3)
          .from('.pb-check', { scale: 0, duration: 0.3, ease: 'back.out(3)' }, 3.4)
          .from('.pb-poko p', { autoAlpha: 0, x: -10, duration: 0.3 }, 3.5);
      });
      mm.add('(max-width: 860px)', () => {
        all('.pb-card').forEach((c) => gsap.from(c, { autoAlpha: 0, y: 24, duration: 0.7, ease: 'power3.out', scrollTrigger: once(c, 'top 88%') }));
      });
      gsap.from('.pb-stats > *', { autoAlpha: 0, y: 14, duration: 0.6, stagger: 0.12, ease: 'power3.out', scrollTrigger: once('.pb-stats', 'top 88%') });

      /* 02 How it works: the rail draws from step to step and each step arrives with it. */
      mm.add('(min-width: 901px)', () => {
        if (!one('.hw-wrap')) return;
        const tl = gsap.timeline({ scrollTrigger: { trigger: '.hw-wrap', start: 'top 80%', end: 'top 30%', scrub: 0.8 } });
        tl.from('.hw-rail', { scaleX: 0, transformOrigin: 'left center', ease: 'none', duration: 2 }, 0);
        all('.hw-step').forEach((step, i) => tl.from(step, { autoAlpha: 0, y: 30, duration: 0.6, ease: 'power2.out' }, i * 0.7));
      });
      mm.add('(max-width: 900px)', () => {
        if (!one('.hw-wrap')) return;
        gsap.from('.hw-rail', { scaleY: 0, transformOrigin: 'center top', ease: 'none', scrollTrigger: { trigger: '.hw-wrap', start: 'top 75%', end: 'bottom 70%', scrub: 0.8 } });
        all('.hw-step').forEach((step) => gsap.from(step, { autoAlpha: 0, y: 24, duration: 0.7, scrollTrigger: once(step, 'top 86%') }));
      });
      gsap.from('.hw-term p', { autoAlpha: 0, x: -8, duration: 0.35, stagger: 0.32, scrollTrigger: once('.hw-term', 'top 84%') });
      gsap.fromTo('.hw-route', { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.hw-merge', start: 'top 88%', end: 'top 58%', scrub: 0.6 } });
      gsap.from('.hw-nodes circle', { scale: 0, transformOrigin: '50% 50%', stagger: 0.12, duration: 0.3, ease: 'back.out(2.5)', scrollTrigger: once('.hw-merge', 'top 66%') });

      /* 03 For your team: the console tilts up into place, the numbers count up, and the
         learned route draws across the map. */
      const tc = one('.tc');
      if (tc) {
        gsap.fromTo(
          tc,
          { rotateX: 14, y: 70, scale: 0.94, transformPerspective: 1800, transformOrigin: '50% 100%' },
          { rotateX: 0, y: 0, scale: 1, ease: 'none', scrollTrigger: { trigger: tc, start: 'top 98%', end: 'top 42%', scrub: 0.7 } },
        );
        all('.tc-num').forEach((el) => {
          const to = Number(el.dataset.to || 0);
          const suffix = el.dataset.suffix || '';
          const final = el.textContent;
          const n = { v: 0 };
          el.textContent = `0${suffix}`;
          gsap.to(n, {
            v: to,
            duration: 1.4,
            ease: 'power2.out',
            scrollTrigger: once(tc, 'top 70%'),
            onUpdate: () => {
              el.textContent = `${Math.round(n.v)}${suffix}`;
            },
            onComplete: () => {
              el.textContent = final;
            },
          });
        });
        gsap.fromTo('.tc-learned path', { strokeDashoffset: 1 }, { strokeDashoffset: 0, stagger: 0.3, ease: 'none', scrollTrigger: { trigger: '.tc-map', start: 'top 88%', end: 'top 48%', scrub: 0.6 } });
      }

      /* 04 Why Poko: the verdicts rise into line, their hits tick in, and the closing line
         brightens word by word as you read it. */
      const cards = all('.wy-card');
      if (cards.length) {
        mm.add('(min-width: 901px)', () => {
          gsap.from(cards, {
            y: 90,
            rotation: (i: number) => [-2.5, 1.5, 2.5][i % 3],
            autoAlpha: 0,
            stagger: 0.12,
            ease: 'none',
            scrollTrigger: { trigger: '.wy-cards', start: 'top 94%', end: 'top 52%', scrub: 0.8 },
          });
        });
        mm.add('(max-width: 900px)', () => {
          cards.forEach((c) => gsap.from(c, { y: 40, autoAlpha: 0, duration: 0.7, scrollTrigger: once(c, 'top 88%') }));
        });
        cards.forEach((c) =>
          gsap.from(all('.wy-hits li', c), { autoAlpha: 0, x: -10, stagger: 0.12, duration: 0.4, scrollTrigger: once(c, 'top 72%') }),
        );
        gsap.fromTo('.wy-art .stroke', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, stagger: 0.2, ease: 'power2.out', scrollTrigger: once('.wy-cards', 'top 72%') });
        gsap.from('.wy-grid li', { autoAlpha: 0, y: 20, stagger: 0.07, duration: 0.5, scrollTrigger: once('.wy-wins', 'top 80%') });
        const punch = one('.wy-punch');
        if (punch) {
          const split = SplitText.create(punch, { type: 'words' });
          splits.push(split);
          gsap.fromTo(split.words, { opacity: 0.16 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: punch, start: 'top 88%', end: 'top 52%', scrub: true } });
        }
      }

      /* 05 Pricing: the plans rise in, the free one first. */
      gsap.from('.pr-plan', { autoAlpha: 0, y: 44, stagger: 0.1, duration: 0.8, ease: 'power3.out', scrollTrigger: once('.pr-grid', 'top 84%') });
      gsap.from('.pr-every > *', { autoAlpha: 0, y: 8, stagger: 0.05, duration: 0.4, scrollTrigger: once('.pr-every', 'top 92%') });

      /* 06 FAQ: Ask Poko, then the answers, one after another. */
      gsap.from('.fq-box', { autoAlpha: 0, y: 20, duration: 0.6, scrollTrigger: once('.fq-box', 'top 88%') });
      gsap.from('.fq-item', { autoAlpha: 0, y: 14, stagger: 0.05, duration: 0.45, scrollTrigger: once('.fq-list', 'top 84%') });

      /* The close: the dot-matrix POKO rises letter by letter and Poko drops onto it. */
      const word = one('.ft-word');
      if (word) {
        const split = SplitText.create(word, { type: 'chars' });
        splits.push(split);
        const tl = gsap.timeline({ scrollTrigger: { trigger: '.ft-mark', start: 'top 96%', end: 'top 55%', scrub: 0.8 } });
        tl.from(split.chars, { yPercent: 45, autoAlpha: 0, stagger: 0.15, ease: 'power2.out' }, 0).from(
          '.ft-spot',
          { y: -90, rotation: -35, autoAlpha: 0, ease: 'back.out(1.6)', duration: 0.6 },
          0.55,
        );
      }
    });

    /* Fonts change line lengths: measure again once they're in. */
    document.fonts?.ready.then(() => ScrollTrigger.refresh());

    return () => {
      splits.forEach((s) => s.revert());
      mm.revert();
      ctx.revert();
    };
  }, []);

  return null;
}
