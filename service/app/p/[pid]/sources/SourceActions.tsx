'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '../../../_ui/icons';
import { postJson } from '../../../_ui/actions';
import { toast } from '../../../_ui/Toaster';

/* Ingest the vendor's help site into the docs corpus. Fetches pages, never calls a model. */
export function IngestDocs({ productId, tool }: { productId: string; tool: string }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [max, setMax] = useState(40);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const go = async () => {
    setBusy(true);
    setResult(null);
    const { ok, data } = await postJson('/api/docs', { productId, url, maxPages: max });
    setBusy(false);
    if (!ok) setResult({ tone: 'bad', text: data.error ?? 'Not ingested.' });
    else if (!data.written) setResult({ tone: 'warn', text: `No pages were taken${data.stoppedBecause ? `: ${data.stoppedBecause}` : ''}.` });
    else {
      setResult({ tone: 'ok', text: `${data.written} pages saved to the ${tool} corpus${data.removed ? `, replacing ${data.removed} from an earlier ingest` : ''}.${data.stoppedBecause ? ` Stopped: ${data.stoppedBecause}.` : ''}` });
      toast('Docs ingested.', 'ok');
      router.refresh();
    }
  };
  return (
    <div className="col" id="ingest">
      <div className="row">
        <input className="input" placeholder="https://help.example.com/docs" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Docs address" />
        <select className="select" style={{ width: 110 }} value={max} onChange={(e) => setMax(Number(e.target.value))} aria-label="Page limit">
          {[10, 25, 40, 60].map((n) => (
            <option key={n} value={n}>
              {n} pages
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={go} disabled={busy || !url.trim()}>
          <Icon name="book" size={14} /> {busy ? 'Reading…' : 'Ingest'}
        </button>
      </div>
      <p className="faint" style={{ fontSize: 11.5 }}>
        Follows robots.txt, stays under the address you give, and stops at the page limit. Free: it reads pages, it calls no model.
      </p>
      {result ? (
        <div className="note" data-tone={result.tone === 'ok' ? 'ok' : result.tone === 'warn' ? 'warn' : 'bad'}>
          {result.text}
        </div>
      ) : null}
    </div>
  );
}

/* Issue a one-time vendor enrollment code, shown once. */
export function IssueCode({ origin }: { origin: string }) {
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    setBusy(true);
    const { ok, data } = await postJson(`/api/enroll?origin=${encodeURIComponent(origin)}`);
    setBusy(false);
    if (!ok) {
      toast(`No code: ${data.error ?? 'unknown error'}`, 'bad');
      return;
    }
    setCode(data);
    router.refresh();
  };
  return (
    <>
      <button className="btn btn-primary" onClick={issue} disabled={busy} id="enroll">
        <Icon name="key" size={14} /> Issue an enrollment code
      </button>
      {code ? (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setCode(null)}>
          <div className="dialog" role="dialog" aria-label="Enrollment code">
            <div className="dialog-h">
              <h2>Vendor enrollment code</h2>
            </div>
            <div className="dialog-b">
              <p className="muted">Enter it once in the extension&apos;s settings on the vendor&apos;s demo browser. It works for one browser, expires {new Date(code.expiresAt).toLocaleString()}, and is not shown again.</p>
              <div className="row">
                <code className="grow" style={{ fontSize: 15, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface-2)' }}>
                  {code.code}
                </code>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(code.code).then(() => toast('Copied'))}>
                  <Icon name="copy" size={14} /> Copy
                </button>
              </div>
            </div>
            <div className="dialog-f">
              <button className="btn btn-primary" onClick={() => setCode(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
