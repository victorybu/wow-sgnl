import { sql } from '@vercel/postgres';
import { fetchUserTweets, searchTweets } from '@/lib/twitterapi';
import { scoreRelevance } from '@/lib/relevance';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const watchlist = await sql`
    SELECT w.*, c.id as client_id, c.name as client_name, c.priority_topics
    FROM watchlist w JOIN clients c ON c.id = w.client_id
    WHERE w.active = TRUE
  `;

  let inserted = 0;
  let scored = 0;

  for (const w of watchlist.rows) {
    try {
      let tweets: any[] = [];
      if (w.kind === 'x_account') tweets = await fetchUserTweets(w.value, 120);
      else if (w.kind === 'x_keyword') tweets = await searchTweets(w.value, 120);
      else continue;

      for (const t of tweets) {
        const url = `https://x.com/${t.author?.userName || ''}/status/${t.id}`;
        const result = await sql`
          INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
          VALUES (${w.client_id}, 'x', ${t.id}, ${t.author?.userName || null}, ${t.text || ''}, ${url}, ${t.createdAt})
          ON CONFLICT (source, source_id) DO NOTHING
          RETURNING id
        `;
        if (result.rowCount && result.rowCount > 0) inserted++;
      }
    } catch (e: any) {
      console.error(`watchlist ${w.id} failed:`, e.message);
    }
  }

  const unscored = await sql`
    SELECT e.*, c.name as client_name, c.priority_topics
    FROM events e JOIN clients c ON c.id = e.client_id
    WHERE e.relevance_score IS NULL
    ORDER BY e.created_at DESC
    LIMIT 30
  `;
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
      console.error(`score ${e.id} failed:`, err.message);
    }
  }

  return NextResponse.json({ ok: true, inserted, scored });
}
