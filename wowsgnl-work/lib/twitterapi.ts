const BASE = 'https://api.twitterapi.io';

function parseTweetDate(s: string): number {
  // twitterapi.io returns Twitter-style dates like "Wed Apr 29 21:50:00 +0000 2026"
  // or sometimes ISO. Try both.
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  return 0;
}

// Compare numeric tweet IDs as strings (since they exceed JS safe integer).
// Returns >0 if a > b, <0 if a < b, 0 if equal.
function cmpId(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

type FetchResult = {
  tweets: any[];
  // largest source_id we observed in the *raw* (pre-filter) response; used to
  // advance last_seen_source_id even when all returned tweets are RTs/older.
  newestSeenId: string | null;
};

function filterAndCap(rawTweets: any[], sinceMinutes: number, lastSeenId: string | null, cap: number): FetchResult {
  const cutoff = Date.now() - sinceMinutes * 60_000;

  // Track newest id seen (across raw response, before filters)
  let newestSeenId: string | null = lastSeenId;
  for (const t of rawTweets) {
    const id = t.id ? String(t.id) : null;
    if (id && (newestSeenId === null || cmpId(id, newestSeenId) > 0)) newestSeenId = id;
  }

  const filtered = rawTweets.filter((t: any) => {
    const id = t.id ? String(t.id) : null;
    // skip if older than (or equal to) what we've already ingested for this watcher
    if (id && lastSeenId && cmpId(id, lastSeenId) <= 0) return false;
    if ((t.text || '').startsWith('RT @')) return false;
    const ts = parseTweetDate(t.createdAt);
    return ts === 0 || ts > cutoff;
  });

  // Sort newest-first then cap
  filtered.sort((a: any, b: any) => cmpId(String(b.id || '0'), String(a.id || '0')));
  return { tweets: filtered.slice(0, cap), newestSeenId };
}

export async function fetchUserTweets(
  username: string,
  opts: { sinceMinutes?: number; lastSeenId?: string | null; cap?: number } = {}
): Promise<FetchResult> {
  const sinceMinutes = opts.sinceMinutes ?? 1440;
  const lastSeenId = opts.lastSeenId ?? null;
  const cap = opts.cap ?? 20;

  const res = await fetch(
    `${BASE}/twitter/user/last_tweets?userName=${encodeURIComponent(username)}`,
    { headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`twitterapi ${res.status}: ${body}`);
  }
  const data = await res.json();
  const raw = data.tweets || data.data?.tweets || [];
  return filterAndCap(raw, sinceMinutes, lastSeenId, cap);
}

export async function searchTweets(
  query: string,
  opts: { sinceMinutes?: number; lastSeenId?: string | null; cap?: number } = {}
): Promise<FetchResult> {
  const sinceMinutes = opts.sinceMinutes ?? 1440;
  const lastSeenId = opts.lastSeenId ?? null;
  const cap = opts.cap ?? 20;

  const res = await fetch(
    `${BASE}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest`,
    { headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`twitterapi ${res.status}: ${body}`);
  }
  const data = await res.json();
  const raw = data.tweets || data.data?.tweets || [];
  return filterAndCap(raw, sinceMinutes, lastSeenId, cap);
}
