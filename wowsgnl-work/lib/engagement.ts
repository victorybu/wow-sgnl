import { sql } from './db';

const BASE = 'https://api.twitterapi.io';

export type EngagementMetrics = {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views?: number | null;
};

/**
 * Parse a tweet ID from a URL like https://x.com/RepRoKhanna/status/1234567890
 * or accept a bare numeric ID.
 */
export function parseTweetId(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^\d{6,25}$/.test(s)) return s;
  const m = s.match(/status(?:es)?\/(\d{6,25})/);
  return m ? m[1] : null;
}

function readNum(t: any, ...keys: string[]): number {
  for (const k of keys) {
    const v = t?.[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return 0;
}

/**
 * Fetch live engagement for a single tweet via twitterapi.io.
 * Returns null if the tweet isn't found or the call fails.
 */
export async function fetchTweetEngagement(tweetId: string): Promise<EngagementMetrics | null> {
  if (!process.env.TWITTERAPI_KEY) throw new Error('TWITTERAPI_KEY not set');
  // twitterapi.io's tweet-by-id endpoint
  const url = `${BASE}/twitter/tweets?tweet_ids=${encodeURIComponent(tweetId)}`;
  const res = await fetch(url, {
    headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! },
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  // Response shape: { tweets: [{...}] } or { data: [...] }
  const list: any[] = data.tweets || data.data || [];
  const t = list[0];
  if (!t) return null;
  return {
    likes: readNum(t, 'likeCount', 'favorite_count', 'like_count'),
    retweets: readNum(t, 'retweetCount', 'retweet_count'),
    replies: readNum(t, 'replyCount', 'reply_count'),
    quotes: readNum(t, 'quoteCount', 'quote_count'),
    views: readNum(t, 'viewCount', 'view_count', 'impressions') || null,
  };
}

/**
 * Compute median engagement velocity for a client's existing voice
 * examples. Used as the baseline to auto-adjust weights when fresh
 * shipped-post engagement comes in.
 */
export async function clientMedianVelocity(clientId: number): Promise<number | null> {
  const r = await sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY engagement_velocity)::numeric AS median
    FROM voice_examples
    WHERE client_id = ${clientId} AND engagement_velocity IS NOT NULL
  `;
  const m = r.rows[0]?.median;
  return m === null || m === undefined ? null : Number(m);
}

/**
 * Apply auto-weight policy from Item 4:
 *   24h velocity > 2x median  → weight 3 (gold)
 *   24h velocity < 0.25x median → weight 1 (canon, demoted from boost)
 * Never auto-set weight=0 (only the user can exclude).
 *
 * Returns the new weight + a human-readable reason string for display
 * on /voice. No-op (returns null) if there's no median yet or velocity
 * is in the normal band.
 */
export function autoWeightFromVelocity(
  velocity: number,
  median: number | null
): { weight: number; reason: string } | null {
  if (!median || median <= 0) return null;
  const ratio = velocity / median;
  if (ratio >= 2) {
    return {
      weight: 3,
      reason: `auto-boosted to gold: ${ratio.toFixed(1)}x median engagement`,
    };
  }
  if (ratio <= 0.25) {
    return {
      weight: 1,
      reason: `auto-demoted to canon: ${ratio.toFixed(2)}x median engagement`,
    };
  }
  return null;
}
