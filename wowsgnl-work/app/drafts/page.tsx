'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type DraftRow = {
  id: number;
  event_id: number;
  angle: string;
  feedback: 'signal' | 'noise' | null;
  feedback_reason: string | null;
  feedback_note: string | null;
  shipped: boolean;
  shipped_at: string | null;
  created_at: string;
  author: string | null;
  event_content: string;
  event_url: string | null;
  relevance_score: number | null;
  posted_at: string | null;
  post_count: number;
  shipped_post_count: number;
  post_signal_count: number;
  post_noise_count: number;
};

type Filter = 'all' | 'shipped' | 'unshipped' | 'signal' | 'noise' | 'with_posts' | 'angle_only';

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
  return `${Math.floor(hr / 24)}d ago`;
}

function scoreClass(s: number | null) {
  if (s === null) return 'bg-neutral-800/60 text-neutral-400 border-neutral-700';
  if (s >= 7) return 'bg-green-500/20 text-green-300 border-green-500/40';
  if (s >= 5) return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40';
  return 'bg-neutral-800 text-neutral-500 border-neutral-700';
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/drafts', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status}`);
        const j = await res.json();
        setDrafts(j.drafts);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let out = drafts;
    if (filter === 'shipped') out = out.filter(d => d.shipped_post_count > 0);
    else if (filter === 'unshipped') out = out.filter(d => d.shipped_post_count === 0);
    else if (filter === 'signal') out = out.filter(d => d.feedback === 'signal');
    else if (filter === 'noise') out = out.filter(d => d.feedback === 'noise');
    else if (filter === 'with_posts') out = out.filter(d => d.post_count > 0);
    else if (filter === 'angle_only') out = out.filter(d => d.post_count === 0);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        d =>
          d.angle.toLowerCase().includes(q) ||
          (d.author || '').toLowerCase().includes(q) ||
          d.event_content.toLowerCase().includes(q)
      );
    }
    return out;
  }, [drafts, filter, search]);

  const counts = useMemo(() => {
    const c = {
      all: drafts.length,
      shipped: 0,
      unshipped: 0,
      signal: 0,
      noise: 0,
      with_posts: 0,
      angle_only: 0,
    };
    for (const d of drafts) {
      if (d.shipped_post_count > 0) c.shipped++;
      else c.unshipped++;
      if (d.feedback === 'signal') c.signal++;
      if (d.feedback === 'noise') c.noise++;
      if (d.post_count > 0) c.with_posts++;
      else c.angle_only++;
    }
    return c;
  }, [drafts]);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'with_posts', label: 'With variants' },
    { id: 'angle_only', label: 'Angle only' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'unshipped', label: 'Unshipped' },
    { id: 'signal', label: '👍 angle' },
    { id: 'noise', label: '👎 angle' },
  ];

  return (
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Drafts</h1>
        <div className="space-x-4 text-xs">
          <Link href="/" className="underline">← back to feed</Link>
          <Link href="/ratings" className="underline opacity-60">Ratings</Link>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-4">
        Every angle generated, with its variants, ratings, and ship status. Click any row to open the source event.
      </p>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input
          type="search"
          placeholder="Search angle, @author, or tweet…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                filter === f.id
                  ? 'bg-white text-black border-white font-medium'
                  : 'border-neutral-700 hover:border-neutral-500'
              }`}
            >
              {f.label}<span className="ml-1.5 opacity-60">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="opacity-50 text-sm">Loading…</p>}
      {error && (
        <div className="border border-red-500/50 bg-red-500/10 text-red-200 rounded p-3 mb-4 text-sm">
          fetch error: {error}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="opacity-50 text-sm">
          {drafts.length === 0
            ? 'No drafts yet. From any event in the feed, click "Draft posts" to generate angles.'
            : 'No drafts match this filter.'}
        </p>
      )}

      <div className="space-y-3">
        {filtered.map(d => (
          <Link
            href={`/event/${d.event_id}`}
            key={d.id}
            className={`block border rounded-lg p-4 transition hover:border-neutral-500 ${
              d.shipped_post_count > 0
                ? 'border-green-500/40 bg-green-500/5'
                : d.feedback === 'signal'
                  ? 'border-green-500/30'
                  : d.feedback === 'noise'
                    ? 'border-red-500/30 bg-red-500/5 opacity-70'
                    : 'border-neutral-800'
            }`}
          >
            <div className="flex items-start gap-2 flex-wrap mb-2 text-xs">
              <span className={`font-bold px-2 py-0.5 rounded border ${scoreClass(d.relevance_score)}`}>
                {d.relevance_score === null ? 'pending' : `${d.relevance_score}/10`}
              </span>
              {d.author && <span className="opacity-80">@{d.author}</span>}
              <span className="opacity-40">·</span>
              <span className="opacity-50">{timeAgo(d.posted_at || d.created_at)}</span>
              {d.shipped_post_count > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/40">
                  ✓ shipped {d.shipped_post_count}
                </span>
              )}
              {d.feedback === 'signal' && (
                <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-300 border border-green-500/40">
                  👍 angle
                </span>
              )}
              {d.feedback === 'noise' && (
                <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/40">
                  👎 angle
                </span>
              )}
              <span className="ml-auto opacity-50">
                {d.post_count === 0 ? 'angle only' : `${d.post_count} variant${d.post_count === 1 ? '' : 's'}`}
                {d.post_signal_count > 0 && ` · ${d.post_signal_count}👍`}
                {d.post_noise_count > 0 && ` · ${d.post_noise_count}👎`}
              </span>
            </div>
            <p className="text-sm font-medium mb-1">{d.angle}</p>
            <p className="text-xs opacity-60 line-clamp-2">{d.event_content}</p>
            {d.feedback_reason && (
              <p className="text-xs opacity-50 italic mt-1">— {d.feedback_reason}</p>
            )}
          </Link>
        ))}
      </div>

      <p className="text-xs opacity-40 mt-4">
        Showing {filtered.length} of {drafts.length} drafts
      </p>
    </main>
  );
}
