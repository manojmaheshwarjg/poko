'use client';

import { useEffect, useRef, useState } from 'react';
import { cheer, type Mood } from '@/lib/poko';
import { useInView } from '@/lib/useInView';
import { CommandPill } from './CommandPill';
import { EmailForm } from './EmailForm';
import { Sticker } from './Sticker';

/* The close: the one line that never changes, the sign-up, then Poko napping on the
   dot-matrix mark. Bring the cursor close and it opens one eye. */
const COLS: [string, [string, string][]][] = [
  [
    'Product',
    [
      ['How it works', '#how'],
      ['Why Poko', '#why'],
      ['Pricing', '#pricing'],
    ],
  ],
  [
    'Developers',
    [
      ['Install', '#install'],
      ['For your team', '#team'],
      ['FAQ', '#faq'],
    ],
  ],
  [
    'Company',
    [
      ['Talk to us', '#faq'],
    ],
  ],
];

export function Footer() {
  const root = useRef<HTMLElement>(null);
  const spot = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [joined, setJoined] = useState(false);
  const [yawning, setYawning] = useState(false);
  const arrived = useInView(spot, { threshold: 0.6 });

  /* When you reach the bottom, Poko looks up once, then drifts off to sleep. */
  useEffect(() => {
    if (!arrived) return;
    setYawning(true);
    const t = window.setTimeout(() => setYawning(false), 1500);
    return () => window.clearTimeout(t);
  }, [arrived]);

  /* Bring the cursor close and Poko opens one eye. */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const s = spot.current?.querySelector('.sticker');
      if (!s) return;
      const r = s.getBoundingClientRect();
      setNear(Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < 120);
    };
    const leave = () => setNear(false);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);

  const mood: Mood = joined ? 'happy' : near || yawning ? 'wink' : 'sleep';

  return (
    <footer className="footer" id="join" ref={root} aria-labelledby="join-title" data-zone data-zone-mood="happy" data-zone-say="that’s me, napping">
      <div className="wrap ft-cta">
        <div className="ft-copy">
          <h2 className="h2 ft-title" id="join-title">
            Give your product a <span className="accent">Poko.</span>
          </h2>
          <p className="lede">Free in beta. No card. One line to install.</p>
        </div>
        <div className="ft-actions">
          <EmailForm
            id="join-email"
            label="Get early access"
            placeholder="you@company.com"
            done="You’re on the list. We’ll send your key when your spot opens."
            onDone={() => {
              setJoined(true);
              cheer(2400);
              window.setTimeout(() => setJoined(false), 2600);
            }}
          />
          <p className="ft-or">
            <span className="tag">or</span>
            <CommandPill className="cmd-sm" />
          </p>
        </div>
      </div>
      <div className="ft-mark" aria-hidden="true">
        <span className="dot ft-word">POKO</span>
        <div className="ft-spot" ref={spot}>
          <Sticker mood={mood} size={84} rotate={-8} naps={false} />
        </div>
      </div>
      <div className="wrap ft-cols">
        {COLS.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="tag">{title}</p>
            {links.map(([label, href]) => (
              <a key={label} href={href}>
                {label}
              </a>
            ))}
          </nav>
        ))}
        <p className="ft-base tag">
          <span>© 2026 Poko</span>
          <span>Every new user, a power user.</span>
        </p>
      </div>
    </footer>
  );
}
