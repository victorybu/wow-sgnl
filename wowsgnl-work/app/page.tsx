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

type DraftSummary = {
  id: number;
  angle: string;
  feedback: 'signal' | 'noise' | null;
  feedback_reason: string | null;
  post_count: number;
  shipped_count: number;
};

type RelatedEvent = {
  id: number;
  author: string | null;
  content: string;
  url: string | null;
  posted_at: string | null;
  created_at: string;
};

type TopPick = {
  id: number;
  cluster_topic: string | null;
  author: string | null;
  content: string;
  url: string | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  cluster_boost: number;
  posted_at: string | null;
  created_at: string;
  feedback: 'signal' | 'noise' | null;
  client_name: string;
  is_shipped: boolean;
  drafts: DraftSummary[];
  related: RelatedEvent[];
};

type DropEverything = {
  id: number;
  author: string | null;
  content: string;
  url: string | null;
  relevance_score: number | null;
  cluster_boost: number;
  effective_score: number;
  relevance_reason: string | null;
  posted_at: string | null;
  created_at: string;
  client_name: string;
  has_drafts: boolean;
  is_shipped: boolean;
};

type Payload = {
  ts: string;
  filter: Filter;
  current_client: { id: number; name: string; mode: 'drafting' | 'intelligence' };
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
  top_picks: TopPick[];
  drop_everything: DropEverything[];
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
  if (score >= 9) return 'bg-red-500/25 text-red-200 border border-red-500/60 font-bold';
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
        <div className="flex items-center gap-3 text-xs">
          <Link href="/triage" className="px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200">
            Triage{data && data.stats.events_unscored !== undefined ? ` · ${data.counts.all - data.counts.my_ratings}` : ''}
          </Link>
          {data?.current_client?.mode === 'intelligence' && (
            <Link href="/briefing" className="underline">Briefing</Link>
          )}
          {data?.current_client?.mode !== 'intelligence' && (
            <Link href="/drafts" className="underline">Drafts</Link>
          )}
          <Link href="/ratings" className="underline">Ratings</Link>
          {data?.current_client?.mode !== 'intelligence' && (
            <Link href="/voice" className="underline">Voice</Link>
          )}
          <Link href="/watchlist" className="underline">Watchlist</Link>
          <Link href="/clients" className="underline">Clients</Link>
          <Link href="/run" className="underline opacity-60">debug</Link>
        </div>
      </div>

      <DropEverythingBanner
        clientId={data?.current_client?.id ?? null}
        events={data?.drop_everything ?? []}
      />

      <StandingBrief clientId={data?.current_client?.id ?? null} />

      {data && data.top_picks && data.top_picks.length > 0 && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-green-300">
              Top picks · last 6h
            </h2>
            <span className="text-xs opacity-50">
              {data.top_picks.length} cluster{data.top_picks.length === 1 ? '' : 's'} ready to draft
            </span>
          </div>
          <div className="space-y-3">
            {data.top_picks.map(p => (
              <TopPickCard key={p.id} pick={p} />
            ))}
          </div>
        </section>
      )}

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
        {FILTERS.filter(f => {
          // Hide drafting-specific chips when client is intelligence-mode
          if (data?.current_client?.mode === 'intelligence' &&
              (f.id === 'drafted' || f.id === 'shipped')) return false;
          return true;
        }).map(f => {
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
          <EventCard
            key={e.id}
            event={e}
            onLocalRated={onLocalRated}
            mode={data.current_client?.mode || 'drafting'}
          />
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
  mode = 'drafting',
}: {
  event: EventRow;
  onLocalRated: (id: number, next: Partial<EventRow>) => void;
  mode?: 'drafting' | 'intelligence';
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
      const updated = j.row || j.event || {};
      onLocalRated(e.id, {
        feedback: updated.feedback ?? null,
        feedback_at: updated.feedback_at ?? null,
        feedback_reason: updated.feedback_reason ?? null,
        feedback_note: updated.feedback_note ?? null,
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
        {mode === 'drafting' ? (
          <Link
            href={`/event/${e.id}`}
            className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200"
          >
            Draft posts
          </Link>
        ) : (
          <Link
            href={`/event/${e.id}`}
            className="text-xs px-3 py-1.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-200"
          >
            Add to briefing
          </Link>
        )}
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


function TopPickCard({ pick: p }: { pick: TopPick }) {
  const [showRelated, setShowRelated] = useState(false);
  const boost = p.cluster_boost || 0;
  const effectiveScore =
    p.relevance_score !== null ? Math.min((p.relevance_score || 0) + boost, 10) : null;
  const scoreCls =
    effectiveScore !== null && effectiveScore >= 9
      ? "bg-red-500/25 text-red-200 border border-red-500/60 font-bold"
      : effectiveScore !== null && effectiveScore >= 7
        ? "bg-green-500/20 text-green-300 border border-green-500/40"
        : "bg-yellow-500/15 text-yellow-300 border border-yellow-500/40";
  const isCluster = p.related.length > 0;
  const relatedAuthors = p.related.slice(0, 3).map(r => `@${r.author || '?'}`).join(', ');
  const moreCount = p.related.length > 3 ? p.related.length - 3 : 0;
  return (
    <article className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
      {isCluster && p.cluster_topic && (
        <div className="text-xs uppercase tracking-wider font-semibold text-green-300/80 mb-2">
          {p.cluster_topic}
        </div>
      )}
      <header className="flex items-center gap-2 flex-wrap mb-2">
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${scoreCls}`}>
          {effectiveScore ?? "?"}/10
        </span>
        {boost > 0 && (
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-200"
            title={`Cluster boost: raw score ${p.relevance_score} + ${boost} (3+ watchers on same beat)`}
          >
            +{boost} cluster
          </span>
        )}
        {p.author && (
          <a
            href={`https://x.com/${p.author}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm hover:underline"
          >
            @{p.author}
          </a>
        )}
        <span className="text-xs opacity-40">·</span>
        <span className="text-xs opacity-50">{timeAgo(p.posted_at || p.created_at)}</span>
        {p.is_shipped && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/40">
            shipped
          </span>
        )}
      </header>
      <p className="text-sm whitespace-pre-wrap mb-2 leading-relaxed">{p.content}</p>
      {p.relevance_reason && (
        <p className="text-xs opacity-60 italic mb-3">{p.relevance_reason}</p>
      )}

      {isCluster && (
        <div className="mb-3">
          <button
            onClick={() => setShowRelated(s => !s)}
            className="text-xs text-green-300/80 hover:text-green-300 underline"
          >
            +{p.related.length} from {relatedAuthors}
            {moreCount > 0 ? ` +${moreCount} more` : ''}
            {showRelated ? ' ▲' : ' ▼'}
          </button>
          {showRelated && (
            <ul className="mt-2 space-y-2 border-l-2 border-green-500/20 pl-3">
              {p.related.map(r => (
                <li key={r.id} className="text-xs">
                  <div className="flex items-center gap-1.5 mb-0.5 opacity-70">
                    {r.author && (
                      <a
                        href={`https://x.com/${r.author}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        @{r.author}
                      </a>
                    )}
                    <span className="opacity-50">·</span>
                    <span className="opacity-50">{timeAgo(r.posted_at || r.created_at)}</span>
                    {r.url && (
                      <>
                        <span className="opacity-50">·</span>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline opacity-70"
                        >
                          open ↗
                        </a>
                      </>
                    )}
                  </div>
                  <p className="opacity-80 line-clamp-3 whitespace-pre-wrap">{r.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {p.drafts.length === 0 ? (
        <div className="border-t border-green-500/20 pt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs opacity-60">No angles yet —</span>
          <Link
            href={`/event/${p.id}`}
            className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200"
          >
            Generate angles
          </Link>
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Open on X ↗
            </a>
          )}
        </div>
      ) : (
        <div className="border-t border-green-500/20 pt-3">
          <div className="text-xs uppercase opacity-50 mb-2">
            {p.drafts.length} angle{p.drafts.length === 1 ? "" : "s"} ready
          </div>
          <ol className="space-y-2 mb-3">
            {p.drafts.map((d, i) => (
              <li key={d.id} className="flex items-start gap-2 text-sm">
                <span className="opacity-50 shrink-0 font-mono">{i + 1}.</span>
                <span className="flex-1">
                  {d.angle}
                  {d.feedback === "signal" && (
                    <span className="ml-2 text-xs text-green-300">👍</span>
                  )}
                  {d.feedback === "noise" && (
                    <span className="ml-2 text-xs text-red-300">👎</span>
                  )}
                  {d.post_count > 0 && (
                    <span className="ml-2 text-xs opacity-50">
                      · {d.post_count} variant{d.post_count === 1 ? "" : "s"}
                      {d.shipped_count > 0 && ` · ${d.shipped_count} shipped`}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/event/${p.id}`}
              className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium hover:bg-neutral-200"
            >
              Open & draft posts →
            </Link>
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
              >
                Open on X ↗
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

// "While you were away" hero. Reads localStorage(signal_last_seen_at_<clientId>)
// to scope the window. Hidden if first-ever visit or <2h since last
// visit. The "Mark caught up" button resets the timestamp.
type StandingBriefData = {
  ok: boolean;
  since?: string;
  window_hours?: number;
  totals?: { events: number; scored_7plus: number; scored_9plus: number; noise_rated: number };
  top_events?: any[];
  clusters?: { cluster_topic: string; primary_event_id: number; author_count: number }[];
};

const MIN_AWAY_HOURS = 2;

function StandingBrief({ clientId }: { clientId: number | null }) {
  const [brief, setBrief] = useState<StandingBriefData | null>(null);
  const [hidden, setHidden] = useState<boolean>(true);

  useEffect(() => {
    if (!clientId) return;
    const key = `signal_last_seen_at_${clientId}`;
    const prev = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    if (!prev) {
      window.localStorage.setItem(key, new Date().toISOString());
      setHidden(true);
      return;
    }
    const ms = Date.parse(prev);
    if (!Number.isFinite(ms)) {
      window.localStorage.setItem(key, new Date().toISOString());
      setHidden(true);
      return;
    }
    const hoursAway = (Date.now() - ms) / 3_600_000;
    if (hoursAway < MIN_AWAY_HOURS) {
      setHidden(true);
      return;
    }
    setHidden(false);
    void fetchBrief(prev);
  }, [clientId]);

  async function fetchBrief(sinceIso: string) {
    try {
      const res = await fetch(`/api/standing-brief?since=${encodeURIComponent(sinceIso)}&_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (j.ok) setBrief(j);
    } catch {}
  }

  function markCaughtUp() {
    if (!clientId) return;
    const key = `signal_last_seen_at_${clientId}`;
    window.localStorage.setItem(key, new Date().toISOString());
    setHidden(true);
    setBrief(null);
  }

  if (hidden || !brief || !brief.totals) return null;
  const t = brief.totals;
  if (t.events === 0) return null;

  const hoursAway = brief.window_hours ?? 0;
  const awayLabel =
    hoursAway < 24 ? `${hoursAway.toFixed(1)}h` : `${(hoursAway / 24).toFixed(1)}d`;

  return (
    <section className="mb-6 border border-blue-500/40 bg-blue-500/5 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-blue-300">
          While you were away · {awayLabel}
        </h2>
        <button
          onClick={markCaughtUp}
          className="text-xs px-3 py-1 rounded border border-blue-500/40 hover:bg-blue-500/15"
        >
          Mark all caught up ✓
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-sm">
        <Tile label="New events" value={t.events} />
        <Tile label="Scored 7+" value={t.scored_7plus} accent={t.scored_7plus > 0 ? 'green' : null} />
        <Tile label="Scored 9+" value={t.scored_9plus} accent={t.scored_9plus > 0 ? 'gold' : null} />
        <Tile label="Marked noise" value={t.noise_rated} />
      </div>

      {brief.clusters && brief.clusters.length > 0 && (
        <div className="mb-3 text-xs">
          <div className="opacity-60 uppercase tracking-wider mb-1">Topic clusters</div>
          <ul className="space-y-1">
            {brief.clusters.map(c => (
              <li key={c.primary_event_id}>
                <span className="text-blue-200">{c.cluster_topic}</span>
                <span className="opacity-60"> · {c.author_count} authors</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.top_events && brief.top_events.length > 0 && (
        <ul className="space-y-2">
          {brief.top_events.slice(0, 5).map((e: any) => (
            <li key={e.id} className="flex items-start gap-2 text-sm">
              <span
                className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded border ${
                  (e.relevance_score ?? 0) >= 9
                    ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                    : (e.relevance_score ?? 0) >= 7
                      ? 'bg-green-500/20 text-green-300 border-green-500/40'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                }`}
              >
                {e.relevance_score ?? '?'}/10
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs opacity-70 truncate">
                  {e.author && <a href={`https://x.com/${e.author}`} target="_blank" rel="noopener noreferrer" className="hover:underline">@{e.author}</a>}
                  <span className="opacity-50"> · {timeAgo(e.posted_at || e.created_at)}</span>
                  {e.draft_count > 0 && <span className="opacity-50"> · {e.draft_count} angle{e.draft_count === 1 ? '' : 's'}</span>}
                </div>
                <Link
                  href={`/event/${e.id}`}
                  className="block text-sm hover:underline truncate"
                  title={e.content}
                >
                  {e.content.slice(0, 120)}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "DROP EVERYTHING" banner. Renders red hero blocks at the very top
// of the dashboard for any score-9+ event from the last 24h that the
// user hasn't dismissed yet. Dismissal is per-device (localStorage)
// and per-event-id, so once you've seen it you don't see it again.
// localStorage key includes client_id so switching clients doesn't
// cross-contaminate which alerts are dismissed.
function DropEverythingBanner({
  clientId,
  events,
}: {
  clientId: number | null;
  events: DropEverything[];
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!clientId) return;
    const key = `signal_seen_9plus_${clientId}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch {}
  }, [clientId]);

  function dismiss(id: number) {
    if (!clientId) return;
    const key = `signal_seen_9plus_${clientId}`;
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(next)));
    } catch {}
  }

  const visible = events.filter(e => !dismissed.has(e.id));
  if (visible.length === 0) return null;

  return (
    <section className="mb-6 space-y-2">
      {visible.map(e => (
        <article
          key={e.id}
          className="border-2 border-red-500/60 bg-red-500/10 rounded-lg p-4 shadow-lg shadow-red-500/10"
        >
          <header className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-red-200">
              🚨 Drop everything
            </span>
            <span className="text-sm font-bold px-2 py-0.5 rounded bg-red-500/30 text-red-100 border border-red-500/60">
              {e.effective_score}/10
            </span>
            {e.cluster_boost > 0 && (
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/15 text-red-200"
                title={`Cluster boost: raw ${e.relevance_score} + ${e.cluster_boost} (3+ watchers on same beat)`}
              >
                +{e.cluster_boost} cluster
              </span>
            )}
            {e.author && (
              <a
                href={`https://x.com/${e.author}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:underline"
              >
                @{e.author}
              </a>
            )}
            <span className="text-xs opacity-50">·</span>
            <span className="text-xs opacity-60">{e.client_name}</span>
            <span className="text-xs opacity-50">·</span>
            <span className="text-xs opacity-60">{timeAgo(e.posted_at || e.created_at)}</span>
            {e.is_shipped && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-200 border border-green-500/40">
                shipped
              </span>
            )}
            {e.has_drafts && !e.is_shipped && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-200 border border-blue-500/40">
                drafted
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => dismiss(e.id)}
              className="text-xs underline opacity-60 hover:opacity-100"
              title="Dismiss this alert from the banner (event stays in feed)"
            >
              got it ✓
            </button>
          </header>
          <p className="text-sm whitespace-pre-wrap leading-relaxed mb-2">{e.content}</p>
          {e.relevance_reason && (
            <p className="text-xs italic text-red-200/70 mb-3">{e.relevance_reason}</p>
          )}
          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/event/${e.id}`}
              className="text-xs px-3 py-1.5 rounded bg-white text-black font-bold hover:bg-neutral-200"
            >
              {e.has_drafts ? 'Open & ship →' : 'Generate angles →'}
            </Link>
            {e.url && (
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded border border-red-500/40 hover:border-red-500/60"
              >
                Open on X ↗
              </a>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: 'green' | 'gold' | null }) {
  const accentCls =
    accent === 'green' ? 'border-green-500/40 bg-green-500/5' :
    accent === 'gold' ? 'border-yellow-500/40 bg-yellow-500/5' :
    'border-neutral-800';
  return (
    <div className={`border rounded p-2 ${accentCls}`}>
      <div className="text-xs opacity-60">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

