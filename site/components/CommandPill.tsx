'use client';

import { useRef, useState } from 'react';
import { cheer } from '@/lib/poko';
import { SITE } from '@/lib/site';
import { Icon } from './Icon';

/* The install command, copied in one click. Poko cheers when it's copied. */
export function CommandPill({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(SITE.cli);
    } catch {
      /* Clipboard blocked: the command is on screen to copy by hand. */
    }
    setCopied(true);
    cheer();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      className={`cmd${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={copy}
      data-poko-point
      aria-label={`Copy the install command: ${SITE.cli}`}
    >
      <span className="prompt" aria-hidden="true">
        $
      </span>
      <span>{SITE.cli}</span>
      <span className="cmd-copy" aria-hidden="true">
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </span>
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
