'use client';

import { useEffect, useRef } from 'react';
import { trackPupil } from '@/lib/poko';

/* The logo mark: Poko drawn chunky for small sizes, with eyes big enough to read at
   16px. It sits on the same 120-unit grid as the character, so its pupils follow the
   visitor's pointer like every other Poko on the page. */
const MARK = 'M23.5 15 L96.6 61.9 L64 71.6 L49 105 Z';
const INK = '#1e1b4b';

export function LogoMark({ size = 28 }: { size?: number }) {
  const left = useRef<SVGCircleElement>(null);
  const right = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const stop: (() => void)[] = [];
    if (left.current) stop.push(trackPupil({ el: left.current, x: 41.7, y: 46.7 }));
    if (right.current) stop.push(trackPupil({ el: right.current, x: 60.8, y: 55.3 }));
    return () => stop.forEach((f) => f());
  }, []);

  return (
    <svg className="logo-mark" viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={MARK} fill="#6D5DFC" stroke="#6D5DFC" strokeWidth="12" strokeLinejoin="round" />
      <circle cx="43" cy="48" r="10.9" fill="#fff" />
      <circle cx="62.1" cy="56.6" r="10.9" fill="#fff" />
      <circle ref={left} cx="41.7" cy="46.7" r="5.45" fill={INK} />
      <circle ref={right} cx="60.8" cy="55.3" r="5.45" fill={INK} />
    </svg>
  );
}
