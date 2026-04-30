'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Kind = 'event' | 'draft' | 'post';
type Rating = 'signal' | 'noise' | null;

type Feedback = {
  feedback: 'signal' | 'noise' | null;
  feedback_reason: string | null;
  feedback_note: string | null;
};

const REASONS = {
  event: {
    signal: [
      'Ship-worthy now',
      'Good context',
      'Worth drafting against',
      'Just interesting',
      'Aligns with Khanna lanes',
      'Surprising/contrarian',
    ],
    noise: [
      'Wrong topic',
      'Off-tone for Khanna',
      'Stale/already covered',
      'Too generic',
      'Off-message',
      'Wrong messenger',
      'RT-style content',
      'Cheerleading/booking bait',
    ],
  },
  draft: {
    signal: [
      'Sharp angle',
      'Contrarian take',
      'Aligned with Khanna voice',
      'Unique framing',
      'Strong hook',
      'Worth drafting variants',
    ],
    noise: [
      'Generic angle',
      'Off-message',
      'Wrong tone',
      'Too obvious',
      "Doesn't fit Khanna voice",
      'Already covered angle',
    ],
  },
  post: {
    signal: [
      'Ship-ready as is',
      'Nails the voice',
      'Strong opener',
      'Punchy',
      'Good with light edits',
    ],
    noise: [
      'Off-tone',
      'Too long',
      'Too generic',
      'Wrong angle execution',
      'Awkward phrasing',
      'Misquotes/inaccurate',
    ],
  },
};

export default function RatingForm({
  kind,
  targetId,
  current,
  size = 'md',
}: {
  kind: Kind;
  targetId: number;
  current: Feedback;
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState<Rating>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openForm = (r: 'signal' | 'noise') => {
    setReason(current.feedback === r ? current.feedback_reason || '' : '');
    setNote(current.feedback === r ? current.feedback_note || '' : '');
    setErrorMsg(null);
    setFormOpen(r);
  };

  const submit = async (rating: Rating) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          target_id: targetId,
          rating,
          reason: rating ? reason || null : null,
          note: rating ? note || null : null,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setFormOpen(null);
      router.refresh();
    } catch (e: any) {
      setErrorMsg(e.message || 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClick = (r: 'signal' | 'noise') => {
    if (current.feedback === r) submit(null); // unrate
    else openForm(r);
  };

  const reasonOpts = formOpen ? REASONS[kind][formOpen] : [];

  const btnSize = size === 'sm' ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => handleClick('signal')}
          disabled={saving}
          className={`${btnSize} rounded border transition ${
            current.feedback === 'signal'
              ? 'bg-green-500/20 border-green-500/60 text-green-200'
              : 'border-neutral-700 hover:border-green-500/50'
          }`}
        >
          👍 Signal
        </button>
        <button
          type="button"
          onClick={() => handleClick('noise')}
          disabled={saving}
          className={`${btnSize} rounded border transition ${
            current.feedback === 'noise'
              ? 'bg-red-500/20 border-red-500/60 text-red-200'
              : 'border-neutral-700 hover:border-red-500/50'
          }`}
        >
          👎 Noise
        </button>
        {current.feedback && !formOpen && (
          <span className="text-xs opacity-70 ml-1">
            <span className={current.feedback === 'signal' ? 'text-green-300' : 'text-red-300'}>
              ✓ {current.feedback}
            </span>
            {current.feedback_reason ? <> — {current.feedback_reason}</> : null}
          </span>
        )}
      </div>

      {current.feedback && current.feedback_note && !formOpen && (
        <div className="text-xs opacity-60 italic">"{current.feedback_note}"</div>
      )}

      {formOpen && (
        <div className="border-t border-neutral-800 pt-2 space-y-2">
          <div className="text-xs opacity-70">
            Rate as <strong className={formOpen === 'signal' ? 'text-green-300' : 'text-red-300'}>{formOpen}</strong>
            {current.feedback === formOpen && <span className="opacity-50"> — editing</span>}
          </div>
          <select
            value={reason}
            onChange={ev => setReason(ev.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-xs"
          >
            <option value="">Reason (optional)</option>
            {reasonOpts.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={ev => setNote(ev.target.value.slice(0, 280))}
            rows={2}
            placeholder="Optional note — what should Claude learn from this?"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => submit(formOpen)}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save rating'}
            </button>
            <button
              type="button"
              onClick={() => { setFormOpen(null); setErrorMsg(null); }}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Cancel
            </button>
            <span className="text-xs opacity-40 ml-auto">{note.length}/280</span>
          </div>
          {errorMsg && <div className="text-xs text-red-300">save error: {errorMsg}</div>}
        </div>
      )}
    </div>
  );
}
