'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Line = { event: string; data: any; ts: number };

const KNOWN_EVENTS = [
  'log', 'watchlist',
  'fetch_start', 'fetch_done', 'fetch_error',
  'tweet',
  'unscored', 'score_start', 'score_done', 'score_error',
  'done', 'error',
];

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}

function colorFor(event: string): string {
  if (event === 'tweet') return 'border-blue-500/40 bg-blue-500/5';
  if (event === 'score_done') return 'border-green-500/40 bg-green-500/5';
  if (event === 'fetch_start' || event === 'score_start') return 'border-neutral-700 bg-neutral-900/40';
  if (event.endsWith('_error') || event === 'error') return 'border-red-500/50 bg-red-500/10';
  if (event === 'done') return 'border-green-500 bg-green-500/10';
  return 'border-neutral-800';
}

export default function RunPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ inserted: number; scored: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const start = () => {
    if (running) return;
    setLines([]);
    setSummary(null);
    setRunning(true);
    const es = new EventSource('/api/run/stream');
    esRef.current = es;

    const append = (event: string, raw: string) => {
      let data: any = {};
      try { data = JSON.parse(raw); } catch { data = { raw }; }
      setLines(prev => [...prev, { event, data, ts: Date.now() }]);
      if (event === 'done') {
        setSummary({ inserted: data.inserted ?? 0, scored: data.scored ?? 0 });
        es.close();
        setRunning(false);
      }
      if (event === 'error') {
        es.close();
        setRunning(false);
      }
    };

    KNOWN_EVENTS.forEach(name => {
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
    <main className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Run</h1>
        <Link href="/" className="text-sm underline opacity-60">← back</Link>
      </div>

      <div className="flex gap-3 items-center mb-6">
        <button
          onClick={start}
          disabled={running}
          className="bg-white text-black px-4 py-2 rounded text-sm font-bold disabled:opacity-40"
        >
          {running ? 'Running…' : 'Start poll'}
        </button>
        {running && (
          <button onClick={stop} className="text-xs underline opacity-60">stop</button>
        )}
        {summary && (
          <span className="text-xs opacity-70">
            inserted {summary.inserted} · scored {summary.scored}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {lines.length === 0 && !running && (
          <p className="opacity-50 text-sm">Click Start poll to fetch tweets, score, and stream progress here.</p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`border rounded px-3 py-2 text-xs ${colorFor(l.event)}`}>
            <div className="flex justify-between items-start gap-3">
              <span className="font-mono uppercase opacity-70 shrink-0">{l.event}</span>
              <span className="opacity-40 font-mono shrink-0">{fmtTime(l.ts)}</span>
            </div>
            {l.event === 'tweet' && (
              <div className="mt-1">
                <span className="opacity-70">@{l.data.author}: </span>
                <span>{l.data.content}</span>
              </div>
            )}
            {l.event === 'score_start' && (
              <div className="mt-1 opacity-80">@{l.data.author}: {l.data.content}</div>
            )}
            {l.event === 'score_done' && (
              <div className="mt-1">
                <span className={`font-bold ${l.data.score >= 7 ? 'text-green-400' : l.data.score >= 5 ? 'text-yellow-400' : 'text-neutral-500'}`}>
                  {l.data.score}/10
                </span>
                <span className="opacity-70"> — {l.data.reason}</span>
              </div>
            )}
            {l.event === 'fetch_start' && (
              <div className="mt-1 opacity-80">{l.data.kind} · {l.data.value} · {l.data.client}</div>
            )}
            {l.event === 'fetch_done' && (
              <div className="mt-1 opacity-80">{l.data.value}: {l.data.count} tweets</div>
            )}
            {l.event === 'watchlist' && (
              <div className="mt-1 opacity-80">{l.data.count} active watchers</div>
            )}
            {l.event === 'unscored' && (
              <div className="mt-1 opacity-80">{l.data.count} events to score</div>
            )}
            {(l.event === 'fetch_error' || l.event === 'score_error' || l.event === 'error') && (
              <pre className="mt-1 whitespace-pre-wrap text-red-300">{JSON.stringify(l.data, null, 2)}</pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </main>
  );
}
