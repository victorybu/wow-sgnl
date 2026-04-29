import { sql } from '@vercel/postgres';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const events = await sql`
    SELECT e.*, c.name as client_name
    FROM events e LEFT JOIN clients c ON e.client_id = c.id
    WHERE e.status = 'new'
    ORDER BY e.relevance_score DESC NULLS LAST, e.created_at DESC
    LIMIT 50
  `;
  return (
    <main className="max-w-5xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Signal</h1>
        <div className="space-x-4 text-sm">
          <Link href="/watchlist" className="underline">Watchlist</Link>
          <Link href="/clients" className="underline">Clients</Link>
          <Link href="/api/setup" className="underline opacity-60">Init DB</Link>
          <Link href="/api/poll" className="underline opacity-60">Run Poll</Link>
        </div>
      </div>
      <div className="space-y-3">
        {events.rows.length === 0 && <p className="opacity-60">No events yet. Add a client and watchlist items, then hit "Run Poll".</p>}
        {events.rows.map((e: any) => (
          <div key={e.id} className="border border-neutral-800 rounded p-4 hover:border-neutral-600">
            <div className="flex justify-between text-xs opacity-60 mb-2">
              <span>{e.client_name} · {e.source} · {e.author}</span>
              <span className={`font-bold ${e.relevance_score >= 7 ? 'text-green-400' : e.relevance_score >= 5 ? 'text-yellow-400' : 'text-neutral-500'}`}>{e.relevance_score ?? '—'}/10</span>
            </div>
            <p className="text-sm mb-2">{e.content}</p>
            <p className="text-xs opacity-60 italic">{e.relevance_reason}</p>
            <div className="mt-3 space-x-2 text-xs">
              <Link href={`/event/${e.id}`} className="underline">Draft posts →</Link>
              {e.url && <a href={e.url} target="_blank" className="underline opacity-60">Source</a>}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
