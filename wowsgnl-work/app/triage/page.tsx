'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Event = {
  id: number;
  author: string | null;
  content: string;
  url: string | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  posted_at: string | null;
  created_at: string;
  client_name: string;
  has_drafts: boolean;
};

type Counts = {
  unrated: number;
  signal: number;
  noise: number;
  total: number;
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
  return `${Math.floor(hr / 24)}d ago`;
}

function scoreClass(s: number | null) {
  if (s === null) return 'bg-neutral-800/60 text-neutral-400 border-neutral-700';
  if (s >= 7) return 'bg-green-500/20 text-green-300 border-green-500/40';
  if (s >= 5) return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40';
  return 'bg-neutral-800 text-neutral-500 border-neutral-700';
}

export default function Triage() {
  const [queue, setQueue] = useState<Event[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitDir, setExitDir] = useState<'left' | 'right' | 'up' | null>(null);
  const [stats, setStats] = useState({ rated: 0, signal: 0, noise: 0, skipped: 0 });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/triage?limit=30', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      setQueue(j.queue);
      setCounts(j.counts);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refill when queue runs low
  useEffect(() => {
    if (!loading && queue.length > 0 && queue.length < 5 && !posting) {
      load();
    }
  }, [queue.length, loading, posting, load]);

  const current = queue[0];

  const advance = (dir: 'left' | 'right' | 'up', updateStat?: (s: typeof stats) => typeof stats) => {
    setExitDir(dir);
    setTimeout(() => {
      setQueue(q => q.slice(1));
      setExitDir(null);
      if (updateStat) setStats(updateStat);
    }, 180);
  };

  const rate = async (rating: 'signal' | 'noise') => {
    if (!current || posting) return;
    setPosting(current.id);
    setExitDir(rating === 'signal' ? 'right' : 'left');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'event',
          target_id: current.id,
          rating,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setTimeout(() => {
        setQueue(q => q.slice(1));
        setExitDir(null);
        setStats(s => ({
          ...s,
          rated: s.rated + 1,
          signal: rating === 'signal' ? s.signal + 1 : s.signal,
          noise: rating === 'noise' ? s.noise + 1 : s.noise,
        }));
        setPosting(null);
      }, 180);
    } catch (e: any) {
      setError(e.message || 'save failed');
      setExitDir(null);
      setPosting(null);
    }
  };

  const skip = () => {
    if (!current || posting) return;
    advance('up', s => ({ ...s, skipped: s.skipped + 1 }));
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (posting) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); rate('noise'); }
      else if (e.key === 'ArrowRight' || e.key === '3') { e.preventDefault(); rate('signal'); }
      else if (e.key === ' ' || e.key === 'ArrowDown' || e.key === '2') { e.preventDefault(); skip(); }
      else if (e.key === 'o' && current?.url) window.open(current.url, '_blank');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, posting]);

  const exitClass =
    exitDir === 'left' ? 'translate-x-[-130%] -rotate-12 opacity-0'
    : exitDir === 'right' ? 'translate-x-[130%] rotate-12 opacity-0'
    : exitDir === 'up' ? 'translate-y-[-130%] opacity-0'
    : 'translate-x-0 translate-y-0 opacity-100';

  return (
    <main className="max-w-2xl mx-auto p-6 min-h-screen flex flex-col">
      <div className="flex justify-between items-center mb-4 text-xs">
        <Link href="/" className="underline opacity-60">← back to feed</Link>
        <div className="space-x-3 opacity-60">
          <Link href="/drafts" className="underline">Drafts</Link>
          <Link href="/ratings" className="underline">Ratings</Link>
        </div>
      </div>

      <div className="flex justify-between items-baseline mb-6">
        <h1 className="text-2xl font-bold">Triage</h1>
        <div className="text-xs opacity-60 tabular-nums">
          {counts ? <>📥 <strong>{counts.unrated - stats.rated - stats.skipped}</strong> in queue · 👍 {counts.signal + stats.signal} · 👎 {counts.noise + stats.noise}</> : ''}
        </div>
      </div>

      {error && (
        <div className="border border-red-500/50 bg-red-500/10 text-red-200 rounded p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading && <p className="opacity-50 text-sm">Loading…</p>}

      {!loading && !current && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-lg font-bold mb-2">Inbox zero.</h2>
          <p className="opacity-60 text-sm mb-6 max-w-sm">
            Nothing left to triage. Next cron tick at the top of the hour will pull more tweets.
          </p>
          <div className="flex gap-3">
            <button
              onClick={load}
              className="text-xs px-4 py-2 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Refresh
            </button>
            <Link href="/" className="text-xs px-4 py-2 rounded bg-white text-black font-medium">
              Go to feed
            </Link>
          </div>
          {(stats.rated > 0 || stats.skipped > 0) && (
            <p className="mt-6 text-xs opacity-50">
              This session: {stats.signal} 👍 · {stats.noise} 👎 · {stats.skipped} ⏭
            </p>
          )}
        </div>
      )}

      {current && (
        <>
          <div className="flex-1 flex items-center justify-center my-4">
            <article
              className={`relative border border-neutral-800 rounded-2xl p-6 bg-neutral-950 w-full transition-all duration-200 ease-out ${exitClass}`}
            >
              {/* peek of next card behind */}
              {queue[1] && (
                <div className="absolute inset-0 -z-10 translate-y-2 scale-95 border border-neutral-900 rounded-2xl bg-neutral-950/50 pointer-events-none" />
              )}

              <header className="flex items-center gap-2 flex-wrap mb-4">
                <span className={`text-sm font-bold px-2.5 py-1 rounded border ${scoreClass(current.relevance_score)}`}>
                  {current.relevance_score === null ? 'pending' : `${current.relevance_score}/10`}
                </span>
                {current.author && (
                  <a
                    href={`https://x.com/${current.author}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:underline"
                  >
                    @{current.author}
                  </a>
                )}
                <span className="text-xs opacity-40">·</span>
                <span className="text-xs opacity-50">{current.client_name}</span>
                <span className="text-xs opacity-40">·</span>
                <span className="text-xs opacity-50">{timeAgo(current.posted_at || current.created_at)}</span>
                {current.has_drafts && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/40">
                    has drafts
                  </span>
                )}
              </header>

              <p className="text-base whitespace-pre-wrap leading-relaxed mb-4">{current.content}</p>

              {current.relevance_reason && (
                <div className="border-t border-neutral-800 pt-3">
                  <p className="text-xs opacity-50 italic">{current.relevance_reason}</p>
                </div>
              )}

              {current.url && (
                <div className="mt-4">
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 inline-block"
                  >
                    Open on X ↗ <span className="opacity-50 ml-1">[O]</span>
                  </a>
                </div>
              )}
            </article>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <button
              onClick={() => rate('noise')}
              disabled={!!posting}
              className="py-4 rounded-xl border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 transition disabled:opacity-50 flex flex-col items-center"
            >
              <span className="text-2xl">👎</span>
              <span className="text-xs mt-1 font-medium">Noise</span>
              <span className="text-[10px] opacity-50 mt-0.5">← or 1</span>
            </button>
            <button
              onClick={skip}
              disabled={!!posting}
              className="py-4 rounded-xl border border-neutral-700 hover:bg-neutral-800 transition disabled:opacity-50 flex flex-col items-center"
            >
              <span className="text-2xl">⏭</span>
              <span className="text-xs mt-1 font-medium">Skip</span>
              <span className="text-[10px] opacity-50 mt-0.5">space or 2</span>
            </button>
            <button
              onClick={() => rate('signal')}
              disabled={!!posting}
              className="py-4 rounded-xl border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 transition disabled:opacity-50 flex flex-col items-center"
            >
              <span className="text-2xl">👍</span>
              <span className="text-xs mt-1 font-medium">Signal</span>
              <span className="text-[10px] opacity-50 mt-0.5">→ or 3</span>
            </button>
          </div>

          <div className="text-center">
            <Link
              href={`/event/${current.id}`}
              className="text-xs underline opacity-60 hover:opacity-100"
            >
              Open in detail view
            </Link>
            <span className="opacity-40 text-xs mx-2">·</span>
            <span className="text-xs opacity-40">
              Session: {stats.signal} 👍 · {stats.noise} 👎 · {stats.skipped} ⏭
            </span>
          </div>
        </>
      )}
    </main>
  );
}
