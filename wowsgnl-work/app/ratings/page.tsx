'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Row = {
  id: number;
  kind: 'event' | 'draft' | 'post' | null;
  target_id: number | null;
  event_id: number | null;
  rating: 'signal' | 'noise' | 'cleared';
  reason: string | null;
  note: string | null;
  rated_at: string;
  ev_id: number | null;
  ev_author: string | null;
  ev_content: string | null;
  d_id: number | null;
  d_angle: string | null;
  d_event_id: number | null;
  d_author: string | null;
  d_event_content: string | null;
  p_id: number | null;
  p_content: string | null;
  p_draft_id: number | null;
  p_angle: string | null;
  p_event_id: number | null;
  p_author: string | null;
};

type RatingFilter = 'all' | 'signal' | 'noise' | 'cleared';
type KindFilter = 'all' | 'event' | 'draft' | 'post';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function ratingBadge(r: Row['rating']) {
  if (r === 'signal') return 'bg-green-500/20 text-green-300 border-green-500/40';
  if (r === 'noise') return 'bg-red-500/20 text-red-300 border-red-500/40';
  return 'bg-neutral-800 text-neutral-400 border-neutral-700';
}

function kindBadge(k: Row['kind']) {
  if (k === 'event') return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
  if (k === 'draft') return 'bg-purple-500/15 text-purple-300 border-purple-500/40';
  if (k === 'post') return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  return 'bg-neutral-800 text-neutral-400 border-neutral-700';
}

// derive author + excerpt + link from any kind
function rowMeta(r: Row): { author: string | null; excerpt: string; link: string | null; subtitle: string | null } {
  if (r.kind === 'event' || (!r.kind && r.event_id)) {
    return {
      author: r.ev_author,
      excerpt: r.ev_content || '(event deleted)',
      link: r.ev_id ? `/event/${r.ev_id}` : null,
      subtitle: null,
    };
  }
  if (r.kind === 'draft') {
    return {
      author: r.d_author,
      excerpt: r.d_angle || '(angle deleted)',
      link: r.d_event_id ? `/event/${r.d_event_id}` : null,
      subtitle: r.d_event_content ? `re: ${r.d_event_content.slice(0, 80)}…` : null,
    };
  }
  if (r.kind === 'post') {
    return {
      author: r.p_author,
      excerpt: r.p_content || '(post deleted)',
      link: r.p_event_id ? `/event/${r.p_event_id}` : null,
      subtitle: r.p_angle ? `angle: ${r.p_angle.slice(0, 80)}` : null,
    };
  }
  return { author: null, excerpt: '(unknown)', link: null, subtitle: null };
}

export default function Ratings() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ratings', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status}`);
        const j = await res.json();
        setRows(j.rows);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let out = rows;
    if (ratingFilter !== 'all') out = out.filter(r => r.rating === ratingFilter);
    if (kindFilter !== 'all') out = out.filter(r => (r.kind || 'event') === kindFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(r => {
        const m = rowMeta(r);
        return (
          (m.author || '').toLowerCase().includes(q) ||
          m.excerpt.toLowerCase().includes(q) ||
          (r.reason || '').toLowerCase().includes(q) ||
          (r.note || '').toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [rows, ratingFilter, kindFilter, search]);

  const ratingCounts = useMemo(() => {
    const c = { all: rows.length, signal: 0, noise: 0, cleared: 0 };
    rows.forEach(r => { c[r.rating]++; });
    return c;
  }, [rows]);

  const kindCounts = useMemo(() => {
    const c = { all: rows.length, event: 0, draft: 0, post: 0 };
    rows.forEach(r => {
      const k = (r.kind || 'event') as 'event' | 'draft' | 'post';
      if (k in c) c[k]++;
    });
    return c;
  }, [rows]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Ratings archive</h1>
        <div className="space-x-4 text-xs">
          <Link href="/" className="underline">← back</Link>
          <Link href="/drafts" className="underline opacity-60">Drafts</Link>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-4">
        Every rating action across events, angles, and post variants. Permanent log — edits and clears
        are recorded as new rows. Latest 1000.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search author, content, reason, note…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs opacity-50 uppercase mr-1">Kind:</span>
        {(['all', 'event', 'draft', 'post'] as KindFilter[]).map(k => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              kindFilter === k
                ? 'bg-white text-black border-white font-medium'
                : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            {k}<span className="ml-1.5 opacity-60">{kindCounts[k]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs opacity-50 uppercase mr-1">Rating:</span>
        {(['all', 'signal', 'noise', 'cleared'] as RatingFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setRatingFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              ratingFilter === f
                ? 'bg-white text-black border-white font-medium'
                : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            {f}<span className="ml-1.5 opacity-60">{ratingCounts[f]}</span>
          </button>
        ))}
      </div>

      {loading && <p className="opacity-50 text-sm">Loading…</p>}
      {error && (
        <div className="border border-red-500/50 bg-red-500/10 text-red-200 rounded p-3 mb-4 text-sm">
          fetch error: {error}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="opacity-50 text-sm">No ratings match.</p>
      )}

      {filtered.length > 0 && (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-neutral-900/80 text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">@author</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Rating</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const m = rowMeta(r);
                const k = (r.kind || 'event') as Row['kind'];
                return (
                  <tr key={r.id} className="border-t border-neutral-800 align-top hover:bg-neutral-900/30">
                    <td className="px-3 py-2 whitespace-nowrap font-mono opacity-70">{fmtTime(r.rated_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded border ${kindBadge(k)}`}>{k}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {m.author ? (
                        <a
                          href={`https://x.com/${m.author}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          @{m.author}
                        </a>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[420px]">
                      {m.link ? (
                        <Link href={m.link} className="line-clamp-2 hover:underline">
                          {m.excerpt.length > 240 ? m.excerpt.slice(0, 240) + '…' : m.excerpt}
                        </Link>
                      ) : (
                        <span className="line-clamp-2">{m.excerpt}</span>
                      )}
                      {m.subtitle && (
                        <div className="opacity-40 mt-0.5 line-clamp-1">{m.subtitle}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${ratingBadge(r.rating)}`}>
                        {r.rating}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.reason || <span className="opacity-30">—</span>}</td>
                    <td className="px-3 py-2 max-w-[280px]">
                      {r.note ? (
                        <span className="italic opacity-80">"{r.note}"</span>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs opacity-40 mt-4">
        Showing {filtered.length} of {rows.length} entries
      </p>
    </main>
  );
}
