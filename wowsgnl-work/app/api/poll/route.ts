import { sql } from '@/lib/db';
import { fetchUserTweets, searchTweets } from '@/lib/twitterapi';
import { scoreRelevance } from '@/lib/relevance';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TWITTERAPI_DELAY_MS = 5500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function GET() {
  const errors: string[] = [];
  const debug: any = { watchlist_count: 0, fetched_per_watcher: [], unscored_count: 0 };

  const watchlist = await sql`
    SELECT w.*, c.id as client_id, c.name as client_name, c.priority_topics
    FROM watchlist w JOIN clients c ON c.id = w.client_id
    WHERE w.active = TRUE
  `;
  debug.watchlist_count = watchlist.rows.length;

  let inserted = 0;
  let scored = 0;

  let firstFetch = true;
  for (const w of watchlist.rows) {
    try {
      if (!firstFetch) await sleep(TWITTERAPI_DELAY_MS);
      firstFetch = false;
      let tweets: any[] = [];
      if (w.kind === 'x_account') tweets = await fetchUserTweets(w.value);
      else if (w.kind === 'x_keyword') tweets = await searchTweets(w.value);
      else continue;

      debug.fetched_per_watcher.push({ value: w.value, kind: w.kind, count: tweets.length });

      for (const t of tweets) {
        const url = `https://x.com/${t.author?.userName || ''}/status/${t.id}`;
        const result = await sql`
          INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
          VALUES (${w.client_id}, 'x', ${t.id}, ${t.author?.userName || null}, ${t.text || ''}, ${url}, ${t.createdAt})
          ON CONFLICT (source, source_id) DO NOTHING
          RETURNING id
        `;
        if (result.rows.length > 0) inserted++;
      }
    } catch (e: any) {
      errors.push(`${w.value} (${w.kind}): ${e.message}`);
    }
  }

  const unscored = await sql`
    SELECT e.*, c.name as client_name, c.priority_topics
    FROM events e JOIN clients c ON c.id = e.client_id
    WHERE e.relevance_score IS NULL
    ORDER BY e.created_at DESC
    LIMIT 30
  `;
  debug.unscored_count = unscored.rows.length;

  for (const e of unscored.rows) {
    try {
      const r = await scoreRelevance({
        content: e.content,
        source: e.source,
        clientName: e.client_name,
        priorityTopics: e.priority_topics || '',
      });
      await sql`UPDATE events SET relevance_score = ${r.score}, relevance_reason = ${r.reason} WHERE id = ${e.id}`;
      if (r.score < 5) await sql`UPDATE events SET status = 'ignored' WHERE id = ${e.id}`;
      scored++;
    } catch (err: any) {
      errors.push(`score event ${e.id}: ${err.message}`);
    }
  }

  return NextResponse.json({ ok: true, inserted, scored, debug, errors });
}
