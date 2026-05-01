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
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed' | null;
  topic_tags: string[] | null;
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
  // Topic-tagged events use a wider 7-day window so the operator can
  // still see Polymarket/Kalshi/etc mentions even on a quiet day. The
  // generic 24h window stays for top stories / DC sentiment.
  const r = await sql`
    SELECT e.id, e.author, e.content, e.url, e.posted_at, e.created_at,
           e.relevance_score, e.relevance_reason,
           e.sentiment, e.topic_tags,
           w.audience_role,
           w.party,
           CASE
             WHEN COALESCE(e.posted_at, e.created_at) >= NOW() - INTERVAL '24 hours' THEN TRUE
             ELSE FALSE
           END AS in_24h
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
      AND COALESCE(e.posted_at, e.created_at) >= NOW() - INTERVAL '7 days'
      AND (e.feedback IS DISTINCT FROM 'noise')
    ORDER BY e.relevance_score DESC NULLS LAST,
             COALESCE(e.posted_at, e.created_at) DESC
    LIMIT 400
  `;
  const allEvents: (EventRow & { in_24h?: boolean })[] = r.rows;
  const last24h = allEvents.filter(e => e.in_24h);

  // Section A: top stories — score>=7 in last 24h, clustered, top 5 clusters
  const topPickRaw = last24h.filter(e => (e.relevance_score ?? 0) >= 7).slice(0, 30);
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

  // Section B: DC sentiment — score>=5, audience_role in staffer/journalist/official, last 24h
  const dcSentiment = last24h.filter(e =>
    (e.relevance_score ?? 0) >= 5 &&
    (e.audience_role === 'staffer' || e.audience_role === 'journalist' || e.audience_role === 'official'),
  ).slice(0, 12);

  // Section C: creator activity, last 24h
  const creators = last24h.filter(e =>
    (e.relevance_score ?? 0) >= 5 && e.audience_role === 'creator',
  ).slice(0, 12);

  // Section D: topic mentions — last 7 days, grouped by topic_tag.
  // For each tag, count by sentiment + party, plus collect top quotes.
  type TopicAgg = {
    tag: string;
    total: number;
    by_sentiment: Record<string, number>;
    by_party: Record<string, number>;
    quotes: EventRow[];
  };
  const topicMap = new Map<string, TopicAgg>();
  for (const e of allEvents) {
    if (!e.topic_tags || e.topic_tags.length === 0) continue;
    for (const tag of e.topic_tags) {
      let agg = topicMap.get(tag);
      if (!agg) {
        agg = { tag, total: 0, by_sentiment: {}, by_party: {}, quotes: [] };
        topicMap.set(tag, agg);
      }
      agg.total++;
      const s = e.sentiment || 'neutral';
      agg.by_sentiment[s] = (agg.by_sentiment[s] || 0) + 1;
      const p = e.party || 'unsided';
      agg.by_party[p] = (agg.by_party[p] || 0) + 1;
      agg.quotes.push(e);
    }
  }
  // Top quotes per tag: by score desc, posted_at desc, cap 5.
  for (const agg of topicMap.values()) {
    agg.quotes.sort((a, b) => {
      const sa = a.relevance_score ?? 0;
      const sb = b.relevance_score ?? 0;
      if (sb !== sa) return sb - sa;
      const ta = Date.parse(a.posted_at || a.created_at) || 0;
      const tb = Date.parse(b.posted_at || b.created_at) || 0;
      return tb - ta;
    });
    agg.quotes = agg.quotes.slice(0, 5);
  }
  const topicAggs = Array.from(topicMap.values()).sort((a, b) => b.total - a.total);

  // 7-day tagged-event timeline (newest day on the right). Each bucket
  // is a calendar day in UTC; we render an ASCII sparkline so the
  // operator can see at a glance whether activity is rising / falling
  // / spiked yesterday. Bucket count is small (7) so we precompute
  // here and let the component just render the strings.
  const dayBuckets: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000);
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const count = allEvents.filter(e => {
      if (!e.topic_tags || e.topic_tags.length === 0) return false;
      const ts = Date.parse(e.posted_at || e.created_at);
      return Number.isFinite(ts) && ts >= dayStart.getTime() && ts < dayEnd.getTime();
    }).length;
    const label = day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    dayBuckets.push({ label, count });
  }

  const totals = {
    last24h: last24h.length,
    last7d: allEvents.length,
    topPicks: topPickRaw.length,
    clusters: clusters.length,
    dc: dcSentiment.length,
    creators: creators.length,
    tagged: allEvents.filter(e => e.topic_tags && e.topic_tags.length > 0).length,
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
        Live intelligence digest · top stories last 24h · topic mentions last 7d
      </p>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        <Stat label="Events 24h" value={totals.last24h} />
        <Stat label="Score 7+" value={totals.topPicks} />
        <Stat label="Clusters" value={totals.clusters} />
        <Stat label="DC voices" value={totals.dc} />
        <Stat label="Creators" value={totals.creators} />
        <Stat label="Tagged 7d" value={totals.tagged} />
      </div>

      {totals.tagged > 0 && (
        <div className="mb-6 border border-purple-500/20 bg-purple-500/5 rounded-lg p-4">
          <ActivityTimeline buckets={dayBuckets} />
        </div>
      )}

      <Section title="Topic mentions" sub="last 7 days · grouped by tag">
        {topicAggs.length === 0 ? (
          <Empty msg="No tagged mentions yet. Sentiment + topic_tags are written when polling scores intelligence-mode events; once tweets land in the next cron cycles, this section populates." />
        ) : (
          <div className="space-y-4">
            {topicAggs.map(agg => (
              <article key={agg.tag} className="border border-purple-500/30 bg-purple-500/5 rounded-lg p-4">
                <div className="flex items-baseline gap-2 mb-3 flex-wrap">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300">
                    {agg.tag.replace(/_/g, ' ')}
                  </h3>
                  <span className="text-xs opacity-50">{agg.total} mention{agg.total === 1 ? '' : 's'}</span>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-3">
                  <SentimentBars counts={agg.by_sentiment} />
                  <PartyBars counts={agg.by_party} />
                </div>

                <ul className="space-y-2">
                  {agg.quotes.map(q => (
                    <li key={q.id} className="text-xs border-l-2 border-purple-500/20 pl-3">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap opacity-70">
                        <SentimentBadge s={q.sentiment} />
                        {q.author && (
                          <a href={`https://x.com/${q.author}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            @{q.author}
                          </a>
                        )}
                        {q.audience_role && (
                          <span className="text-[10px] uppercase px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700">
                            {q.audience_role}
                          </span>
                        )}
                        {q.party && (
                          <span className={`text-[10px] uppercase px-1 py-0.5 rounded border ${partyClass(q.party)}`}>
                            {q.party}
                          </span>
                        )}
                        <span className="opacity-50">·</span>
                        <span className="opacity-50">{timeAgo(q.posted_at || q.created_at)}</span>
                        <span className="opacity-50">·</span>
                        <Link href={`/event/${q.id}`} className="underline opacity-70 hover:opacity-100">open</Link>
                      </div>
                      <p className="opacity-90 line-clamp-3 whitespace-pre-wrap">{q.content}</p>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Top stories" sub="score 7+, clustered, last 24h">
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
                  <SentimentBadge s={s.primary.sentiment} />
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

// ASCII bar generator. Returns "█████░░░░░" sized to `width` chars,
// proportional to `value/max`. Used for sentiment/party split bars
// and the 7-day timeline. Using monospace + block chars so the bars
// align cleanly across rows without any chart library.
function asciiBar(value: number, max: number, width = 12): string {
  if (max <= 0 || value <= 0) return '░'.repeat(width);
  const filled = Math.round((value / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

// Sparkline character for a single height. 0..max maps to ▁▂▃▄▅▆▇█.
const SPARK_CHARS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
function sparkChar(value: number, max: number): string {
  if (max <= 0 || value <= 0) return SPARK_CHARS[0];
  const idx = Math.min(8, Math.max(1, Math.round((value / max) * 8)));
  return SPARK_CHARS[idx];
}

function SentimentBars({ counts }: { counts: Record<string, number> }) {
  const rows: { label: string; key: string; color: string }[] = [
    { label: '+ positive', key: 'positive', color: 'text-green-300' },
    { label: '− negative', key: 'negative', color: 'text-red-300' },
    { label: '· neutral ', key: 'neutral',  color: 'text-neutral-400' },
    { label: '± mixed   ', key: 'mixed',    color: 'text-yellow-300' },
  ];
  const max = Math.max(1, ...rows.map(r => counts[r.key] || 0));
  return (
    <div className="font-mono text-xs leading-relaxed">
      {rows.map(r => {
        const n = counts[r.key] || 0;
        return (
          <div key={r.key} className={`flex gap-2 ${n === 0 ? 'opacity-30' : r.color}`}>
            <span className="w-20 shrink-0">{r.label}</span>
            <span className="select-none">{asciiBar(n, max, 14)}</span>
            <span className="w-8 text-right tabular-nums">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

function PartyBars({ counts }: { counts: Record<string, number> }) {
  const rows: { label: string; key: string; cls: string }[] = [
    { label: 'D-side  ', key: 'D',       cls: 'text-blue-300' },
    { label: 'R-side  ', key: 'R',       cls: 'text-red-300' },
    { label: 'I-side  ', key: 'I',       cls: 'text-yellow-300' },
    { label: 'unsided ', key: 'unsided', cls: 'text-neutral-400' },
  ];
  const max = Math.max(1, ...rows.map(r => counts[r.key] || 0));
  const visible = rows.filter(r => (counts[r.key] || 0) > 0);
  if (visible.length === 0) return null;
  return (
    <div className="font-mono text-xs leading-relaxed">
      {visible.map(r => {
        const n = counts[r.key] || 0;
        return (
          <div key={r.key} className={`flex gap-2 ${r.cls}`}>
            <span className="w-20 shrink-0">{r.label}</span>
            <span className="select-none">{asciiBar(n, max, 14)}</span>
            <span className="w-8 text-right tabular-nums">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActivityTimeline({ buckets }: { buckets: { label: string; count: number }[] }) {
  const max = Math.max(1, ...buckets.map(b => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div className="font-mono text-xs">
      <div className="opacity-50 mb-1">tagged events · last 7 days · total {total}</div>
      <div className="flex gap-1.5 items-end leading-none">
        {buckets.map((b, i) => (
          <div key={i} className="flex flex-col items-center w-7">
            <span className="text-purple-300 text-lg leading-none" title={`${b.count} on ${b.label}`}>
              {sparkChar(b.count, max)}
            </span>
            <span className="text-[10px] opacity-50 mt-0.5">{b.label.slice(0, 3)}</span>
            <span className="text-[10px] opacity-70 tabular-nums">{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SentimentPill({ kind, n }: { kind: 'positive' | 'negative' | 'neutral' | 'mixed'; n: number }) {
  if (n === 0) return null;
  const cls =
    kind === 'positive' ? 'border-green-500/40 bg-green-500/10 text-green-200' :
    kind === 'negative' ? 'border-red-500/40 bg-red-500/10 text-red-200' :
    kind === 'mixed' ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200' :
    'border-neutral-700 bg-neutral-900 text-neutral-300';
  const label = kind === 'positive' ? '+' : kind === 'negative' ? '−' : kind === 'mixed' ? '±' : '·';
  return (
    <span className={`px-2 py-0.5 rounded border ${cls}`}>
      {label} {kind}: {n}
    </span>
  );
}

function SentimentBadge({ s }: { s: 'positive' | 'negative' | 'neutral' | 'mixed' | null }) {
  if (!s) return null;
  const cls =
    s === 'positive' ? 'bg-green-500/20 text-green-300 border-green-500/40' :
    s === 'negative' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
    s === 'mixed' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' :
    'bg-neutral-800 text-neutral-400 border-neutral-700';
  const sym = s === 'positive' ? '+' : s === 'negative' ? '−' : s === 'mixed' ? '±' : '·';
  return (
    <span className={`text-[10px] font-bold w-4 h-4 inline-flex items-center justify-center rounded border ${cls}`}>
      {sym}
    </span>
  );
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
        <SentimentBadge s={ev.sentiment} />
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
