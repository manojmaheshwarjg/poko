'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Props = {
  id: string;
  label?: string;
  /* A question Ask Poko couldn't answer, sent along with the email. */
  question?: string;
  done: string;
  onTyping?: (typing: boolean) => void;
  onDone?: () => void;
  /* Label above the field and the button under it, as in the hero. */
  stacked?: boolean;
  fieldLabel?: string;
  placeholder?: string;
};

/* Email plus one button. Posts to /api/early-access, with a honeypot for bots. */
export function EmailForm({ id, label = 'Join', question, done, onTyping, onDone, stacked = false, fieldLabel, placeholder = 'you@company.com' }: Props) {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setState('error');
      setError('Enter a valid work email.');
      return;
    }
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: value, website, question }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState('error');
        setError(body.error ?? "Couldn’t save that. Try again.");
        return;
      }
      setState('done');
      onTyping?.(false);
      onDone?.();
    } catch {
      setState('error');
      setError("Couldn’t reach the server. Try again.");
    }
  }

  if (state === 'done') {
    return (
      <p className="form-done" role="status">
        <Icon name="check" size={16} />
        {done}
      </p>
    );
  }

  return (
    <div className="form-wrap">
      <form className={`email-form${stacked ? ' stack' : ''}`} onSubmit={submit} noValidate>
        <label className={fieldLabel ? 'form-label' : 'sr-only'} htmlFor={id}>
          {fieldLabel ?? 'Work email'}
        </label>
        <input
          id={id}
          className="field"
          type="email"
          autoComplete="email"
          placeholder={placeholder}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            onTyping?.(e.target.value.length > 0);
            if (state === 'error') {
              setState('idle');
              setError('');
            }
          }}
          onFocus={() => onTyping?.(true)}
          onBlur={() => onTyping?.(false)}
          aria-invalid={state === 'error'}
          aria-describedby={state === 'error' ? `${id}-error` : undefined}
        />
        <div className="hp" aria-hidden="true">
          <label htmlFor={`${id}-website`}>Leave this empty</label>
          <input id={`${id}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <button className="btn btn-brand" type="submit" disabled={state === 'sending'} data-poko-point>
          {state === 'sending' ? 'Sending…' : label}
        </button>
      </form>
      {state === 'error' ? (
        <p className="form-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
