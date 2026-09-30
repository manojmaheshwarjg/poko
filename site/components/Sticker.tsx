import type { CSSProperties } from 'react';
import type { Mood } from '@/lib/poko';
import { BODY, Poko } from './Poko';

type Props = {
  mood?: Mood;
  size?: number;
  rotate?: number;
  color?: string;
  hat?: boolean;
  naps?: boolean;
  className?: string;
  style?: CSSProperties;
};

/* Poko as a die-cut sticker: a thick white border, a soft shadow, stuck on at an angle.
   Stickers hold still, but their eyes still follow you, and they lift a little when
   you hover them. */
export function Sticker({ mood = 'happy', size = 64, rotate = 0, color, hat = false, naps = false, className, style }: Props) {
  return (
    <span
      className={`sticker${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, ['--r' as string]: `${rotate}deg`, ...style }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" className="sticker-cut" focusable="false">
        <path d={BODY} fill="#fff" stroke="#fff" strokeWidth="20" strokeLinejoin="round" />
      </svg>
      <Poko mood={mood} color={color} hat={hat} naps={naps} still />
    </span>
  );
}
