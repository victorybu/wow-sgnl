'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Filter = 'all' | 'unscored' | 'top' | 'drafted' | 'shipped' | 'my_ratings' | 'muted';
type Rating = 'signal' | 'noise' | null;

type EventRow = {
  id: number;
  author: string | null;
  content: string;
  url: string | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  status: string;
  posted_at: string | null;
  created_at: string;
  feedback: 'signal' | 'noise' | null;
  feedback_at: string | null;
  feedback_reason: string | null;
  feedback_note: string | null;
  client_name: string;
  has_drafts: boolean;
  is_shipped: boolean;
};

type Payload = {
  ts: string;
  filter: Filter;
  events: EventRow[];
  stats: {
    events_today: number;
    scored_today: number;
    drafts_in_progress: number;
    shipped_today: number;
    events_total: number;
    events_unscored: number;
    rated_today: number;
    rated_today_signal: number;
    rated_today_noise: number;
  };
  counts: {
    all: number;
    unscored: number;
    top: number;
    drafted: number;
    shipped: number;
    my_ratings: number;
    muted: number;
  };
};

const SIGNAL_REASONS = [
  'Ship-worthy now',
  'Good context',
  'Worth drafting against',
  'Just interesting',
  'Aligns with Khanna lanes',
  'Surprising/contrarian',
];

const NOISE_REASONS = [
  'Wrong topic',
  'Off-tone for Khanna',
  'Stale/already covered',
  'Too generic',
  'Off-message',
  'Wrong messenger',
  'RT-style content',
  'Cheerleading/booking bait',
];

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (isNaN(ts)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function scoreClass(score: number | null): string {
  if (score === null) return 'bg-neutral-800/60 text-neutral-400 border border-neutral-700';
  if (score >= 7) return 'bg-green-500/20 text-green-300 border border-green-500/40';
  if (score >= 5) return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/40';
  return 'bg-neutral-800 text-neutral-500 border border-neutral-700';
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All events' },
  { id: 'top', label: '7+ only' },
  { id: 'unscored', label: 'Unscored' },
  { id: 'my_ratings', label: 'My ratings' },
  { id: 'muted', label: 'Muted' },
  { id: 'drafted', label: 'Drafted' },
  { id: 'shipped', label: 'Shipped' },
];

export default function Home() {
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const load = async (f: Filter) => {
    try {
      const res = await fetch(`/api/events?filter=${f}&_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const json: Payload = await res.json();
      setData(json);
      setLastFetch(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load(filter);
    const id = setInterval(() => load(filter), 60_000);
    return () => clearInterval(id);
  }, [filter]);

  const onLocalRated = (eventId: number, next: Partial<EventRow>) => {
    // Optimistic update: apply new feedback immediately to the card.
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.map(e => (e.id === eventId ? { ...e, ...next } : e)),
      };
    });
    // Then refetch so server-side filter (noise hidden, signal floats up) takes effect.
    void load(filter);
  };

  const emptyMsg = (() => {
    if (!data) return null;
    if (filter === 'top') {
      return data.stats.events_unscored > 0
        ? `${data.stats.events_unscored} events are still waiting to be scored — once Anthropic billing clears, the next poll will fill them in.`
        : 'No events scored ≥7 yet.';
    }
    if (filter === 'my_ratings') return 'No ratings yet — click 👍 or 👎 on any card to start.';
    if (filter === 'muted') return 'Nothing muted yet. Click 👎 on a tweet to hide it from the main feed.';
    if (filter === 'drafted') return 'No events drafted yet — click "Draft posts" on any card.';
    if (filter === 'shipped') return 'No drafts shipped yet.';
    if (filter === 'unscored') return 'All events scored! (Or no events yet.)';
    if (filter === 'all') {
      if (data.stats.events_total === 0) return 'No events yet — first poll runs at the next top of hour.';
      if (data.counts.muted > 0 && data.counts.all === 0)
        return `All ${data.counts.muted} events have been muted. Switch to "Muted" to see them.`;
      return null;
    }
    return null;
  })();

  return (
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">Signal</h1>
          {lastFetch && (
            <span className="text-xs opacity-50">
              updated {timeAgo(lastFetch.toISOString())} · auto-refresh 60s
            </span>
          )}
        </div>
        <div className="space-x-4 text-xs">
          <Link href="/watchlist" className="underline">Watchlist</Link>
          <Link href="/clients" className="underline">Clients</Link>
          <Link href="/ratings" className="underline">Ratings</Link>
          <Link href="/run" className="underline opacity-60">debug</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Events today" value={data?.stats.events_today ?? '—'} sub={data ? `${data.stats.events_total} total` : ''} />
        <Stat label="Scored today" value={data?.stats.scored_today ?? '—'} sub={data ? `${data.stats.events_unscored} unscored` : ''} />
        <Stat label="Drafts in progress" value={data?.stats.drafts_in_progress ?? '—'} />
        <Stat label="Shipped today" value={data?.stats.shipped_today ?? '—'} />
        <Stat
          label="Rated today"
          value={data?.stats.rated_today ?? '—'}
          sub={data ? `${data.stats.rated_today_signal} 👍 / ${data.stats.rated_today_noise} 👎` : ''}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map(f => {
          const count = data?.counts[f.id] ?? null;
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                active
                  ? 'bg-white text-black border-white font-medium'
                  : 'border-neutral-700 hover:border-neutral-500 text-neutral-300'
              }`}
            >
              {f.label}
              {count !== null && <span className="ml-1.5 opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="border border-red-500/50 bg-red-500/10 text-red-200 rounded p-3 mb-4 text-sm">
          fetch error: {error}
        </div>
      )}

      {loading && !data && <p className="opacity-50 text-sm">Loading…</p>}

      {data && data.events.length === 0 && emptyMsg && (
        <p className="opacity-50 text-sm">{emptyMsg}</p>
      )}

      <div className="space-y-3">
        {data?.events.map(e => (
          <EventCard key={e.id} event={e} onLocalRated={onLocalRated} />
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="border border-neutral-800 rounded-lg p-3">
      <div className="text-xs opacity-60 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs opacity-40 mt-1">{sub}</div>}
    </div>
  );
}

function EventCard({
  event: e,
  onLocalRated,
}: {
  event: EventRow;
  onLocalRated: (id: number, next: Partial<EventRow>) => void;
}) {
  const [formOpen, setFormOpen] = useState<Rating>(null);
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openForm = (rating: 'signal' | 'noise') => {
    setReason(e.feedback === rating ? e.feedback_reason || '' : '');
    setNote(e.feedback === rating ? e.feedback_note || '' : '');
    setErrorMsg(null);
    setFormOpen(rating);
  };

  const closeForm = () => {
    setFormOpen(null);
    setErrorMsg(null);
  };

  const submit = async (rating: Rating) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event_id: e.id,
          rating,
          reason: rating ? reason || null : null,
          note: rating ? note || null : null,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      onLocalRated(e.id, {
        feedback: j.event.feedback,
        feedback_at: j.event.feedback_at,
        feedback_reason: j.event.feedback_reason,
        feedback_note: j.event.feedback_note,
      });
      closeForm();
    } catch (err: any) {
      setErrorMsg(err.message || 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClick = (rating: 'signal' | 'noise') => {
    if (e.feedback === rating) {
      submit(null); // unrate
    } else {
      openForm(rating);
    }
  };

  const reasonOpts = formOpen === 'signal' ? SIGNAL_REASONS : NOISE_REASONS;

  const cardClass = (() => {
    if (e.feedback === 'signal') return 'border-green-500/50 bg-green-500/5 hover:border-green-500/70';
    if (e.feedback === 'noise') return 'border-red-500/30 bg-red-500/5 hover:border-red-500/50 opacity-60';
    return 'border-neutral-800 hover:border-neutral-600';
  })();

  return (
    <article className={`border rounded-lg p-4 transition ${cardClass}`}>
      <header className="flex justify-between items-start gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${scoreClass(e.relevance_score)}`}>
            {e.relevance_score === null ? 'pending' : `${e.relevance_score}/10`}
          </span>
          {e.author && (
            <a
              href={`https://x.com/${e.author}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm opacity-80 hover:opacity-100 hover:underline"
            >
              @{e.author}
            </a>
          )}
          <span className="text-xs opacity-40">·</span>
          <span className="text-xs opacity-50">{e.client_name}</span>
          <span className="text-xs opacity-40">·</span>
          <span className="text-xs opacity-50">{timeAgo(e.posted_at || e.created_at)}</span>
          {e.is_shipped && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/40">
              shipped
            </span>
          )}
          {e.has_drafts && !e.is_shipped && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/40">
              drafted
            </span>
          )}
        </div>
      </header>
      <p className="text-sm whitespace-pre-wrap mb-3 leading-relaxed">{e.content}</p>
      {e.relevance_reason && (
        <p className="text-xs opacity-60 italic mb-3">{e.relevance_reason}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => handleClick('signal')}
          disabled={saving}
          className={`text-xs px-3 py-1.5 rounded border transition ${
            e.feedback === 'signal'
              ? 'bg-green-500/20 border-green-500/60 text-green-200'
              : 'border-neutral-700 hover:border-green-500/50'
          }`}
        >
          👍 Signal
        </button>
        <button
          onClick={() => handleClick('noise')}
          disabled={saving}
          className={`text-xs px-3 py-1.5 rounded border transition ${
            e.feedback === 'noise'
              ? 'bg-red-500/20 border-red-500/60 text-red-200'
              : 'border-neutral-700 hover:border-red-500/50'
          }`}
        >
          👎 Noise
        </button>
        <span className="flex-1" />
        {e.url && (
          <a
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
          >
            Open on X
          </a>
        )}
        <Link
          href={`/event/${e.id}`}
          className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200"
        >
          Draft posts
        </Link>
      </div>

      {e.feedback && !formOpen && (
        <div className="mt-3 text-xs opacity-70">
          marked <span className={e.feedback === 'signal' ? 'text-green-300' : 'text-red-300'}>{e.feedback}</span>
          {e.feedback_reason ? <> — {e.feedback_reason}</> : null}
          {e.feedback_note && (
            <div className="mt-1 text-xs opacity-60 italic">"{e.feedback_note}"</div>
          )}
        </div>
      )}

      {formOpen && (
        <div className="mt-3 border-t border-neutral-800 pt-3 space-y-2">
          <div className="text-xs opacity-70">
            Rate as <strong className={formOpen === 'signal' ? 'text-green-300' : 'text-red-300'}>{formOpen}</strong>
            {e.feedback === formOpen && <span className="opacity-50"> — editing existing rating</span>}
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
            placeholder="Optional note — anything Claude should learn from this rating"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => submit(formOpen)}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save rating'}
            </button>
            <button
              onClick={closeForm}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Cancel
            </button>
            <span className="text-xs opacity-40 ml-auto">{note.length}/280</span>
          </div>
          {errorMsg && (
            <div className="text-xs text-red-300">save error: {errorMsg}</div>
          )}
        </div>
      )}
    </article>
  );
}
