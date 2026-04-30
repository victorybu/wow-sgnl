import { getCurrentClient } from '@/lib/clients';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function BriefingPage() {
  const client = await getCurrentClient();
  if (!client) redirect('/');
  if (client.mode !== 'intelligence') redirect('/');

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4 text-xs">
        <Link href="/" className="underline opacity-60">← back to feed</Link>
        <div className="space-x-3 opacity-60">
          <Link href="/watchlist" className="underline">Watchlist</Link>
          <Link href="/clients" className="underline">Clients</Link>
        </div>
      </div>

      <h1 className="text-2xl font-bold mb-1">{client.name} · Briefing</h1>
      <p className="text-sm opacity-60 mb-6">
        Intelligence-mode digest for {client.name}.
      </p>

      <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-6 text-sm">
        <p className="font-medium mb-2">📓 Briefing page is a stub.</p>
        <p className="opacity-80">
          Full daily-digest view (top score≥7 events from last 24h grouped by topic, DC sentiment,
          influencer activity, daily snapshot lock at 8am ET) is built in <strong>Item 8</strong> of the backlog.
        </p>
        <p className="opacity-60 mt-3 text-xs">
          For now the watchlist works for {client.name} (add accounts via /watchlist), polling will ingest
          tweets, scoring will rank them — they'll just appear on the regular feed when you switch to {client.name}.
          Intelligence-mode UI gating already hides drafting controls.
        </p>
      </div>
    </main>
  );
}
