'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Row = {
  id: number;
  event_id: number;
  rating: 'signal' | 'noise' | 'cleared';
  reason: string | null;
  note: string | null;
  rated_at: string;
  author: string | null;
  content: string | null;
  url: string | null;
};

type RatingFilter = 'all' | 'signal' | 'noise' | 'cleared';
type SortKey = 'rated_at' | 'author' | 'rating';

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

export default function Ratings() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RatingFilter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('rated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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
    if (filter !== 'all') out = out.filter(r => r.rating === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        r =>
          (r.author || '').toLowerCase().includes(q) ||
          (r.content || '').toLowerCase().includes(q) ||
          (r.reason || '').toLowerCase().includes(q) ||
          (r.note || '').toLowerCase().includes(q)
      );
    }
    out = [...out].sort((a, b) => {
      let va: any = a[sortKey];
      let vb: any = b[sortKey];
      if (sortKey === 'rated_at') {
        va = Date.parse(a.rated_at);
        vb = Date.parse(b.rated_at);
      } else {
        va = (va || '').toString();
        vb = (vb || '').toString();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, filter, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'rated_at' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const counts = useMemo(() => {
    const c = { all: rows.length, signal: 0, noise: 0, cleared: 0 };
    rows.forEach(r => { c[r.rating]++; });
    return c;
  }, [rows]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Ratings archive</h1>
        <div className="space-x-4 text-xs">
          <Link href="/" className="underline">← back</Link>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-4">
        Full audit log of every rating action. Each rating, edit, and clear is recorded.
        Latest 1000 entries.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search author, content, reason, or note…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
        />
        <div className="flex gap-1">
          {(['all', 'signal', 'noise', 'cleared'] as RatingFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                filter === f
                  ? 'bg-white text-black border-white font-medium'
                  : 'border-neutral-700 hover:border-neutral-500'
              }`}
            >
              {f}<span className="ml-1.5 opacity-60">{counts[f]}</span>
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
        <p className="opacity-50 text-sm">No ratings match.</p>
      )}

      {filtered.length > 0 && (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-neutral-900/80 text-left">
              <tr>
                <th className="px-3 py-2 cursor-pointer hover:bg-neutral-800" onClick={() => toggleSort('rated_at')}>
                  Time{sortIndicator('rated_at')}
                </th>
                <th className="px-3 py-2 cursor-pointer hover:bg-neutral-800" onClick={() => toggleSort('author')}>
                  @author{sortIndicator('author')}
                </th>
                <th className="px-3 py-2">Tweet</th>
                <th className="px-3 py-2 cursor-pointer hover:bg-neutral-800" onClick={() => toggleSort('rating')}>
                  Rating{sortIndicator('rating')}
                </th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-neutral-800 align-top hover:bg-neutral-900/30">
                  <td className="px-3 py-2 whitespace-nowrap font-mono opacity-70">{fmtTime(r.rated_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.author ? (
                      <a
                        href={`https://x.com/${r.author}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        @{r.author}
                      </a>
                    ) : (
                      <span className="opacity-40">(deleted)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[360px]">
                    {r.content ? (
                      <Link href={`/event/${r.event_id}`} className="line-clamp-2 hover:underline">
                        {r.content.length > 240 ? r.content.slice(0, 240) + '…' : r.content}
                      </Link>
                    ) : (
                      <span className="opacity-40">(event deleted)</span>
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
              ))}
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
