'use client';

import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { answer, FAQ, HINTS, SUGGESTED, type Faq as Item } from '@/lib/faq';
import { reducedMotion } from '@/lib/gsap';
import type { Mood } from '@/lib/poko';
import { goTo } from '@/lib/scroll';
import { useInView } from '@/lib/useInView';
import { EmailForm } from './EmailForm';
import { Icon } from './Icon';
import { SectionHead } from './SectionHead';
import { Sticker } from './Sticker';

type State = 'idle' | 'thinking' | 'answer' | 'unknown';

/* 07, questions: ask Poko, or read the answers beside it. The asking is scripted keyword
   matching, and honest when it doesn't know: then the question goes to a person, with
   the visitor's email. */

/* Types example questions into the empty field while it's on screen and untouched. */
function useTypedHint(active: boolean) {
  const [hint, setHint] = useState(HINTS[0]);
  useEffect(() => {
    if (!active || reducedMotion()) return;
    let idx = 0;
    let pos = HINTS[0].length;
    let phase: 'hold' | 'erase' | 'type' = 'hold';
    let wait = 50;
    const id = window.setInterval(() => {
      if (phase === 'hold') {
        wait -= 1;
        if (wait <= 0) phase = 'erase';
        return;
      }
      if (phase === 'erase') {
        pos = Math.max(0, pos - 3);
        setHint(HINTS[idx].slice(0, pos));
        if (pos === 0) {
          idx = (idx + 1) % HINTS.length;
          phase = 'type';
        }
        return;
      }
      pos += 1;
      setHint(HINTS[idx].slice(0, pos));
      if (pos >= HINTS[idx].length) {
        phase = 'hold';
        wait = 50;
      }
    }, 45);
    return () => window.clearInterval(id);
  }, [active]);
  return hint;
}

function Ask() {
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box, { threshold: 0.5, once: false });
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [hit, setHit] = useState<Item | null>(null);
  const [asked, setAsked] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const hint = useTypedHint(inView && !q && !focused);

  function run(question: string) {
    const text = question.trim();
    if (!text) return;
    setAsked(text);
    setState('thinking');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const found = answer(text);
      setHit(found);
      setState(found ? 'answer' : 'unknown');
    }, 700);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run(q);
  }

  const mood: Mood =
    state === 'thinking' || (focused && q && state === 'idle') ? 'think' : state === 'unknown' ? 'confused' : state === 'answer' ? 'happy' : 'idle';

  return (
    <div className="fq-box" ref={box}>
      <form className="fq-form" onSubmit={submit}>
        <Sticker mood={mood} size={30} naps={false} className="fq-poko" />
        <label className="sr-only" htmlFor="faq-input">
          Ask Poko a question
        </label>
        <input
          id="faq-input"
          className="fq-field"
          placeholder={hint}
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (state !== 'thinking') setState('idle');
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <button type="submit" className="fq-send" aria-label="Ask Poko">
          <Icon name="arrow" size={16} />
        </button>
      </form>
      <div className="fq-chips">
        {SUGGESTED.map((s) => (
          <button
            type="button"
            key={s}
            className="fq-chip"
            onClick={() => {
              setQ(s);
              run(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="fq-out" aria-live="polite">
        {state === 'thinking' ? <p className="fq-thinking tag">Poko is thinking…</p> : null}
        {state === 'answer' && hit ? (
          <div className="fq-answer">
            <p className="fq-q">{hit.q}</p>
            <p>{hit.a}</p>
            {hit.section ? (
              <button type="button" className="fq-go" onClick={() => goTo(hit.section!)}>
                Take me there <Icon name="arrow" size={13} />
              </button>
            ) : null}
          </div>
        ) : null}
        {state === 'unknown' ? (
          <div className="fq-answer">
            <p>I haven’t learned that one yet. Leave your email and a person on the team will answer it.</p>
            <EmailForm id="faq-email" label="Send" question={asked} done="Thanks. The team will reply to you directly." />
          </div>
        ) : null}
      </div>
      <p className="fq-human tag">A person answers what Poko can’t.</p>
    </div>
  );
}

const List = memo(function List() {
  return (
    <div className="fq-list">
      {FAQ.map((f, i) => (
        <details key={f.q} className="fq-item" open={i === 0}>
          <summary>
            <span>{f.q}</span>
            <Icon name="plus" size={16} />
          </summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
});

export function Faq() {
  return (
    <section className="section alt faq" id="faq" aria-labelledby="faq-title" data-zone data-zone-mood="think" data-zone-say="ask me anything">
      <div className="wrap fq">
        <div className="fq-side">
          <SectionHead n="07" label="FAQ" id="faq-title" title="Questions, answered." quiet="Ask Poko, or read on." />
          <Ask />
        </div>
        <List />
      </div>
    </section>
  );
}
