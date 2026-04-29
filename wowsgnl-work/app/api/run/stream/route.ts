import { sql } from '@/lib/db';
import { fetchUserTweets, searchTweets } from '@/lib/twitterapi';
import { scoreRelevance } from '@/lib/relevance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send('log', { msg: 'Starting run' });

        const watchlist = await sql`
          SELECT w.*, c.id as client_id, c.name as client_name, c.priority_topics, c.voice_profile
          FROM watchlist w JOIN clients c ON c.id = w.client_id
          WHERE w.active = TRUE
        `;
        send('watchlist', { count: watchlist.rowCount });

        let inserted = 0;
        for (const w of watchlist.rows) {
          send('fetch_start', { value: w.value, kind: w.kind, client: w.client_name });
          let tweets: any[] = [];
          try {
            if (w.kind === 'x_account') tweets = await fetchUserTweets(w.value);
            else if (w.kind === 'x_keyword') tweets = await searchTweets(w.value);
          } catch (e: any) {
            send('fetch_error', { value: w.value, error: e.message });
            continue;
          }
          send('fetch_done', { value: w.value, count: tweets.length });

          for (const t of tweets) {
            const url = `https://x.com/${t.author?.userName || ''}/status/${t.id}`;
            const result = await sql`
              INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
              VALUES (${w.client_id}, 'x', ${t.id}, ${t.author?.userName || null}, ${t.text || ''}, ${url}, ${t.createdAt})
              ON CONFLICT (source, source_id) DO NOTHING
              RETURNING id
            `;
            if (result.rowCount && result.rowCount > 0) {
              inserted++;
              send('tweet', {
                event_id: result.rows[0].id,
                author: t.author?.userName,
                content: (t.text || '').slice(0, 200),
                url,
              });
            }
          }
        }

        const unscored = await sql`
          SELECT e.*, c.name as client_name, c.priority_topics
          FROM events e JOIN clients c ON c.id = e.client_id
          WHERE e.relevance_score IS NULL
          ORDER BY e.created_at DESC
          LIMIT 30
        `;
        send('unscored', { count: unscored.rowCount });

        let scored = 0;
        for (const e of unscored.rows) {
          send('score_start', {
            event_id: e.id,
            author: e.author,
            content: (e.content || '').slice(0, 200),
          });
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
            send('score_done', {
              event_id: e.id,
              score: r.score,
              reason: r.reason,
            });
          } catch (err: any) {
            send('score_error', { event_id: e.id, error: err.message });
          }
        }

        send('done', { inserted, scored });
      } catch (e: any) {
        send('error', { message: e.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
