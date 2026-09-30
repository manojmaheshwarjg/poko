'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { LogoMark } from './LogoMark';

const LINKS = [
  ['How it works', '#how', 'the clever bit'],
  ['Why Poko', '#why', 'be nice'],
  ['Pricing', '#pricing', 'spoiler: $0'],
  ['FAQ', '#faq', 'ask me anything'],
] as const;

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap nav-in">
        <a href="#top" className="brand" aria-label="Poko, back to top" data-say="that’s me">
          <span className="logo" aria-hidden="true">
            <LogoMark />
            poko
          </span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          {LINKS.map(([label, href, say]) => (
            <a key={href} href={href} data-say={say}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-cta">
          <a className="nav-talk" href="#faq" data-say="a person answers">
            Talk to us
          </a>
          <a className="btn btn-brand nav-btn" href="#join" data-poko-point data-say="one click. promise.">
            Get early access
          </a>
          <button
            type="button"
            className="nav-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="nav-sheet"
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>
      <div id="nav-sheet" className={`nav-sheet${open ? ' open' : ''}`}>
        <div className="wrap">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <a href="#faq" onClick={() => setOpen(false)}>
            Talk to us
          </a>
        </div>
      </div>
    </header>
  );
}
