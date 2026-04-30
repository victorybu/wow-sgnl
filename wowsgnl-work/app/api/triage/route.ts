import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Returns the next batch of UNRATED events (feedback IS NULL),
// sorted highest-priority first, capped to a small batch the UI
// holds in memory. UI re-fetches when the queue runs low.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Math.max(5, Number(searchParams.get('limit')) || 30));

  const r = await sql`
    SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
           e.posted_at, e.created_at,
           c.name AS client_name,
           EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts
    FROM events e
    JOIN clients c ON c.id = e.client_id
    WHERE e.feedback IS NULL
    ORDER BY e.relevance_score DESC NULLS LAST,
             COALESCE(e.posted_at, e.created_at) DESC
    LIMIT ${limit}
  `;

  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM events WHERE feedback IS NULL) AS unrated,
      (SELECT COUNT(*)::int FROM events WHERE feedback = 'signal') AS signal,
      (SELECT COUNT(*)::int FROM events WHERE feedback = 'noise') AS noise,
      (SELECT COUNT(*)::int FROM events) AS total
  `;

  return NextResponse.json({
    ts: new Date().toISOString(),
    queue: r.rows,
    counts: counts.rows[0],
  });
}
