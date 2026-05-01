import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
import { getClustersForTopPicks, ClusterCandidate } from '@/lib/clusters';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type EventRow = {
  id: number;
  author: string | null;
  content: string;
  url: string | null;
  posted_at: string | null;
  created_at: string;
  relevance_score: number | null;
  relevance_reason: string | null;
  audience_role: string | null;
  party: string | null;
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

export default async function BriefingPage() {
  const client = await getCurrentClient();
  if (!client) redirect('/');
  if (client.mode !== 'intelligence') redirect('/');
  const cid = client.id;

  // Pull all last-24h events for this client with audience_role joined
  // from the watchlist row that matches author == value (case-insensitive).
  // LEFT JOIN so events from authors not on the watchlist (e.g. ingested
  // via x_keyword) still come through with audience_role=NULL.
  const r = await sql`
    SELECT e.id, e.author, e.content, e.url, e.posted_at, e.created_at,
           e.relevance_score, e.relevance_reason,
           w.audience_role,
           w.party
    FROM events e
    LEFT JOIN LATERAL (
      SELECT audience_role, party
      FROM watchlist
      WHERE client_id = e.client_id
        AND kind = 'x_account'
        AND LOWER(value) = LOWER(e.author)
      LIMIT 1
    ) w ON TRUE
    WHERE e.client_id = ${cid}
      AND COALESCE(e.posted_at, e.created_at) >= NOW() - INTERVAL '24 hours'
      AND (e.feedback IS DISTINCT FROM 'noise')
    ORDER BY e.relevance_score DESC NULLS LAST,
             COALESCE(e.posted_at, e.created_at) DESC
    LIMIT 200
  `;
  const allEvents: EventRow[] = r.rows;

  // Section A: top stories — score>=7, clustered, top 5 clusters
  const topPickRaw = allEvents.filter(e => (e.relevance_score ?? 0) >= 7).slice(0, 30);
  const candidates: ClusterCandidate[] = topPickRaw.map(e => ({
    id: e.id,
    author: e.author,
    content: e.content,
    relevance_score: e.relevance_score,
  }));
  const clusters = topPickRaw.length > 0 ? await getClustersForTopPicks(cid, candidates) : [];
  const byId = new Map<number, EventRow>();
  for (const e of topPickRaw) byId.set(e.id, e);

  const stories = clusters
    .map(c => {
      const primary = byId.get(c.primary_event_id);
      if (!primary) return null;
      const related = c.related_event_ids.map(rid => byId.get(rid)).filter(Boolean) as EventRow[];
      return { cluster_topic: c.cluster_topic, primary, related };
    })
    .filter((x): x is { cluster_topic: string; primary: EventRow; related: EventRow[] } => Boolean(x))
    .sort((a, b) => (b.primary.relevance_score ?? 0) - (a.primary.relevance_score ?? 0))
    .slice(0, 5);

  // Section B: DC sentiment — score>=5, audience_role in staffer/journalist/official
  const dcSentiment = allEvents.filter(e =>
    (e.relevance_score ?? 0) >= 5 &&
    (e.audience_role === 'staffer' || e.audience_role === 'journalist' || e.audience_role === 'official'),
  ).slice(0, 12);

  // Section C: creator activity
  const creators = allEvents.filter(e =>
    (e.relevance_score ?? 0) >= 5 && e.audience_role === 'creator',
  ).slice(0, 12);

  const totals = {
    last24h: allEvents.length,
    topPicks: topPickRaw.length,
    clusters: clusters.length,
    dc: dcSentiment.length,
    creators: creators.length,
  };

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
        Live intelligence digest · last 24h
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Stat label="Events 24h" value={totals.last24h} />
        <Stat label="Score 7+" value={totals.topPicks} />
        <Stat label="Clusters" value={totals.clusters} />
        <Stat label="DC voices" value={totals.dc} />
        <Stat label="Creators" value={totals.creators} />
      </div>

      <Section title="Top stories" sub="score 7+, clustered">
        {stories.length === 0 ? (
          <Empty msg="No score≥7 events in the last 24h. Either the feed is quiet or nothing is hitting the bar yet." />
        ) : (
          <div className="space-y-3">
            {stories.map(s => (
              <article key={s.primary.id} className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-4">
                <div className="text-xs uppercase tracking-wider font-semibold text-purple-300/80 mb-2">
                  {s.cluster_topic}
                </div>
                <header className="flex items-center gap-2 flex-wrap mb-2 text-xs">
                  <span className="font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/40">
                    {s.primary.relevance_score}/10
                  </span>
                  {s.primary.author && (
                    <a href={`https://x.com/${s.primary.author}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      @{s.primary.author}
                    </a>
                  )}
                  {s.primary.audience_role && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {s.primary.audience_role}
                    </span>
                  )}
                  {s.primary.party && (
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${partyClass(s.primary.party)}`}>
                      {s.primary.party}
                    </span>
                  )}
                  <span className="opacity-50">{timeAgo(s.primary.posted_at || s.primary.created_at)}</span>
                </header>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.primary.content}</p>
                {s.primary.relevance_reason && (
                  <p className="text-xs opacity-60 italic mt-2">{s.primary.relevance_reason}</p>
                )}
                {s.related.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-purple-500/20 text-xs">
                    <span className="opacity-60">+{s.related.length} echoing this from </span>
                    {s.related.slice(0, 5).map((r, i) => (
                      <span key={r.id}>
                        <a href={`https://x.com/${r.author}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          @{r.author}
                        </a>
                        {i < Math.min(s.related.length, 5) - 1 ? ', ' : ''}
                      </span>
                    ))}
                    {s.related.length > 5 && <span className="opacity-60"> +{s.related.length - 5} more</span>}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-purple-500/20 flex gap-2 text-xs">
                  <Link href={`/event/${s.primary.id}`} className="underline opacity-70 hover:opacity-100">
                    Open →
                  </Link>
                  {s.primary.url && (
                    <a href={s.primary.url} target="_blank" rel="noopener noreferrer" className="underline opacity-70 hover:opacity-100">
                      X ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="DC sentiment" sub="staffers, journalists, officials · score 5+">
        {dcSentiment.length === 0 ? (
          <Empty msg="No DC-tagged accounts have posted scoring 5+ in the last 24h. Tag handles on /watchlist with audience role to populate this." />
        ) : (
          <ul className="space-y-2">
            {dcSentiment.map(e => <CompactRow key={e.id} ev={e} />)}
          </ul>
        )}
      </Section>

      <Section title="Creator activity" sub="liberal influencers · score 5+">
        {creators.length === 0 ? (
          <Empty msg="No creator-tagged accounts have posted scoring 5+ in the last 24h." />
        ) : (
          <ul className="space-y-2">
            {creators.map(e => <CompactRow key={e.id} ev={e} />)}
          </ul>
        )}
      </Section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-neutral-800 rounded-lg p-3">
      <div className="text-xs opacity-60 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-purple-300">{title}</h2>
        <span className="text-xs opacity-50">{sub}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-sm opacity-50 italic">{msg}</p>;
}

function partyClass(p: string): string {
  if (p === 'D') return 'border-blue-500/40 bg-blue-500/10 text-blue-200';
  if (p === 'R') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (p === 'I') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200';
  return 'border-neutral-800 bg-neutral-900 text-neutral-300';
}

function CompactRow({ ev }: { ev: EventRow }) {
  return (
    <li className="border border-neutral-800 rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap text-xs mb-1">
        <span className="font-bold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
          {ev.relevance_score}/10
        </span>
        {ev.author && (
          <a href={`https://x.com/${ev.author}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
            @{ev.author}
          </a>
        )}
        {ev.audience_role && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
            {ev.audience_role}
          </span>
        )}
        {ev.party && (
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${partyClass(ev.party)}`}>
            {ev.party}
          </span>
        )}
        <span className="opacity-50">·</span>
        <span className="opacity-50">{timeAgo(ev.posted_at || ev.created_at)}</span>
        <span className="flex-1" />
        <Link href={`/event/${ev.id}`} className="underline opacity-70 hover:opacity-100">open</Link>
        {ev.url && (
          <a href={ev.url} target="_blank" rel="noopener noreferrer" className="underline opacity-70 hover:opacity-100">
            X ↗
          </a>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap leading-snug">{ev.content}</p>
    </li>
  );
}
