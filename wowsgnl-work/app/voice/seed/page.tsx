'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type LogLine = { event: string; data: any; ts: number };

const KNOWN = [
  'log',
  'page',
  'fetch_done',
  'filter_done',
  'percentile',
  'selection_done',
  'tag_progress',
  'tag_error',
  'insert_progress',
  'insert_error',
  'done',
  'error',
];

function color(event: string): string {
  if (event === 'done') return 'border-green-500 bg-green-500/10';
  if (event === 'error' || event.endsWith('_error')) return 'border-red-500/40 bg-red-500/10';
  if (event === 'fetch_done' || event === 'filter_done' || event === 'selection_done' || event === 'percentile')
    return 'border-blue-500/40 bg-blue-500/5';
  if (event === 'page' || event.endsWith('_progress')) return 'border-neutral-700 bg-neutral-900/40';
  return 'border-neutral-800';
}

export default function SeedPage() {
  const [clientId, setClientId] = useState<number | ''>('');
  const [clientName, setClientName] = useState('');
  const [username, setUsername] = useState('');
  const [pages, setPages] = useState(50);
  const [ageMonths, setAgeMonths] = useState(18);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; fetched: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load current client name on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/clients', { cache: 'no-store' });
        const j = await r.json();
        const cur = j.clients.find((c: any) => c.id === j.current_id);
        if (cur) {
          setClientId(cur.id);
          setClientName(cur.name);
          if (cur.name === 'Khanna') setUsername('RepRoKhanna');
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const start = () => {
    if (running || !username || !clientId) return;
    setLines([]);
    setSummary(null);
    setRunning(true);
    const url = `/api/voice/seed?username=${encodeURIComponent(username)}&pages=${pages}&age_months=${ageMonths}&client_id=${clientId}`;
    const es = new EventSource(url);
    esRef.current = es;
    const append = (event: string, raw: string) => {
      let data: any = {};
      try { data = JSON.parse(raw); } catch { data = { raw }; }
      setLines(prev => [...prev, { event, data, ts: Date.now() }]);
      if (event === 'done') {
        setSummary({
          imported: data.imported ?? 0,
          skipped: data.skipped ?? 0,
          fetched: data.fetched ?? 0,
        });
        es.close();
        setRunning(false);
      }
      if (event === 'error') {
        es.close();
        setRunning(false);
      }
    };
    KNOWN.forEach(name => {
      es.addEventListener(name, (e: MessageEvent) => append(name, e.data));
    });
    es.onerror = () => {
      es.close();
      setRunning(false);
    };
  };

  const stop = () => {
    esRef.current?.close();
    setRunning(false);
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4 text-xs">
        <Link href="/voice" className="underline opacity-60">← back to voice</Link>
        <Link href="/" className="underline opacity-60">feed</Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">Seed voice from history</h1>
      <p className="text-sm opacity-60 mb-4">
        Pulls historical tweets via twitterapi.io for {clientName || '(no client)'}, ranks by engagement
        velocity over the last {ageMonths} months, auto-imports the top 50% as voice examples (top 5% as
        gold, next 20% as boosted, next 25% as canon). Bottom half is skipped — those aren't gold-standard
        voice.
      </p>

      <div className="border border-neutral-800 rounded-lg p-4 mb-6 space-y-3">
        <div>
          <label className="text-xs opacity-70 block mb-1">Client</label>
          <div className="text-sm">
            {clientName ? <strong>{clientName}</strong> : <span className="opacity-50">loading…</span>}
            {clientId && <span className="ml-2 opacity-50 text-xs">(id={clientId})</span>}
          </div>
        </div>
        <div>
          <label className="text-xs opacity-70 block mb-1">X handle (no @)</label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value.replace(/^@/, '').trim())}
            placeholder="e.g. RepRoKhanna"
            disabled={running}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs opacity-70 block mb-1">Pages back (≈20 tweets/page)</label>
            <input
              type="number"
              value={pages}
              onChange={e => setPages(Math.max(1, Math.min(100, Number(e.target.value) || 50)))}
              disabled={running}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs opacity-70 block mb-1">Max age (months)</label>
            <input
              type="number"
              value={ageMonths}
              onChange={e => setAgeMonths(Math.max(1, Math.min(48, Number(e.target.value) || 18)))}
              disabled={running}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={start}
            disabled={running || !username || !clientId}
            className="bg-white text-black px-4 py-2 rounded text-sm font-bold disabled:opacity-40"
          >
            {running ? 'Running…' : 'Start seed'}
          </button>
          {running && (
            <button onClick={stop} className="text-xs underline opacity-60">stop</button>
          )}
          {summary && (
            <span className="text-xs opacity-70">
              ✅ imported {summary.imported} · skipped {summary.skipped} · fetched {summary.fetched}
            </span>
          )}
          {summary && summary.imported > 0 && (
            <Link href="/voice" className="text-xs underline ml-auto">See examples →</Link>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {lines.length === 0 && !running && (
          <p className="opacity-50 text-sm">Click Start seed to begin. Live progress will stream here.</p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`border rounded px-3 py-2 text-xs ${color(l.event)}`}>
            <div className="flex justify-between items-start gap-3">
              <span className="font-mono uppercase opacity-70 shrink-0">{l.event}</span>
              <span className="opacity-40 font-mono shrink-0">
                {new Date(l.ts).toLocaleTimeString()}
              </span>
            </div>
            {l.event === 'page' && (
              <div className="mt-1 opacity-80">
                page {l.data.page} · {l.data.fetched_this_page} tweets {l.data.has_cursor ? '· next page →' : '(no more pages)'}
              </div>
            )}
            {l.event === 'fetch_done' && (
              <div className="mt-1">
                fetched <strong>{l.data.total_fetched}</strong> total tweets across {l.data.pages_used} pages
              </div>
            )}
            {l.event === 'filter_done' && (
              <div className="mt-1">
                kept <strong>{l.data.kept}</strong> · dropped {l.data.dropped_rt} RTs · {l.data.dropped_reply} replies · {l.data.dropped_age} too old · {l.data.dropped_empty} empty
              </div>
            )}
            {l.event === 'percentile' && (
              <div className="mt-1 opacity-80">
                n={l.data.n} · p50={l.data.p50} · p75={l.data.p75} · p95={l.data.p95} (gold/boost/canon thresholds)
              </div>
            )}
            {l.event === 'selection_done' && (
              <div className="mt-1">
                will import <strong>{l.data.to_import}</strong> · skip {l.data.skipped_low_engagement} below median ·
                {' '}🥇 {l.data.gold_count} gold / 🚀 {l.data.boost_count} boosted / ✓ {l.data.canon_count} canon
              </div>
            )}
            {l.event === 'tag_progress' && (
              <div className="mt-1 opacity-80">tagged {l.data.chunks_done}/{l.data.chunks_total} chunks</div>
            )}
            {l.event === 'insert_progress' && (
              <div className="mt-1 opacity-80">inserted {l.data.inserted}/{l.data.total}</div>
            )}
            {l.event === 'done' && (
              <div className="mt-1 font-medium">
                done · imported {l.data.imported} · skipped {l.data.skipped} · fetched {l.data.fetched}
              </div>
            )}
            {(l.event === 'error' || l.event.endsWith('_error')) && (
              <pre className="mt-1 whitespace-pre-wrap text-red-300">{JSON.stringify(l.data, null, 2)}</pre>
            )}
            {l.event === 'log' && (
              <div className="mt-1 opacity-80">{l.data.msg}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </main>
  );
}
