'use client';

import { BrandLogo, type LogoName } from './BrandLogo';
import { LogoMark } from './LogoMark';
import { Sticker } from './Sticker';

/* 04, why Poko, with an opinion. Each alternative gets a verdict, three short hits and
   Poko's answer; then six reasons Poko wins. Phones get every word of it, stacked.
   Logos belong to their owners; the opinions are ours. */
type Rival = {
  kind: string;
  logos?: LogoName[];
  names?: string;
  verdict: string;
  hits: string[];
  answer: string;
  art: 'wander' | 'broken' | 'bubble';
  say: string;
};

const RIVALS: Rival[] = [
  {
    kind: 'AI browser agents',
    logos: ['claude', 'chatgpt', 'comet', 'gemini', 'copilot'],
    verdict: 'Brilliant tourists.',
    hits: ['Every user starts from zero', 'Your user pays. You see nothing', 'One wrong guess hits production'],
    answer: 'Poko is a local, not a tourist',
    art: 'wander',
    say: 'no offense, Claude',
  },
  {
    kind: 'Product tours',
    names: 'WalkMe · Pendo · Appcues · Whatfix',
    verdict: 'Slideshows that go stale.',
    hits: ['Your team scripts every step', 'One release, it points at nothing', 'Users click Next until it’s gone'],
    answer: 'Poko relearns every release',
    art: 'broken',
    say: 'next, next, next…',
  },
  {
    kind: 'Help-center chatbots',
    logos: ['intercom', 'zendesk'],
    verdict: 'Answers aren’t actions.',
    hits: ['A list of steps is homework', 'Knows your docs, not your product', 'Your user still clicks alone'],
    answer: 'Poko does the steps with you',
    art: 'bubble',
    say: 'I read those too',
  },
];

const WINS: [string, string][] = [
  ['Learned, not scripted', 'Real routes from your best users'],
  ['Yours, not your user’s', 'Learned once. Every user gets it'],
  ['Does the work', 'Poko clicks. Your user decides'],
  ['Knows your house rules', 'One bucket, not every bucket'],
  ['Ships when you ship', 'Your UI changes. Poko relearns'],
  ['Safe by default', 'Masked, approved, logged'],
];

function Art({ kind }: { kind: Rival['art'] }) {
  if (kind === 'bubble') {
    return (
      <p className="wy-bubble" aria-hidden="true">
        Go to Settings › Access › Roles, then…
      </p>
    );
  }
  if (kind === 'broken') {
    return (
      <svg className="wy-art" viewBox="0 0 180 40" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
        <path className="solid" d="M4 20 H70" />
        <path className="dashed" d="M96 20 H176" />
        <path className="snap" d="M74 12 L80 20 L74 28 M92 12 L86 20 L92 28" />
        <circle cx="4" cy="20" r="3.5" />
        <circle cx="36" cy="20" r="3.5" />
      </svg>
    );
  }
  return (
    <svg className="wy-art" viewBox="0 0 180 40" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
      <path className="stroke" pathLength={1} d="M4 7 C 30 -2, 44 20, 70 7 S 120 0, 150 13 S 170 7, 176 7" />
      <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '0.25s' }} d="M4 20 C 24 9, 40 33, 64 20 S 96 6, 118 28 S 160 28, 176 20" />
      <path className="stroke" pathLength={1} style={{ ['--delay' as string]: '0.5s' }} d="M4 33 C 40 24, 60 40, 96 31 S 150 37, 176 33" />
    </svg>
  );
}

export function WhyPoko() {
  return (
    <section className="section why" id="why" aria-labelledby="why-title" data-zone data-zone-mood="wink" data-zone-say="no offense, Claude">
      <div className="wrap">
        <header className="sh">
          <h2 className="h2 wy-title" id="why-title">
            Agents guess. Tours break. Chatbots talk. <span className="q">Poko learned your product.</span>
          </h2>
        </header>

        <div className="wy-cards">
          {RIVALS.map((r, i) => (
            <article className="wy-card" key={r.kind} style={{ ['--i' as string]: i }} data-say={r.say}>
              <div className="wy-in">
                <p className="wy-top">
                  <span className="tag">{r.kind}</span>
                  {r.logos ? (
                    <span className="wy-logos">
                      {r.logos.map((l) => (
                        <BrandLogo key={l} name={l} size={17} plain />
                      ))}
                    </span>
                  ) : (
                    <span className="wy-names tag">{r.names}</span>
                  )}
                </p>
                <h3 className="wy-v">{r.verdict}</h3>
                <Art kind={r.art} />
                <ul className="wy-hits">
                  {r.hits.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
              <p className="wy-answer">
                <LogoMark size={16} />
                {r.answer}
              </p>
            </article>
          ))}
        </div>

        <div className="wy-wins">
          <div className="wy-wins-head">
            <h3 className="h3">Why Poko wins</h3>
            <Sticker mood="happy" size={44} rotate={-8} />
          </div>
          <ul className="wy-grid">
            {WINS.map(([title, line]) => (
              <li key={title}>
                <b>{title}</b>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="wy-foot">
          <p className="wy-punch">
            Your users shouldn’t have to hire an AI to use software <span>they already pay for.</span>
          </p>
          <p className="tag">Logos belong to their owners. Opinions are ours.</p>
        </div>
      </div>
    </section>
  );
}
