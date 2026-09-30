'use client';

import { useState } from 'react';
import { cheer } from '@/lib/poko';
import { BrandLogo, logoLabel, type LogoName } from './BrandLogo';
import { Icon } from './Icon';
import { LogoMark } from './LogoMark';
import { SectionHead } from './SectionHead';

/* 02, how it works: three steps on one violet rail. Install, then Poko learns from your
   docs and from the routes your best users take, then you approve what it learned.
   The approve buttons work, and Poko cheers. */
const SOURCES: [LogoName | 'pdf', string, string][] = [
  ['notion', 'Notion', '74 pages'],
  ['confluence', 'Confluence', '58 pages'],
  ['zendesk', 'Zendesk', '88 articles'],
  ['intercom', 'Intercom', '31 articles'],
  ['gitbook', 'GitBook', '12 pages'],
  ['pdf', 'PDF manuals', '1 file'],
];

const STACKS: LogoName[] = ['react', 'nextjs', 'vue', 'angular', 'svelte', 'html'];

const FLOWS = [
  { name: 'Invite a teammate', seen: '214 sessions · 4 steps', ready: true },
  { name: 'Create an API key', seen: '96 sessions · 3 steps', ready: true },
  { name: 'Rotate a secret', seen: 'Needs 2 more sessions', ready: false },
];

export function HowItWorks() {
  const [approved, setApproved] = useState<string[]>([]);

  function approve(name: string) {
    setApproved((a) => (a.includes(name) ? a : [...a, name]));
    cheer();
  }

  return (
    <section className="section how deep" id="how" aria-labelledby="how-title" data-zone data-zone-mood="think" data-zone-say="taking notes…">
      <div className="wrap">
        <SectionHead
          n="02"
          label="How it works"
          id="how-title"
          title="Install once. Poko learns the rest."
          quiet="No tours to write, and you approve everything it learns."
        />
        <div className="hw-wrap">
        <span className="hw-rail" aria-hidden="true" />
        <ol className="hw">
          <li className="hw-step" id="install">
            <span className="hw-n" aria-hidden="true">
              1
            </span>
            <h3 className="hw-t">Install in one line</h3>
            <p className="hw-s">Any stack. Nothing to script.</p>
            <div className="hw-term mono" aria-label="npx usepoko init finds your Next.js app, adds Poko to app/layout.tsx, and starts listening for sessions.">
              <p aria-hidden="true">$ npx usepoko init</p>
              <p aria-hidden="true">
                <span className="ok">✓</span> Found a Next.js app
              </p>
              <p aria-hidden="true">
                <span className="ok">✓</span> Added to app/layout.tsx
              </p>
              <p className="accent" aria-hidden="true">
                ● Listening for sessions…
              </p>
            </div>
            <p className="hw-alt tag">or paste one script tag</p>
            <p className="hw-stack">
              <span className="tag">Works with</span>
              {STACKS.map((s) => (
                <span key={s} data-say={`${logoLabel(s)}? easy.`}>
                  <BrandLogo name={s} size={17} />
                </span>
              ))}
            </p>
          </li>

          <li className="hw-step">
            <span className="hw-n" aria-hidden="true">
              2
            </span>
            <h3 className="hw-t">It learns from your docs and your best users</h3>
            <p className="hw-s">Fields are masked on the page, before anything leaves it.</p>
            <ul className="hw-src">
              {SOURCES.map(([logo, name, count]) => (
                <li key={name} data-say={logo === 'pdf' ? 'I read PDFs too' : `reading ${name}…`}>
                  {logo === 'pdf' ? <Icon name="file" size={16} /> : <BrandLogo name={logo} size={16} />}
                  <span>{name}</span>
                  <span className="tag">{count}</span>
                </li>
              ))}
            </ul>
            <div className="hw-merge">
              <svg viewBox="0 0 240 64" aria-hidden="true">
                <g className="hw-traces">
                  <path d="M4 8 C 52 4, 70 32, 118 32" />
                  <path d="M4 24 C 50 32, 76 18, 118 32" />
                  <path d="M4 40 C 40 46, 80 26, 118 32" />
                  <path d="M4 56 C 56 58, 76 36, 118 32" />
                </g>
                <path className="hw-route stroke" pathLength={1} d="M118 32 H232" />
                <g className="hw-nodes">
                  <circle cx="148" cy="32" r="4.5" />
                  <circle cx="176" cy="32" r="4.5" />
                  <circle cx="204" cy="32" r="4.5" />
                  <circle className="done" cx="232" cy="32" r="5.5" />
                </g>
              </svg>
              <p>
                <span className="tag">214 sessions</span>
                <span className="accent">1 route, 4 steps</span>
              </p>
            </div>
          </li>

          <li className="hw-step">
            <span className="hw-n" aria-hidden="true">
              3
            </span>
            <h3 className="hw-t">You approve what it learned</h3>
            <p className="hw-s">Or show Poko once, in Teach mode.</p>
            <ul className="hw-flows">
              {FLOWS.map((f) => (
                <li key={f.name}>
                  <p>
                    <b>{f.name}</b>
                    <span>{f.seen}</span>
                  </p>
                  {!f.ready ? (
                    <span className="hw-learning tag">learning</span>
                  ) : approved.includes(f.name) ? (
                    <span className="hw-done" role="status">
                      <Icon name="check" size={13} />
                      Approved
                    </span>
                  ) : (
                    <button type="button" className="btn btn-brand hw-approve" onClick={() => approve(f.name)} data-say="you’re the boss">
                      Approve
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        </ol>
        </div>
        <a className="hw-then" href="#top" data-say="that’s me, up there">
          <LogoMark size={18} />
          <span>Then Poko does it with every new user, like the console up top.</span>
          <span aria-hidden="true">↑</span>
        </a>
      </div>
    </section>
  );
}
