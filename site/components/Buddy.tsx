'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from '@/lib/gsap';
import { cheering, isNapping, subscribeNap, TRAVEL_QUERY, type Mood } from '@/lib/poko';
import { Sticker } from './Sticker';

type Look = { mood: Mood; hat: boolean; say: string; flip: boolean };

/* Poko is your cursor, drawn as one of its die-cut stickers. On a desktop the system
   cursor steps aside and Poko's tip does the pointing, one cursor, exactly where your
   mouse is. It has an opinion about what
   you hover, takes on each section's mood, wears a party hat at the price, covers its
   eyes while you type and naps when you go quiet. Over text fields the normal text
   cursor comes back, so typing and selecting feel as they always do. */

const SIZE = 56;
/* Poko's tip inside its 120-unit box: this is the hotspot. */
const TIP_X = 34 / 120;
const TIP_Y = 18 / 120;
const TEXT = 'input, textarea, select, [contenteditable="true"]';
const CLICKABLE = 'a, button, summary, label, [role="button"], [role="radio"], [data-say]';

export function Buddy() {
  const pokoRef = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const [look, setLook] = useState<Look>({ mood: 'happy', hat: false, say: '', flip: false });
  const lookRef = useRef(look);

  useEffect(() => {
    const mq = window.matchMedia(TRAVEL_QUERY);
    const { gsap } = motion();
    const html = document.documentElement;
    const unsubNap = subscribeNap(() => {});
    const ptr = { x: -100, y: -100, inside: false, overText: false, overClick: false, down: false };
    let raf = 0;
    let typingAt = 0;
    let zone: HTMLElement | null = null;
    let zoneAt = 0;
    let zones: HTMLElement[] = [];
    let zonesAt = 0;
    let hover: { say: string; mood: Mood | null } | null = null;
    let clicks: number[] = [];
    let dizzyUntil = 0;
    let running = false;

    const place = () => {
      raf = 0;
      const el = pokoRef.current;
      if (!el) return;
      el.style.transform = `translate3d(${(ptr.x - SIZE * TIP_X).toFixed(1)}px, ${(ptr.y - SIZE * TIP_Y).toFixed(1)}px, 0)`;
      el.classList.toggle('hidden', !ptr.inside || ptr.overText);
      el.classList.toggle('over', ptr.overClick);
      el.classList.toggle('down', ptr.down);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.inside = true;
      queue();
    };
    const onOver = (e: PointerEvent) => {
      const t = e.target as Element | null;
      ptr.overText = !!t?.closest?.(TEXT);
      ptr.overClick = !!t?.closest?.(CLICKABLE);
      const el = t?.closest?.('[data-say]');
      hover = el ? { say: el.getAttribute('data-say') ?? '', mood: (el.getAttribute('data-say-mood') as Mood | null) ?? null } : null;
      queue();
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) {
        ptr.inside = false;
        queue();
      }
    };
    const onDown = () => {
      ptr.down = true;
      const now = performance.now();
      clicks = [...clicks.filter((t) => now - t < 1800), now];
      if (clicks.length >= 5) {
        clicks = [];
        dizzyUntil = now + 1400;
      }
      queue();
    };
    const onUp = () => {
      ptr.down = false;
      queue();
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(TEXT)) typingAt = performance.now();
    };

    /* Once a frame: which section you're in, and what Poko looks like and says. */
    const tick = () => {
      const now = performance.now();
      const vh = window.innerHeight;
      if (now - zonesAt > 1000) {
        zones = [...document.querySelectorAll<HTMLElement>('[data-zone]')];
        zonesAt = now;
      }
      const line = vh * 0.45;
      const current =
        zones.find((z) => {
          const r = z.getBoundingClientRect();
          return r.top <= line && r.bottom > line;
        }) ?? null;
      if (current !== zone) {
        zone = current;
        zoneAt = now;
      }

      let mood: Mood = (zone?.dataset.zoneMood as Mood | undefined) ?? 'idle';
      const hat = zone?.dataset.zoneHat === 'true';
      let say = '';
      if (zone?.dataset.zoneSay && now - zoneAt < 3200) say = zone.dataset.zoneSay;
      if (hover?.say) {
        say = hover.say;
        if (hover.mood) mood = hover.mood;
      }
      if (now - typingAt < 1400) {
        mood = 'peek';
        say = 'not peeking';
      }
      if (isNapping()) say = 'zzz';
      if (cheering()) {
        mood = 'happy';
        say = 'yay!';
      }
      if (now < dizzyUntil) {
        mood = 'confused';
        say = 'whoa';
      }
      const flip = ptr.x + 240 > window.innerWidth;
      const cur = lookRef.current;
      if (cur.mood !== mood || cur.hat !== hat || cur.say !== say || cur.flip !== flip) {
        const next = { mood, hat, say, flip };
        lookRef.current = next;
        setLook(next);
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      html.classList.add('has-buddy');
      setOn(true);
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerover', onOver);
      document.addEventListener('pointerout', onOut);
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      document.addEventListener('keydown', onKey, true);
      gsap.ticker.add(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      gsap.ticker.remove(tick);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
      html.classList.remove('has-buddy');
      setOn(false);
    };
    const apply = () => (mq.matches ? start() : stop());
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      stop();
      unsubNap();
    };
  }, []);

  return (
    <div className={`buddy${on ? ' on' : ''}`} aria-hidden="true">
      <div ref={pokoRef} className="buddy-poko hidden" style={{ width: SIZE, height: SIZE }}>
        <span className="buddy-body">
          <Sticker mood={look.mood} hat={look.hat} size={SIZE} />
        </span>
        {look.say ? (
          <span className={`buddy-say${look.flip ? ' left' : ''}`} key={look.say}>
            {look.say}
          </span>
        ) : null}
      </div>
    </div>
  );
}
