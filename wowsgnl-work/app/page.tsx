'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Filter = 'all_scored' | 'top' | 'drafted' | 'shipped';

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
  };
  counts: {
    all_scored: number;
    top: number;
    drafted: number;
    shipped: number;
  };
};

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
  if (score === null) return 'bg-neutral-800 text-neutral-400';
  if (score >= 7) return 'bg-green-500/20 text-green-300 border border-green-500/40';
  if (score >= 5) return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/40';
  return 'bg-neutral-800 text-neutral-500 border border-neutral-700';
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all_scored', label: 'All scored (5+)' },
  { id: 'top', label: '7+ only' },
  { id: 'drafted', label: 'Drafted' },
  { id: 'shipped', label: 'Shipped' },
];

export default function Home() {
  const [filter, setFilter] = useState<Filter>('all_scored');
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
          <Link href="/run" className="underline opacity-60">debug</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Events today" value={data?.stats.events_today ?? '—'} sub={data ? `${data.stats.events_total} total` : ''} />
        <Stat label="Scored today" value={data?.stats.scored_today ?? '—'} sub={data ? `${data.stats.events_unscored} unscored` : ''} />
        <Stat label="Drafts in progress" value={data?.stats.drafts_in_progress ?? '—'} />
        <Stat label="Shipped today" value={data?.stats.shipped_today ?? '—'} />
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

      {data && data.events.length === 0 && (
        <p className="opacity-50 text-sm">
          No events match this filter yet.
          {data.stats.events_unscored > 0 && (
            <span> {data.stats.events_unscored} events are still waiting to be scored — once Anthropic billing clears, the next poll will fill them in.</span>
          )}
        </p>
      )}

      <div className="space-y-3">
        {data?.events.map(e => (
          <article key={e.id} className="border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 transition">
            <header className="flex justify-between items-start gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${scoreClass(e.relevance_score)}`}>
                  {e.relevance_score ?? '—'}/10
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
            <div className="flex items-center gap-2">
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
          </article>
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
