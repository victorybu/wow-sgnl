'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Example = {
  id: number;
  source: 'shipped_post' | 'manual';
  source_post_id: number | null;
  source_event_id: number | null;
  content: string;
  context: string | null;
  angle: string | null;
  original_draft: string | null;
  was_edited: boolean;
  weight: number;
  notes: string | null;
  added_at: string;
};

type Payload = {
  client: { id: number; name: string; voice_profile: string };
  examples: Example[];
  stats: {
    total: number;
    active: number;
    excluded: number;
    boosted: number;
    from_shipped: number;
    from_manual: number;
    edited: number;
  };
  active_in_prompt: number;
  prompt_preview: string;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function tokenDiff(a: string, b: string): { ratio: number; aWords: number; bWords: number } {
  const aw = a.trim().split(/\s+/);
  const bw = b.trim().split(/\s+/);
  const setA = new Set(aw.map(s => s.toLowerCase()));
  const setB = new Set(bw.map(s => s.toLowerCase()));
  let intersect = 0;
  setA.forEach(w => { if (setB.has(w)) intersect++; });
  const union = new Set([...Array.from(setA), ...Array.from(setB)]);
  const sim = union.size === 0 ? 1 : intersect / union.size;
  return { ratio: 1 - sim, aWords: aw.length, bWords: bw.length };
}

export default function VoicePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [adding, setAdding] = useState(false);
  const [manualContent, setManualContent] = useState('');
  const [manualNotes, setManualNotes] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/voice', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      setData(j);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateWeight = async (id: number, weight: number) => {
    await fetch(`/api/voice/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weight }),
    });
    load();
  };

  const removeExample = async (id: number) => {
    if (!confirm('Delete this example permanently?')) return;
    await fetch(`/api/voice/${id}`, { method: 'DELETE' });
    load();
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !manualContent.trim()) return;
    setAdding(true);
    try {
      await fetch('/api/voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: data.client.id,
          content: manualContent.trim(),
          notes: manualNotes.trim() || null,
        }),
      });
      setManualContent('');
      setManualNotes('');
      load();
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <main className="max-w-4xl mx-auto p-6"><p className="opacity-50">Loading…</p></main>;
  if (error) return <main className="max-w-4xl mx-auto p-6"><p className="text-red-300">{error}</p></main>;
  if (!data) return null;
  if ((data.client as any).mode === 'intelligence') {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <Link href="/" className="text-xs underline opacity-60">← back to feed</Link>
        <div className="mt-6 border border-purple-500/30 bg-purple-500/5 rounded-lg p-4 text-sm">
          <p className="font-medium mb-1">{data.client.name} is an intelligence-mode client.</p>
          <p className="opacity-80">No voice loop — drafting is disabled. Visit <Link href="/briefing" className="underline">/briefing</Link> instead.</p>
        </div>
      </main>
    );
  }

  const active = data.examples.filter(e => e.weight > 0);
  const excluded = data.examples.filter(e => e.weight === 0);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4 text-xs">
        <Link href="/" className="underline opacity-60">← back to feed</Link>
        <div className="space-x-3 opacity-60">
          <Link href="/clients" className="underline">Clients</Link>
          <Link href="/drafts" className="underline">Drafts</Link>
          <Link href="/ratings" className="underline">Ratings</Link>
        </div>
      </div>

      <h1 className="text-2xl font-bold mb-1">{data.client.name} · Voice</h1>
      <p className="text-sm opacity-60 mb-6">
        How the system learns to write like {data.client.name}. Every post you ship becomes a curated example.
        Mark them as canon, boosted, or excluded — the next generation pulls from the active set.
      </p>

      {/* The big idea */}
      <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4 mb-6 text-sm">
        <div className="font-medium mb-1">The voice loop, in plain language:</div>
        <ol className="space-y-1 text-xs opacity-80 list-decimal list-inside">
          <li>You triage events and pick promising ones to draft.</li>
          <li>Claude generates angles + post variants using <strong>this voice profile + the active examples below</strong>.</li>
          <li>You edit and ship one. It gets added here automatically as a new example.</li>
          <li>The next time Claude writes, it sees the new example. Output gets sharper over time.</li>
        </ol>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Active in prompt" value={Math.min(data.active_in_prompt, 8)} sub={`${data.stats.active} total active`} />
        <Stat label="From shipped posts" value={data.stats.from_shipped} sub={`${data.stats.edited} you edited`} />
        <Stat label="Manual examples" value={data.stats.from_manual} />
        <Stat label="Excluded" value={data.stats.excluded} sub="weight=0" />
      </div>

      {/* Add manual example */}
      <details className="mb-6 border border-neutral-800 rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-medium">+ Add a manual voice example</summary>
        <p className="text-xs opacity-50 my-2">
          Paste any tweet that captures the voice — even one you didn't generate via this tool. Useful for
          seeding voice from {data.client.name}'s historical posts.
        </p>
        <form onSubmit={submitManual} className="space-y-2">
          <textarea
            value={manualContent}
            onChange={e => setManualContent(e.target.value.slice(0, 1000))}
            placeholder="Paste tweet content that captures the voice…"
            rows={4}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm"
          />
          <input
            value={manualNotes}
            onChange={e => setManualNotes(e.target.value.slice(0, 200))}
            placeholder="Note: what's distinctive about this one? (optional)"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-xs"
          />
          <button
            type="submit"
            disabled={adding || !manualContent.trim()}
            className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add example'}
          </button>
        </form>
      </details>

      {/* Live prompt preview */}
      <div className="mb-6">
        <button
          onClick={() => setShowPrompt(s => !s)}
          className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 mb-2"
        >
          {showPrompt ? '▼' : '▶'} See exactly what Claude reads (live prompt preview)
        </button>
        {showPrompt && (
          <pre className="text-xs whitespace-pre-wrap bg-neutral-950 border border-neutral-800 rounded p-4 max-h-[420px] overflow-auto">
{data.prompt_preview || '(empty — no voice profile or examples yet)'}
          </pre>
        )}
      </div>

      {/* Active examples */}
      <h2 className="text-sm font-bold uppercase opacity-70 mb-2">
        Active examples · {active.length}
      </h2>
      <p className="text-xs opacity-50 mb-3">
        These shape the next post Claude generates. Top {Math.min(8, data.active_in_prompt)} (highest weight + most recent) are pulled into the prompt.
      </p>
      <div className="space-y-3 mb-8">
        {active.length === 0 && (
          <p className="opacity-50 text-sm">
            No active examples yet. Ship a post (or add one manually) and it'll land here.
          </p>
        )}
        {active.map(ex => (
          <ExampleRow key={ex.id} ex={ex} onWeight={updateWeight} onDelete={removeExample} />
        ))}
      </div>

      {/* Excluded */}
      {excluded.length > 0 && (
        <details className="border-t border-neutral-800 pt-4">
          <summary className="cursor-pointer text-sm font-bold uppercase opacity-50">
            Excluded · {excluded.length}
          </summary>
          <div className="space-y-3 mt-3">
            {excluded.map(ex => (
              <ExampleRow key={ex.id} ex={ex} onWeight={updateWeight} onDelete={removeExample} />
            ))}
          </div>
        </details>
      )}
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

function ExampleRow({
  ex,
  onWeight,
  onDelete,
}: {
  ex: Example;
  onWeight: (id: number, weight: number) => void;
  onDelete: (id: number) => void;
}) {
  const diff = ex.was_edited && ex.original_draft ? tokenDiff(ex.original_draft, ex.content) : null;

  return (
    <article className={`border rounded-lg p-4 ${
      ex.weight === 0
        ? 'border-neutral-800 bg-neutral-900/30 opacity-60'
        : ex.weight > 1
          ? 'border-green-500/40 bg-green-500/5'
          : 'border-neutral-800'
    }`}>
      <header className="flex items-center gap-2 flex-wrap text-xs mb-2">
        <span className={`px-1.5 py-0.5 rounded border ${
          ex.source === 'shipped_post'
            ? 'bg-green-500/15 text-green-300 border-green-500/40'
            : 'bg-blue-500/15 text-blue-300 border-blue-500/40'
        }`}>
          {ex.source === 'shipped_post' ? 'shipped' : 'manual'}
        </span>
        {ex.was_edited && diff && (
          <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/40">
            edited · {Math.round(diff.ratio * 100)}% changed
          </span>
        )}
        <span className="opacity-50">{fmtDate(ex.added_at)}</span>
        {ex.source_event_id && (
          <Link href={`/event/${ex.source_event_id}`} className="opacity-50 hover:underline">
            see source →
          </Link>
        )}
      </header>

      {ex.context && (
        <div className="text-xs opacity-50 italic mb-2">in response to: "{ex.context.slice(0, 160)}{ex.context.length > 160 ? '…' : ''}"</div>
      )}
      {ex.angle && (
        <div className="text-xs opacity-50 mb-2">angle: {ex.angle}</div>
      )}

      <pre className="text-sm whitespace-pre-wrap font-mono bg-neutral-950 border border-neutral-900 rounded px-3 py-2 mb-2">
{ex.content}
      </pre>

      {ex.was_edited && ex.original_draft && (
        <details className="mb-2 text-xs">
          <summary className="cursor-pointer opacity-60">▶ Show Claude's original draft (you edited)</summary>
          <pre className="whitespace-pre-wrap font-mono bg-neutral-950 border border-neutral-900 rounded px-3 py-2 mt-1 opacity-70">
{ex.original_draft}
          </pre>
        </details>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs opacity-60">Weight:</span>
        <button
          onClick={() => onWeight(ex.id, 0)}
          className={`text-xs px-2 py-1 rounded border ${
            ex.weight === 0 ? 'bg-neutral-800 border-neutral-600 font-medium' : 'border-neutral-700 hover:border-neutral-500'
          }`}
        >
          excluded (0)
        </button>
        <button
          onClick={() => onWeight(ex.id, 1)}
          className={`text-xs px-2 py-1 rounded border ${
            ex.weight === 1 ? 'bg-neutral-700 border-neutral-500 font-medium' : 'border-neutral-700 hover:border-neutral-500'
          }`}
        >
          canon (1)
        </button>
        <button
          onClick={() => onWeight(ex.id, 2)}
          className={`text-xs px-2 py-1 rounded border ${
            ex.weight === 2 ? 'bg-green-500/30 border-green-500/60 text-green-200 font-medium' : 'border-neutral-700 hover:border-green-500/50'
          }`}
        >
          boosted (2)
        </button>
        <button
          onClick={() => onWeight(ex.id, 3)}
          className={`text-xs px-2 py-1 rounded border ${
            ex.weight === 3 ? 'bg-green-500/40 border-green-500/70 text-green-100 font-medium' : 'border-neutral-700 hover:border-green-500/50'
          }`}
        >
          gold (3)
        </button>
        <button
          onClick={() => onDelete(ex.id)}
          className="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-red-500/50 hover:text-red-300 ml-auto"
        >
          delete
        </button>
      </div>
    </article>
  );
}
