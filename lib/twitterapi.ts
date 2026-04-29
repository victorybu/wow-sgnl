const BASE = 'https://api.twitterapi.io';

export async function fetchUserTweets(username: string, sinceMinutes = 60) {
  const res = await fetch(
    `${BASE}/twitter/user/last_tweets?userName=${encodeURIComponent(username)}`,
    { headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! } }
  );
  if (!res.ok) throw new Error(`twitterapi ${res.status}`);
  const data = await res.json();
  const cutoff = Date.now() - sinceMinutes * 60_000;
  return (data.tweets || []).filter((t: any) => new Date(t.createdAt).getTime() > cutoff);
}

export async function searchTweets(query: string, sinceMinutes = 60) {
  const res = await fetch(
    `${BASE}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest`,
    { headers: { 'X-API-Key': process.env.TWITTERAPI_KEY! } }
  );
  if (!res.ok) throw new Error(`twitterapi ${res.status}`);
  const data = await res.json();
  const cutoff = Date.now() - sinceMinutes * 60_000;
  return (data.tweets || []).filter((t: any) => new Date(t.createdAt).getTime() > cutoff);
}
