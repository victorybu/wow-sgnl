const BASE = 'https://api.twitterapi.io';

function parseTweetDate(s: string): number {
  // twitterapi.io returns Twitter-style dates like "Wed Apr 29 21:50:00 +0000 2026"
  // or sometimes ISO. Try both.
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  return 0;
}

export async function fetchUserTweets(username: string, sinceMinutes = 1440) {
  const res = await fetch(
    `${BASE}/twitter/user/last_tweets?userName=${encodeURIComponent(username)}`,
    { headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`twitterapi ${res.status}: ${body}`);
  }
  const data = await res.json();
  // Response shape: { tweets: [...] } or { data: { tweets: [...] } }
  const tweets = data.tweets || data.data?.tweets || [];
  const cutoff = Date.now() - sinceMinutes * 60_000;
  return tweets.filter((t: any) => {
    const ts = parseTweetDate(t.createdAt);
    return ts === 0 || ts > cutoff; // keep if unparseable, just in case
  });
}

export async function searchTweets(query: string, sinceMinutes = 1440) {
  const res = await fetch(
    `${BASE}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest`,
    { headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`twitterapi ${res.status}: ${body}`);
  }
  const data = await res.json();
  const tweets = data.tweets || data.data?.tweets || [];
  const cutoff = Date.now() - sinceMinutes * 60_000;
  return tweets.filter((t: any) => {
    const ts = parseTweetDate(t.createdAt);
    return ts === 0 || ts > cutoff;
  });
}
