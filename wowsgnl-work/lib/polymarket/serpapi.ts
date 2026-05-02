// SerpAPI Google News engine. Auth via ?api_key=.
//
// Three daily queries against US Google News, last-24h filter:
//   - "Polymarket"
//   - "Kalshi"
//   - "prediction market" OR "event contract"
//
// Cap ~20 results each → 60 results/day → 1800/month, well under the
// $25 plan's 5000-search budget. Each result is normalized for events-
// table insert with a stable hash-of-URL source_id.

import { createHash } from 'crypto';

const BASE = 'https://serpapi.com/search';

function key(): string {
  return process.env.SERPAPI_KEY || '';
}

export type SerpItem = {
  source_id: string;     // sha1 of canonical URL
  title: string;
  body: string;          // snippet
  url: string;
  source_name: string;   // publication name
  occurred_at: string | null;
};

function hashUrl(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 24);
}

async function fetchQuery(q: string): Promise<SerpItem[]> {
  if (!key()) return [];
  const u = new URL(BASE);
  u.searchParams.set('engine', 'google_news');
  u.searchParams.set('q', q);
  u.searchParams.set('gl', 'us');
  u.searchParams.set('hl', 'en');
  // Time-restrict to last 24 hours; tbs=qdr:d is Google's "past day" filter.
  u.searchParams.set('tbs', 'qdr:d');
  u.searchParams.set('num', '20');
  u.searchParams.set('api_key', key());

  const res = await fetch(u.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`serpapi ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  // Google News results live under news_results; sometimes Google
  // groups stories under stories[]. Walk both shapes.
  const out: SerpItem[] = [];
  const seen = new Set<string>();
  function pushOne(r: any) {
    const url = String(r.link || '');
    if (!url) return;
    const sid = hashUrl(url);
    if (seen.has(sid)) return;
    seen.add(sid);
    out.push({
      source_id: sid,
      title: String(r.title || '').slice(0, 500),
      body: String(r.snippet || r.summary || '').slice(0, 1000),
      url,
      source_name: String(r.source?.name || r.source || '').slice(0, 120),
      occurred_at: r.date || null,
    });
  }
  for (const r of data.news_results || []) {
    pushOne(r);
    for (const sub of r.stories || []) pushOne(sub);
  }
  for (const r of data.stories || []) pushOne(r);
  return out;
}

export async function fetchSerpapiRecent(): Promise<SerpItem[]> {
  if (!key()) return [];
  const queries = [
    'Polymarket',
    'Kalshi',
    '"prediction market" OR "event contract"',
  ];
  const results = await Promise.allSettled(queries.map(q => fetchQuery(q)));
  const out: SerpItem[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (seen.has(item.source_id)) continue;
      seen.add(item.source_id);
      out.push(item);
    }
  }
  return out;
}
