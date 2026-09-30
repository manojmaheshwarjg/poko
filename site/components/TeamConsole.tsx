'use client';

import { LogoMark } from './LogoMark';
import { SectionHead } from './SectionHead';

/* 03, for your team: the console the buyer actually uses. A map of the product with the
   routes Poko learned drawn in violet, where users stall in red, how accurate Poko is,
   and what needs a human. Sample data. On phones the map becomes a vertical route. */
const NAV: [string, string, string?][] = [
  ['Map', ''],
  ['Workflows', '12'],
  ['Struggles', '3', 'x'],
  ['Docs', ''],
  ['Evaluations', ''],
  ['Runs', ''],
  ['Setup', ''],
];

const KPIS: [string, string, string?][] = [
  ['Learning score', '82', '+6 this week'],
  ['Workflow accuracy', '94%'],
  ['Docs answers', '91%'],
  ['Needs you', '2'],
];

const FLOWS: [string, string, 'ok' | 'you'][] = [
  ['Invite a teammate', 'Verified · 214 runs', 'ok'],
  ['Create an API key', 'Verified · 96 runs', 'ok'],
  ['Give read-only access', 'To approve', 'you'],
];

const NEEDS: [string, string][] = [
  ['you', '2 workflows to approve'],
  ['drift', 'Docs drifted: the “Roles” page'],
  ['stuck', 'Tax settings: 38 users stuck'],
];

const ROUTE = ['Home', 'Identity', 'Users', 'Create user', 'Permissions', 'Review'];

type Node = { x: number; y: number; label: string; kind?: 'route' | 'end' | 'stuck' };
/* Map units: nodes are 120 x 28 on an 820-wide canvas, so labels land near UI size. */
const NODES: Node[] = [
  { x: 10, y: 80, label: 'Home', kind: 'route' },
  { x: 175, y: 30, label: 'Identity', kind: 'route' },
  { x: 175, y: 130, label: 'Billing' },
  { x: 340, y: 30, label: 'Users', kind: 'route' },
  { x: 340, y: 80, label: 'Roles' },
  { x: 340, y: 130, label: 'Tax settings', kind: 'stuck' },
  { x: 505, y: 30, label: 'Create user', kind: 'route' },
  { x: 670, y: 30, label: 'Permissions', kind: 'route' },
  { x: 670, y: 80, label: 'Review', kind: 'end' },
];

export function TeamConsole() {
  return (
    <section className="section alt team" id="team" aria-labelledby="team-title" data-zone data-zone-mood="happy" data-zone-say="look at my map">
      <div className="wrap">
        <SectionHead
          n="03"
          label="For your team"
          id="team-title"
          title="See what Poko learned, and where users get stuck."
          quiet="Every route is checked before anyone sees it."
        />
        <figure className="tc">
          <div className="tc-top" aria-hidden="true">
            <LogoMark size={18} />
            <b>poko</b>
            <span className="tc-slash">/</span>
            <b className="tc-product">Acme Cloud ▾</b>
            <span className="tc-env">Production</span>
            <span className="tc-jump">
              Jump to <kbd>⌘K</kbd>
            </span>
            <span className="tc-avatar">AL</span>
          </div>
          <div className="tc-body" aria-hidden="true">
            <nav className="tc-nav">
              {NAV.map(([label, count, tone], i) => (
                <span key={label} className={i === 0 ? 'on' : ''}>
                  {label}
                  {count ? <em className={tone ?? ''}>{count}</em> : null}
                </span>
              ))}
            </nav>
            <div className="tc-main">
              <div className="tc-kpis">
                {KPIS.map(([label, value, note], i) => (
                  <div key={label} className={`tc-kpi${i === 3 ? ' you' : ''}`}>
                    <span>{label}</span>
                    <b>
                      <span className="tc-num" data-to={parseInt(value, 10)} data-suffix={value.replace(/[0-9]/g, '')}>
                        {value}
                      </span>
                      {note ? <em>{note}</em> : null}
                    </b>
                  </div>
                ))}
              </div>
              <div className="tc-maphead">
                <b>Route map</b>
                <span className="tc-legend">
                  <span className="learned">learned</span>
                  <span className="other">other paths</span>
                  <span className="stuck">stuck</span>
                </span>
              </div>
              <svg className="tc-map" viewBox="0 0 820 176">
                <g className="tc-other">
                  <path d="M130 94 C 152 94, 152 144, 175 144" />
                  <path d="M295 144 H340" />
                  <path d="M295 44 C 318 44, 318 94, 340 94" />
                  <path d="M460 94 C 560 94, 600 54, 670 52" />
                </g>
                <g className="tc-learned">
                  <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '0.2s' }} d="M130 94 C 152 94, 152 44, 175 44" />
                  <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '0.45s' }} d="M295 44 H340" />
                  <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '0.7s' }} d="M460 44 H505" />
                  <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '0.95s' }} d="M625 44 H670" />
                  <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '1.2s' }} d="M730 58 V80" />
                </g>
                {NODES.map((n) => (
                  <g key={n.label} className={`tc-node ${n.kind ?? ''}`}>
                    <rect x={n.x} y={n.y} width="120" height="28" rx="7" />
                    <text x={n.x + 60} y={n.y + 18.5}>
                      {n.label}
                    </text>
                  </g>
                ))}
                <rect className="tc-pulse" x="340" y="130" width="120" height="28" rx="7" />
                <circle className="tc-done" cx="797" cy="94" r="7.5" />
                <path d="M793.6 94.2 l2.4 2.4 4.2-4.4" fill="none" stroke="#fff" strokeWidth="1.6" />
                <text className="tc-stuck-note" x="474" y="148.5">
                  38 users stuck this week
                </text>
              </svg>
              <ol className="tc-vroute">
                {ROUTE.map((r, i) => (
                  <li key={r} className={i === ROUTE.length - 1 ? 'end' : ''}>
                    {r}
                  </li>
                ))}
                <li className="stuck">Tax settings · 38 users stuck this week</li>
              </ol>
              <div className="tc-lower">
                <div className="tc-flows">
                  <p className="tc-row head">
                    <span>Workflow</span>
                    <span>Status</span>
                  </p>
                  {FLOWS.map(([name, status, tone]) => (
                    <p className="tc-row" key={name}>
                      <span>{name}</span>
                      <span className={tone}>{status}</span>
                    </p>
                  ))}
                </div>
                <div className="tc-needs">
                  <b>Needs you</b>
                  {NEEDS.map(([tone, text]) => (
                    <p key={text} className={tone}>
                      {text}
                    </p>
                  ))}
                </div>
              </div>
              <p className="tag tc-sample">Sample data</p>
            </div>
          </div>
          <figcaption className="sr-only">
            The Poko console with sample data: a learning score of 82, workflow accuracy of 94 percent, docs answer accuracy
            of 91 percent, a route map showing the learned route from Home to Review, 38 users stuck on Tax settings, and two
            workflows waiting for approval.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
