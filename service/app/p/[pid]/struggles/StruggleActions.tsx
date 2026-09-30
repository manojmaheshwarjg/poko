'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '../../../_ui/icons';
import { postJson } from '../../../_ui/actions';
import { toast } from '../../../_ui/Toaster';

type Struggle = { id: string; title: string; screenId: string; screenName: string; kind: string };

/* The two ways a struggle becomes something checked: a scenario the next comparison
   runs, or a note of what the docs leave out. Both are prefilled from what happened
   and neither makes a model call. */
export function StruggleActions({
  productId,
  struggle,
  nextName,
  fixture,
  openNote,
}: {
  productId: string;
  struggle: Struggle | null;
  nextName: string | null;
  fixture: Array<{ key: string; heading: string }>;
  openNote: { id: string; name: string } | null;
}) {
  const [dialog, setDialog] = useState<'scenario' | 'gap' | null>(openNote ? 'gap' : null);
  const gapScreen = openNote ?? (struggle ? { id: struggle.screenId, name: struggle.screenName } : null);
  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {struggle ? (
          <button className="btn" onClick={() => setDialog('scenario')}>
            <Icon name="target" size={14} /> Evaluation scenario
          </button>
        ) : null}
        <button className="btn" onClick={() => setDialog('gap')}>
          <Icon name="note" size={14} /> Docs gap note
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          A scenario runs in the next comparison. A note is kept with the screen.
        </span>
      </div>
      {dialog === 'scenario' && struggle ? <ScenarioDialog productId={productId} struggle={struggle} nextName={nextName} fixture={fixture} onClose={() => setDialog(null)} /> : null}
      {dialog === 'gap' && gapScreen ? <GapDialog productId={productId} screen={gapScreen} struggle={struggle} nextName={nextName} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function ScenarioDialog({
  productId,
  struggle,
  nextName,
  fixture,
  onClose,
}: {
  productId: string;
  struggle: Struggle;
  nextName: string | null;
  fixture: Array<{ key: string; heading: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const start = fixture.find((f) => f.heading.toLowerCase() === struggle.screenName.toLowerCase())?.key ?? fixture[0]?.key ?? '';
  const [goal, setGoal] = useState('');
  const [from, setFrom] = useState(start);
  const [reach, setReach] = useState(struggle.kind === 'backtrack' && nextName ? nextName : '');
  const [mustNot, setMustNot] = useState('');
  const [outcome, setOutcome] = useState('plan');
  const [why, setWhy] = useState(`Added from a struggle on ${struggle.screenName}: ${struggle.title}.`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (goal.trim().length < 8) {
      setError('Write the request the way a person would ask it.');
      return;
    }
    setBusy(true);
    const { ok, data } = await postJson('/api/scenarios', {
      productId,
      goal,
      from,
      outcome,
      routeShouldReach: reach.trim() || null,
      mustNotTouch: mustNot.split(',').map((s) => s.trim()).filter(Boolean),
      why,
    });
    setBusy(false);
    if (!ok) {
      setError(data.error ?? 'It was not added.');
      return;
    }
    toast(`Added ${data.id}. It runs in the next comparison.`, 'ok');
    onClose();
    router.refresh();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Add to the evaluation" onKeyDown={(e) => e.key === 'Escape' && onClose()} style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="dialog-h">
          <h2>Add to the evaluation</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            Prefilled from what happened. The request is yours to write: requests are never recorded, only what people did.
          </p>
        </div>
        <div className="dialog-b">
          <label className="field">
            <span>Request</span>
            <input className="input" autoFocus value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Make contractors read only, but only for this project" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field">
              <span>Starts on</span>
              <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
                {fixture.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.heading} ({f.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>A good plan ends as</span>
              <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="plan">a plan</option>
                <option value="partial">partial, saying what it cannot do</option>
                <option value="cannot">cannot be done</option>
                <option value="nothing_to_do">nothing to do</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>A good plan goes through (optional)</span>
            <input className="input" value={reach} onChange={(e) => setReach(e.target.value)} placeholder="Copy scheme" />
          </label>
          <label className="field">
            <span>Must not change (comma separated, optional)</span>
            <input className="input" value={mustNot} onChange={(e) => setMustNot(e.target.value)} placeholder="Browse projects for Contractors" />
          </label>
          <label className="field">
            <span>Why this scenario</span>
            <textarea className="textarea" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          {error ? (
            <div className="note" data-tone="bad">
              {error}
            </div>
          ) : null}
        </div>
        <div className="dialog-f">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            Add scenario
          </button>
        </div>
      </div>
    </div>
  );
}

function GapDialog({
  productId,
  screen,
  struggle,
  nextName,
  onClose,
}: {
  productId: string;
  screen: { id: string; name: string };
  struggle: Struggle | null;
  nextName: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const lead = struggle && struggle.screenId === screen.id ? `${struggle.title}.${nextName ? ` Most went on to ${nextName} next.` : ''} ` : '';
  const [note, setNote] = useState(`${lead}The docs do not say `);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const { ok, data } = await postJson('/api/gaps', { productId, screenId: screen.id, note, source: struggle ? `struggle:${struggle.id}` : 'map' });
    if (!ok) {
      setError(data.error ?? 'It was not saved.');
      return;
    }
    toast('Noted against ' + screen.name + '.', 'ok');
    onClose();
    router.refresh();
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Note a docs gap" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-h">
          <h2>Note a docs gap on {screen.name}</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            Something the docs leave out. It is kept with the screen and shown on the Docs source page.
          </p>
        </div>
        <div className="dialog-b">
          <textarea className="textarea" rows={4} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? (
            <div className="note" data-tone="bad">
              {error}
            </div>
          ) : null}
        </div>
        <div className="dialog-f">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
