'use client';

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { isNapping, POKO_VIOLET, subscribeNap, trackPupil, type Mood } from '@/lib/poko';

/* Poko: a cursor with eyes. One flat path for the body and a face per mood, on a
   120-unit grid so it stays crisp from a 14px mark to the hero. */
export const BODY = 'M34 18 L94 62 Q97 65 93 67 L66 72 L55 98 Q53 102 50 98 L32 22 Q31 16 34 18 Z';
const INK = '#1e1b4b';
const BLUSH = '#F9A8D4';

const EYES: Partial<Record<Mood, [number, number, number, number]>> = {
  idle: [47, 49, 63, 56],
  confused: [46, 48, 62, 55],
  think: [49, 44.5, 65, 51.5],
};

function Pupil({ x, y, track }: { x: number; y: number; track: boolean }) {
  const ref = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!track || !ref.current) return;
    return trackPupil({ el: ref.current, x, y });
  }, [x, y, track]);
  return <circle ref={ref} cx={x} cy={y} r="3.3" fill={INK} />;
}

function Face({ mood }: { mood: Mood }) {
  if (mood === 'plain') return null;
  if (mood === 'happy') {
    return (
      <>
        <path d="M41 49q6-7 12 0M57 56q6-7 12 0" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="44" cy="62" r="3.2" fill={BLUSH} />
        <path d="M50 63q6 6 12 1" fill={INK} stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  if (mood === 'sleep') {
    return (
      <>
        <path d="M41 50q6 5 12 0M57 57q6 5 12 0" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="56" cy="67" r="2.6" fill={INK} />
        <g className="poko-z" fill="#6D5DFC" fontFamily="var(--font-mono), monospace" fontWeight="500">
          <text x="92" y="30" fontSize="15">
            z
          </text>
          <text x="104" y="18" fontSize="11">
            z
          </text>
        </g>
      </>
    );
  }
  if (mood === 'wink') {
    return (
      <>
        <path d="M41 50q6 5 12 0" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="63" cy="55" rx="6.5" ry="7.5" fill="#fff" />
        <Pupil x={62} y={56} track />
        <circle cx="56" cy="67" r="2.2" fill={INK} />
      </>
    );
  }
  if (mood === 'peek') {
    return (
      <>
        <path d="M36 50L74 60L72 68L34 58Z" fill={INK} />
        <path d="M42 54q5 2 9 2M58 58q5 2 9 2" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" />
        <path d="M52 71q4 2 8 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  const [lx, ly, rx, ry] = EYES[mood] ?? EYES.idle!;
  const track = mood !== 'think';
  return (
    <>
      <g className="poko-blink">
        <ellipse cx="47" cy="48" rx="6.5" ry="7.5" fill="#fff" />
        <ellipse cx="63" cy="55" rx="6.5" ry="7.5" fill="#fff" />
        <Pupil x={lx} y={ly} track={track} />
        <Pupil x={rx} y={ry} track={track} />
      </g>
      {mood === 'think' ? (
        <>
          <path d="M53 65h7" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <g className="poko-dots" fill="#6D5DFC">
            <circle cx="92" cy="30" r="3.5" />
            <circle cx="102" cy="23" r="3.5" />
            <circle cx="112" cy="16" r="3.5" />
          </g>
        </>
      ) : mood === 'confused' ? (
        <>
          <path d="M51 66q3-3 5 0t5 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <text x="86" y="34" fontSize="22" fontWeight="700" fill="#6D5DFC" fontFamily="var(--font-sans), sans-serif">
            ?
          </text>
        </>
      ) : (
        <>
          <circle cx="44" cy="62" r="3" fill={BLUSH} />
          <path d="M52 64q4 3 8 1" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </>
  );
}

/* A party hat that sits on Poko's tip, tilted along its body. */
function Hat() {
  return (
    <g className="poko-hat">
      <path d="M28.3 31.2 L48.5 18.2 L24.2 2.9 Z" fill="#FFD66B" />
      <path d="M31.6 24.8 L43.7 17 M28 16.5 L36.5 11" stroke="#F97366" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24.2" cy="2.9" r="3.6" fill="#FFAFD1" />
    </g>
  );
}

type Props = {
  mood?: Mood;
  color?: string;
  hat?: boolean;
  /* Falls asleep with every other Poko when the visitor goes quiet. */
  naps?: boolean;
  /* Holds still, as a sticker would. The eyes still follow the cursor. */
  still?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function Poko({ mood = 'idle', color = POKO_VIOLET, hat = false, naps = true, still = false, className, style }: Props) {
  const napping = useSyncExternalStore(subscribeNap, isNapping, () => false);
  const m: Mood = naps && napping && mood !== 'plain' ? 'sleep' : mood;
  const motion = still || m === 'plain' ? '' : m === 'happy' ? 'poko-hop' : m === 'sleep' ? 'poko-breathe' : 'poko-bob';
  return (
    <svg viewBox="0 0 120 120" className={`poko${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" focusable="false">
      <g className={motion}>
        <path
          d={BODY}
          fill={m === 'plain' ? '#fff' : color}
          stroke={m === 'plain' ? INK : color}
          strokeWidth={m === 'plain' ? 5 : 6}
          strokeLinejoin="round"
        />
        <Face mood={m} />
        {hat && m !== 'plain' ? <Hat /> : null}
      </g>
    </svg>
  );
}
