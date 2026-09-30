import type { ReactNode } from 'react';

/* A Mac Chrome window around the demo: the traffic lights and one open tab in the tab
   strip, then the toolbar with the address bar. Drawn in HTML and CSS, so it stays sharp
   at any size. */
export function BrowserFrame({ host, path, title, children }: { host: string; path: string; title: string; children: ReactNode }) {
  return (
    <div className="browser">
      <div className="br-strip" aria-hidden="true">
        <span className="br-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="br-tab">
          <span className="br-favicon">A</span>
          <span className="br-title">{title}</span>
          <svg className="br-close" viewBox="0 0 16 16">
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
          </svg>
        </span>
        <svg className="br-new" viewBox="0 0 16 16">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </div>
      <div className="br-bar" aria-hidden="true">
        <span className="br-nav">
          <svg viewBox="0 0 16 16">
            <path d="M13 8H3M7.5 3.5 3 8l4.5 4.5" />
          </svg>
          <svg className="off" viewBox="0 0 16 16">
            <path d="M3 8h10M8.5 3.5 13 8l-4.5 4.5" />
          </svg>
          <svg viewBox="0 0 16 16">
            <path d="M12.8 9.5A5 5 0 1 1 11.5 4.4M12.5 2.5v3h-3" />
          </svg>
        </span>
        <span className="br-url">
          <svg viewBox="0 0 16 16">
            <path d="M2.5 5.5h5.5M12.5 5.5h1M2.5 10.5h1M8 10.5h5.5" />
            <circle cx="10" cy="5.5" r="1.6" />
            <circle cx="5.5" cy="10.5" r="1.6" />
          </svg>
          <span className="br-address">
            <b>{host}</b>
            {path}
          </span>
        </span>
        <span className="br-tools">
          <svg viewBox="0 0 16 16">
            <path d="M8 2.2l1.75 3.55 3.9.57-2.83 2.76.67 3.9L8 11.14l-3.5 1.84.67-3.9L2.35 6.32l3.9-.57z" />
          </svg>
          <span className="br-avatar" />
          <svg className="br-more" viewBox="0 0 16 16">
            <circle cx="8" cy="3.5" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="8" cy="12.5" r="1.2" />
          </svg>
        </span>
      </div>
      {children}
    </div>
  );
}
