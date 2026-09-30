'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reducedMotion } from '@/lib/gsap';
import type { Mood } from '@/lib/poko';
import { Sticker } from './Sticker';

/* The hero: Poko doing a hard task with someone, in a console as busy as a real cloud
   provider's. "Do it with me": Poko does the clicks and fills in the boring parts, and
   stops at every decision for a yes. Acme Cloud is made up. The side panel narrates.

   The loop runs while the hero is on screen. With reduced motion it holds on the first
   decision, which says the most in one frame. */

type Screen = 'home' | 'users' | 'create' | 'perms' | 'policy' | 'review' | 'done';

type State = {
  screen: Screen;
  crumb: string;
  nav: 'users' | 'policies' | null;
  ask: string;
  say: string;
  search: string;
  results: boolean;
  name: string;
  consoleAccess: boolean;
  attach: boolean;
  json: number;
  step: number;
  decision: 0 | 1 | 2;
  choice: boolean;
  poko: string | null;
  mood: Mood;
  user: string | null;
  taps: number;
  clicks: number;
};

const ASK = 'Give Dana read-only access to billing-reports';
const RESOURCE = '"acme:storage:::billing-reports/*"';
const LOOP = 21500;

const START: State = {
  screen: 'home',
  crumb: 'Console home',
  nav: null,
  ask: '',
  say: '',
  search: '',
  results: false,
  name: '',
  consoleAccess: false,
  attach: false,
  json: 0,
  step: 0,
  decision: 0,
  choice: false,
  poko: null,
  mood: 'happy',
  user: null,
  taps: 0,
  clicks: 0,
};

const HOLD: State = {
  ...START,
  screen: 'perms',
  crumb: 'Identity › Users › Create user › Set permissions',
  nav: 'users',
  ask: ASK,
  say: 'Your call. I’d keep it to one bucket.',
  name: 'dana',
  consoleAccess: true,
  attach: true,
  step: 2,
  decision: 1,
  poko: 'pick',
  mood: 'think',
};

const STEPS = [
  'Open Identity › Users',
  'Start a user for Dana',
  'Your call: what Dana can read',
  'Write a one-bucket policy',
  'Your call: create it all',
];

const SERVICES = [
  'Compute', 'Storage', 'Databases', 'Networking', 'Identity', 'Billing',
  'Monitoring', 'Queues', 'Functions', 'Containers', 'Analytics', 'Secrets',
  'DNS', 'CDN', 'Backups', 'Logs', 'Events',
];

const USERS: [string, string, string, string][] = [
  ['ops-admin', 'Admins', 'now', 'Virtual'],
  ['ci-deploy', 'None', '4 min ago', 'None'],
  ['lin', 'Developers', '2 days ago', 'Virtual'],
  ['ravi', 'Developers', '9 days ago', 'None'],
  ['backup-bot', 'None', '1 hour ago', 'None'],
];

const POLICIES: [string, string, string][] = [
  ['StorageReadOnly', 'Read every bucket', '41 users'],
  ['StorageFullAccess', 'Read and write every bucket', '8 users'],
  ['BillingViewer', 'See invoices and usage', '3 users'],
  ['ComputeReadOnly', 'See instances', '12 users'],
];

/* Poko's tip sits at (34, 18) in its 120 box, like the site's own cursor. */
const SIZE = 40;
const TIP_X = (34 / 120) * SIZE;
const TIP_Y = (18 / 120) * SIZE;

export function HeroConsole() {
  const [s, setS] = useState<State>(START);
  const stage = useRef<HTMLDivElement>(null);
  const pokoEl = useRef<HTMLDivElement>(null);
  const userEl = useRef<HTMLDivElement>(null);
  const pokoRip = useRef<HTMLSpanElement>(null);
  const userRip = useRef<HTMLSpanElement>(null);
  const tips = useRef({ poko: { x: 0, y: 0 }, user: { x: 0, y: 0 } });
  const targets = useRef({ poko: s.poko, user: s.user });
  targets.current = { poko: s.poko, user: s.user };

  /* The script. Each beat patches the state; typing is a run of small beats. */
  useEffect(() => {
    if (reducedMotion()) {
      setS(HOLD);
      return;
    }
    const el = stage.current;
    let timers: number[] = [];
    let running = false;
    const at = (ms: number, patch: Partial<State> | ((p: State) => Partial<State>)) =>
      timers.push(window.setTimeout(() => setS((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) })), ms));
    const type = (from: number, key: 'ask' | 'search' | 'name', text: string, every: number) =>
      text.split('').forEach((_, i) => at(from + i * every, { [key]: text.slice(0, i + 1) } as Partial<State>));
    const tap = (ms: number) => at(ms, (p) => ({ taps: p.taps + 1 }));
    const click = (ms: number) => at(ms, (p) => ({ clicks: p.clicks + 1 }));
    const stop = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
    };

    const run = () => {
      stop();
      setS(START);
      type(300, 'ask', ASK, 26);
      at(1700, { say: 'On it. I’ll click, you decide.' });
      at(2300, { poko: 'search' });
      tap(2800);
      type(2900, 'search', 'identity', 55);
      at(3400, { results: true, poko: 'result' });
      tap(3900);
      at(4050, { screen: 'users', crumb: 'Identity › Users', nav: 'users', results: false, search: '', step: 1 });
      at(4400, { poko: 'create' });
      tap(4850);
      at(5000, { screen: 'create', crumb: 'Identity › Users › Create user', poko: 'name' });
      type(5500, 'name', 'dana', 110);
      at(6100, { poko: 'console' });
      tap(6550);
      at(6600, { consoleAccess: true });
      at(6850, { poko: 'next' });
      tap(7300);
      at(7450, { screen: 'perms', crumb: 'Identity › Users › Create user › Set permissions', step: 2, poko: 'attach' });
      tap(7950);
      at(8000, { attach: true });
      at(8500, { decision: 1, poko: 'pick', mood: 'think', say: 'Your call. I’d keep it to one bucket.' });
      at(9500, { user: 'opt-rec' });
      click(10150);
      at(10200, { choice: true });
      at(10600, { user: 'approve' });
      click(11200);
      at(11350, {
        decision: 0,
        user: null,
        step: 3,
        mood: 'happy',
        say: 'Got it. A policy for just that bucket.',
        poko: 'create-policy',
      });
      tap(11850);
      at(12000, { screen: 'policy', crumb: 'Identity › Policies › Create policy', nav: 'policies', poko: 'json' });
      RESOURCE.split('').forEach((_, i) => at(12350 + i * 36, { json: i + 1 }));
      at(14000, {
        screen: 'review',
        crumb: 'Identity › Users › Create user › Review',
        nav: 'users',
        step: 4,
        decision: 2,
        poko: 'rev-perm',
        mood: 'think',
        say: 'Last call: create both?',
      });
      at(14900, { user: 'approve' });
      click(15500);
      at(15650, { decision: 0, user: null, step: 5, mood: 'happy', say: 'Creating them now.', poko: 'create-final' });
      tap(16150);
      at(16300, {
        screen: 'done',
        crumb: 'Identity › Users',
        step: 5,
        poko: 'dana-row',
        mood: 'wink',
        say: 'Done. Dana can read that one bucket.',
      });
      timers.push(window.setTimeout(run, LOOP));
    };

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !running) {
          running = true;
          run();
        } else if (!e.isIntersecting && running) {
          running = false;
          stop();
        }
      },
      { threshold: 0.2 },
    );
    if (el) io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);

  /* Put Poko's tip, and the person's cursor, on whatever each of them is working with.
     Poko points near the right of a target and the person clicks near the left, so the
     two never sit on top of each other. */
  const place = () => {
    const root = stage.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    /* The page may tilt or scale the console on scroll: measure on screen, then convert
       back to the console's own units so the cursors land where the targets are. */
    const kx = box.width / (root.offsetWidth || box.width || 1);
    const ky = box.height / (root.offsetHeight || box.height || 1);
    const put = (who: 'poko' | 'user', el: HTMLElement | null, key: string | null, tipX: number, tipY: number, along: number) => {
      if (!el) return;
      if (!key) {
        el.classList.remove('on');
        return;
      }
      const t = root.querySelector<HTMLElement>(`[data-t="${key}"]`);
      if (!t) return;
      const r = t.getBoundingClientRect();
      let x = (r.left - box.left + Math.min(r.width * along, r.width - 8)) / kx;
      let y = (r.top - box.top + r.height * 0.6) / ky;
      /* Some targets are text Poko is writing or pointing at: sit just past the end of
         its last line. */
      if (who === 'poko' && t.dataset.at === 'end') {
        const range = document.createRange();
        range.selectNodeContents(t);
        const lines = range.getClientRects();
        const last = lines[lines.length - 1] ?? range.getBoundingClientRect();
        x = Math.min((last.right - box.left) / kx + 8, root.offsetWidth - (SIZE - TIP_X) - 4);
        y = (last.top - box.top + last.height * 0.6) / ky;
      }
      tips.current[who] = { x, y };
      const shown = el.classList.contains('on');
      if (!shown) el.style.transition = 'none';
      el.style.transform = `translate(${(x - tipX).toFixed(1)}px, ${(y - tipY).toFixed(1)}px)`;
      if (!shown) {
        void el.offsetWidth;
        el.style.transition = '';
      }
      el.classList.add('on');
    };
    put('poko', pokoEl.current, targets.current.poko, TIP_X, TIP_Y, 0.72);
    put('user', userEl.current, targets.current.user, 2, 1, 0.3);
  };

  useLayoutEffect(place, [s.poko, s.user, s.screen, s.decision, s.results, s.name, s.json]);

  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(root);
    const main = root.querySelector('.hc-main');
    if (main) ro.observe(main);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A tap: a ring from the tip, and a small squish. */
  const ring = (rip: HTMLSpanElement | null, who: HTMLElement | null, at: { x: number; y: number }) => {
    if (!rip || !who) return;
    rip.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
    for (const el of [rip, who]) {
      el.classList.remove('go');
      void el.offsetWidth;
      el.classList.add('go');
    }
  };
  useEffect(() => {
    if (s.taps) ring(pokoRip.current, pokoEl.current, tips.current.poko);
  }, [s.taps]);
  useEffect(() => {
    if (s.clicks) ring(userRip.current, userEl.current, tips.current.user);
  }, [s.clicks]);

  const on = (k: Screen) => (s.screen === k ? ' on' : '');

  const decisions = {
    2: (
      <div className="hc-dec">
        <p className="hc-opt">
          <span className="hc-radio" />
          <span>
            Every bucket
            <small>StorageReadOnly · includes prod</small>
          </span>
        </p>
        <p className={`hc-opt${s.choice ? ' picked' : ''}`} data-t="opt-rec">
          <span className={`hc-radio${s.choice ? ' on' : ''}`} />
          <span>
            Only billing-reports{' '}
            <em data-t="pick" data-at="end">
              Poko’s pick
            </em>
            <small>Your admins pick this 9 in 10</small>
          </span>
        </p>
        <div className="hc-dec-row">
          <span className={`hc-approve${s.choice ? ' ready' : ''}`} data-t="approve">
            Approve
          </span>
          <span className="hc-else">or tell Poko something else</span>
        </div>
      </div>
    ),
    4: (
      <div className="hc-dec">
        <p className="hc-dec-q">
          Create policy <b>billing-reports-read</b> and user <b>dana</b>?
        </p>
        <div className="hc-dec-row">
          <span className="hc-approve ready" data-t="approve">
            Approve
          </span>
          <span className="hc-else">or go back a step</span>
        </div>
      </div>
    ),
  } as const;
  const open = s.decision === 1 ? 2 : s.decision === 2 ? 4 : -1;
  const card = open === 2 || open === 4 ? decisions[open] : null;

  return (
    <div className="hc" ref={stage} aria-hidden="true" data-say="that’s me in there!" data-say-mood="wink">
      <div className="hc-top">
        <span className="hc-logo">A</span>
        <b className="hc-brand">Acme Cloud</b>
        <span className="hc-menu">Services ▾</span>
        <span className="hc-search-in">
          <span className="hc-search" data-t="search">
            {s.search ? <span>{s.search}</span> : <span className="hc-ph">Search 214 services, features, docs</span>}
            <kbd>/</kbd>
          </span>
          {s.results ? (
            <span className="hc-drop">
              <span className="hc-drop-h">Services</span>
              <span className="hc-drop-i" data-t="result">
                <b>Identity</b> Users, roles and access
              </span>
              <span className="hc-drop-i">
                <b>Identity Center</b> Single sign-on
              </span>
              <span className="hc-drop-h">Docs</span>
              <span className="hc-drop-i">
                <b>Identity policies</b> Reference
              </span>
            </span>
          ) : null}
        </span>
        <span className="hc-meta">us-east-1 ▾</span>
        <span className="hc-meta">ops-admin ▾</span>
      </div>
      <div className="hc-crumb">{s.crumb}</div>

      <div className={`hc-body${s.nav ? '' : ' nonav'}`}>
        <nav className="hc-nav">
          <b className="hc-nav-t">Identity</b>
          <span>Dashboard</span>
          <span className="hc-nav-h">Access management</span>
          <span>User groups</span>
          <span className={s.nav === 'users' ? 'on' : ''}>Users</span>
          <span>Roles</span>
          <span className={s.nav === 'policies' ? 'on' : ''}>Policies</span>
          <span>Identity providers</span>
          <span>Account settings</span>
          <span className="hc-nav-h">Access reports</span>
          <span>Access analyzer</span>
          <span>Credential report</span>
          <span>Service control policies</span>
        </nav>

        <div className="hc-main">
          <div className={`hc-scr${on('home')}`}>
            <p className="hc-h">Console home</p>
            <p className="hc-label">Recently visited</p>
            <div className="hc-tiles four">
              {['Billing', 'Compute', 'Logs', 'Storage'].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <p className="hc-label">All services</p>
            <div className="hc-tiles">
              {SERVICES.map((t) => (
                <span key={t}>{t}</span>
              ))}
              <span className="dim">+ 197 more</span>
            </div>
          </div>

          <div className={`hc-scr${on('users')}`}>
            <div className="hc-row">
              <p className="hc-h">Users (5)</p>
              <span className="hc-grow" />
              <span className="hc-b">Delete</span>
              <span className="hc-b dark" data-t="create">
                Create user
              </span>
            </div>
            <span className="hc-find">Find users by name or access key</span>
            <div className="hc-tbl">
              <div className="hc-tr head">
                <span>User name</span>
                <span>Groups</span>
                <span>Last activity</span>
                <span>MFA</span>
              </div>
              {USERS.map((u) => (
                <div className="hc-tr" key={u[0]}>
                  {u.map((c, i) => (
                    <span key={i}>{c}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className={`hc-scr${on('create')}`}>
            <p className="hc-sub">Step 1 of 3</p>
            <p className="hc-h">Specify user details</p>
            <div className="hc-panel">
              <p className="hc-label">User name</p>
              <span className="hc-field" data-t="name" data-at="end">
                {s.name}
                {s.screen === 'create' && s.name.length < 4 ? <i className="hc-caret" /> : null}
              </span>
              <p className="hc-hint">Up to 64 letters, numbers and + = , . @ _ -</p>
              <p className="hc-check" data-t="console">
                <span className={`hc-box${s.consoleAccess ? ' on' : ''}`}>{s.consoleAccess ? '✓' : ''}</span>
                Provide user access to the console
              </p>
              <p className="hc-check dim">
                <span className="hc-radio on" /> Autogenerated password
              </p>
              <p className="hc-check dim">
                <span className="hc-radio" /> Custom password
              </p>
            </div>
            <div className="hc-row end">
              <span className="hc-b">Cancel</span>
              <span className="hc-b dark" data-t="next">
                Next
              </span>
            </div>
          </div>

          <div className={`hc-scr${on('perms')}`}>
            <p className="hc-sub">Step 2 of 3</p>
            <p className="hc-h">Set permissions</p>
            <div className="hc-opts">
              <span>
                <span className="hc-radio" /> Add user to group
              </span>
              <span>
                <span className="hc-radio" /> Copy permissions
              </span>
              <span className={s.attach ? 'on' : ''} data-t="attach">
                <span className={`hc-radio${s.attach ? ' on' : ''}`} /> Attach policies directly
              </span>
            </div>
            <div className="hc-row">
              <p className="hc-label">Permissions policies (1,124)</p>
              <span className="hc-grow" />
              <span className="hc-b" data-t="create-policy">
                Create policy ↗
              </span>
            </div>
            <div className="hc-tbl">
              <div className="hc-tr three head">
                <span>Policy name</span>
                <span>What it allows</span>
                <span>Attached to</span>
              </div>
              {POLICIES.map((p) => (
                <div className={`hc-tr three${p[0] === 'StorageReadOnly' && s.decision === 1 ? ' risk' : ''}`} key={p[0]}>
                  <span>
                    <span className="hc-box" /> {p[0]}
                  </span>
                  <span>{p[1]}</span>
                  <span>{p[2]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`hc-scr${on('policy')}`}>
            <p className="hc-sub">Policies › Create policy</p>
            <p className="hc-h">billing-reports-read</p>
            <div className="hc-seg">
              <span>Visual</span>
              <span className="on">JSON</span>
            </div>
            <div className="hc-code">
              <p>
                <span className="n">1</span>
                {'{'}
              </p>
              <p>
                <span className="n">2</span>
                {'  '}
                <b>&quot;Effect&quot;</b>: <em>&quot;Allow&quot;</em>,
              </p>
              <p>
                <span className="n">3</span>
                {'  '}
                <b>&quot;Action&quot;</b>: [<em>&quot;storage:Get*&quot;</em>, <em>&quot;storage:List*&quot;</em>],
              </p>
              <p className={s.screen === 'policy' && s.json < RESOURCE.length ? 'typing' : ''} data-t="json" data-at="end">
                <span className="n">4</span>
                {'  '}
                <b>&quot;Resource&quot;</b>: <em>{RESOURCE.slice(0, s.json)}</em>
                {s.screen === 'policy' && s.json < RESOURCE.length ? <i className="hc-caret" /> : null}
              </p>
              <p>
                <span className="n">5</span>
                {'}'}
              </p>
            </div>
          </div>

          <div className={`hc-scr${on('review')}`}>
            <p className="hc-sub">Step 3 of 3</p>
            <p className="hc-h">Review and create</p>
            <div className="hc-tbl">
              <div className="hc-tr two">
                <span>User name</span>
                <span>dana</span>
              </div>
              <div className="hc-tr two">
                <span>Console access</span>
                <span>Enabled, autogenerated password</span>
              </div>
              <div className="hc-tr two">
                <span>Permissions</span>
                <span data-t="rev-perm" data-at="end">
                  billing-reports-read · 1 bucket, read only
                </span>
              </div>
              <div className="hc-tr two">
                <span>Tags</span>
                <span>None</span>
              </div>
            </div>
            <div className="hc-row end">
              <span className="hc-b">Previous</span>
              <span className="hc-b dark" data-t="create-final">
                Create user
              </span>
            </div>
          </div>

          <div className={`hc-scr${on('done')}`}>
            <p className="hc-ok">✓ User dana created, with policy billing-reports-read</p>
            <p className="hc-h">Users (6)</p>
            <div className="hc-tbl">
              <div className="hc-tr head">
                <span>User name</span>
                <span>Groups</span>
                <span>Last activity</span>
                <span>MFA</span>
              </div>
              <div className="hc-tr new">
                <span data-t="dana-row" data-at="end">
                  dana
                </span>
                <span>None</span>
                <span>just now</span>
                <span>None</span>
              </div>
              {USERS.slice(0, 4).map((u) => (
                <div className="hc-tr" key={u[0]}>
                  {u.map((c, i) => (
                    <span key={i}>{c}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="hc-side">
          <div className="hc-side-h">
            <Sticker mood="happy" size={28} rotate={-8} />
            <b>Poko</b>
            <span className="hc-mode">doing it with you</span>
          </div>
          <div className="hc-chat">
            {s.ask ? (
              <p className="hc-ask">
                {s.ask}
                {s.ask.length < ASK.length ? <i className="hc-caret" /> : null}
              </p>
            ) : (
              <p className="hc-ask empty">Ask Poko to do something…</p>
            )}
            {s.say ? (
              <p className="hc-say" key={s.say}>
                {s.say}
              </p>
            ) : null}
          </div>
          <ol className="hc-steps">
            {STEPS.map((t, i) => (
              <li
                key={t}
                className={`${i < s.step ? 'done' : i === s.step && s.ask === ASK ? 'now' : ''}${i === open ? ' ask' : ''}${t.startsWith('Your call') ? ' call' : ''}`}
              >
                <span className="hc-dot">
                  <span>{i < s.step ? '✓' : ''}</span>
                </span>
                <span>{t}</span>
                {i === open ? card : null}
              </li>
            ))}
          </ol>
          {s.screen === 'done' ? <p className="hc-sum">2 decisions · 2 minutes · no ticket</p> : null}
        </aside>
      </div>

      <span className="hc-rip" ref={pokoRip}>
        <i />
      </span>
      <span className="hc-rip user" ref={userRip}>
        <i />
      </span>
      <div className="hc-uc" ref={userEl}>
        <svg viewBox="0 0 14 16" width="15" height="17">
          <path d="M1 1 L12 7.5 L7 8.8 L4.6 14 Z" fill="#171510" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="hc-pk" ref={pokoEl} style={{ width: SIZE, height: SIZE }}>
        <Sticker mood={s.mood} size={SIZE} />
      </div>
    </div>
  );
}
