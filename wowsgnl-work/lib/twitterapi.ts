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

/**
 * Paginated user-tweets fetcher for the voice-seed flow. Walks twitterapi.io's
 * cursor-based timeline, returning every original tweet (RTs + replies dropped)
 * within `maxAgeMonths`. Yields page-level callbacks for SSE progress UI.
 *
 * Returns the full list of tweets the user has posted (within constraints) so
 * the caller can compute engagement velocity statistics.
 */
export type HistoricalTweet = {
  id: string;
  text: string;
  createdAt: string;
  is_retweet?: boolean;
  isReply?: boolean;
  inReplyToId?: string | null;
  inReplyToUserId?: string | null;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount?: number | null;
};

function readNumeric(t: any, ...keys: string[]): number {
  for (const k of keys) {
    const v = t?.[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return 0;
}

function normalizeTweet(t: any): HistoricalTweet {
  const text = (t.text || t.full_text || '') as string;
  const isRT = !!(t.is_retweet || t.isRetweet || text.startsWith('RT @'));
  const inReplyToId = t.inReplyToId || t.in_reply_to_status_id_str || null;
  const inReplyToUserId = t.inReplyToUserId || t.in_reply_to_user_id_str || null;
  const isReply = !!(t.isReply ?? t.is_reply ?? (inReplyToId || inReplyToUserId) ?? text.startsWith('@'));
  return {
    id: String(t.id || t.id_str || ''),
    text,
    createdAt: t.createdAt || t.created_at || '',
    is_retweet: isRT,
    isReply,
    inReplyToId,
    inReplyToUserId,
    likeCount: readNumeric(t, 'likeCount', 'favorite_count', 'like_count'),
    retweetCount: readNumeric(t, 'retweetCount', 'retweet_count'),
    replyCount: readNumeric(t, 'replyCount', 'reply_count'),
    quoteCount: readNumeric(t, 'quoteCount', 'quote_count'),
    viewCount: readNumeric(t, 'viewCount', 'view_count', 'impressions') || null,
  };
}

export async function fetchAllUserTweets(opts: {
  username: string;
  maxPages?: number;
  maxAgeMonths?: number;
  onPage?: (pageIndex: number, items: HistoricalTweet[], cursor: string | null) => void;
}): Promise<HistoricalTweet[]> {
  const username = opts.username;
  const maxPages = Math.max(1, Math.min(200, opts.maxPages ?? 50));
  const maxAgeMonths = opts.maxAgeMonths ?? 18;
  const cutoffMs = Date.now() - maxAgeMonths * 30 * 24 * 60 * 60 * 1000;

  const out: HistoricalTweet[] = [];
  let cursor: string | null = null;
  let stoppedByAge = false;

  for (let page = 0; page < maxPages; page++) {
    const url: string =
      `${BASE}/twitter/user/last_tweets?userName=${encodeURIComponent(username)}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const res: Response = await fetch(url, {
      headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`twitterapi page ${page + 1}: ${res.status} ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const rawList: any[] = data.tweets || data.data?.tweets || [];
    const nextCursor: string | null =
      data.next_cursor || data.cursor || data.data?.next_cursor || null;

    if (rawList.length === 0) {
      opts.onPage?.(page, [], nextCursor);
      break;
    }

    const items = rawList.map(normalizeTweet);

    // If oldest item on this page is past the age cutoff, stop after this page
    let pageOldestMs = Infinity;
    for (const t of items) {
      const ts = Date.parse(t.createdAt);
      if (Number.isFinite(ts) && ts < pageOldestMs) pageOldestMs = ts;
    }
    out.push(...items);
    opts.onPage?.(page, items, nextCursor);

    if (Number.isFinite(pageOldestMs) && pageOldestMs < cutoffMs) {
      stoppedByAge = true;
      break;
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return out;
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
