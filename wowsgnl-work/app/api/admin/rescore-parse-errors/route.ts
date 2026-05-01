import { sql } from '@/lib/db';
import { scoreRelevance } from '@/lib/relevance';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

// POST /api/admin/rescore-parse-errors?client_id=1&limit=30
//
// One-shot backfill: re-runs scoreRelevance on events that landed with
// relevance_reason='parse_error' (the silent score=0 from the old
// fragile JSON parser). Chunked by ?limit so a 127-event backlog drains
// across a couple of calls without hitting the 300s lambda timeout.
//
// Idempotent — events that succeed on rescore get a real score + reason
// and stop matching the parse_error filter on subsequent runs.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = parseInt(searchParams.get('client_id') || '0');
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '30')));

  let rows;
  if (clientId > 0) {
    const r = await sql`
      SELECT e.id, e.content, e.author, e.source, e.posted_at, e.created_at,
             c.name AS client_name, c.priority_topics, c.mode
      FROM events e JOIN clients c ON c.id = e.client_id
      WHERE e.client_id = ${clientId} AND e.relevance_reason = 'parse_error'
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;
    rows = r.rows;
  } else {
    const r = await sql`
      SELECT e.id, e.content, e.author, e.source, e.posted_at, e.created_at,
             c.name AS client_name, c.priority_topics, c.mode
      FROM events e JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_reason = 'parse_error'
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;
    rows = r.rows;
  }

  let rescored = 0;
  let stillFailed = 0;
  const sample: any[] = [];
  for (const ev of rows) {
    const refTs = ev.posted_at || ev.created_at;
    const hoursOld = refTs ? (Date.now() - Date.parse(refTs)) / 3_600_000 : null;
    try {
      const { score, reason, sentiment, topic_tags } = await scoreRelevance({
        content: ev.content,
        source: ev.source || 'twitter',
        clientName: ev.client_name,
        priorityTopics: ev.priority_topics || '',
        author: ev.author,
        hoursOld,
        mode: ev.mode === 'intelligence' ? 'intelligence' : 'drafting',
      });
      await sql`
        UPDATE events
        SET relevance_score = ${score},
            relevance_reason = ${reason},
            sentiment = ${sentiment},
            topic_tags = ${topic_tags}
        WHERE id = ${ev.id}
      `;
      if (reason === 'parse_error') {
        stillFailed++;
      } else {
        rescored++;
        if (sample.length < 5) sample.push({ id: ev.id, score, reason: reason.slice(0, 80) });
      }
    } catch (err: any) {
      stillFailed++;
    }
  }

  // Count what's left so the caller knows whether to fire again.
  let remaining = 0;
  if (clientId > 0) {
    const c = await sql`SELECT COUNT(*)::int AS n FROM events WHERE client_id = ${clientId} AND relevance_reason = 'parse_error'`;
    remaining = c.rows[0].n;
  } else {
    const c = await sql`SELECT COUNT(*)::int AS n FROM events WHERE relevance_reason = 'parse_error'`;
    remaining = c.rows[0].n;
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    rescored,
    still_failed: stillFailed,
    remaining,
    sample,
  });
}

export async function GET(req: Request) {
  // Same as POST — convenience for testing via browser/curl GET.
  return POST(req);
}
