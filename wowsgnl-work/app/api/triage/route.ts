import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Math.max(5, Number(searchParams.get('limit')) || 30));
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ ok: false, error: 'no clients' }, { status: 404 });
  const cid = client.id;

  const r = await sql`
    SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
           e.posted_at, e.created_at,
           c.name AS client_name,
           EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts
    FROM events e
    JOIN clients c ON c.id = e.client_id
    WHERE e.client_id = ${cid} AND e.feedback IS NULL
    ORDER BY e.relevance_score DESC NULLS LAST,
             COALESCE(e.posted_at, e.created_at) DESC
    LIMIT ${limit}
  `;

  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND feedback IS NULL) AS unrated,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND feedback = 'signal') AS signal,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND feedback = 'noise') AS noise,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid}) AS total
  `;

  return NextResponse.json({
    ts: new Date().toISOString(),
    current_client: { id: client.id, name: client.name, mode: client.mode },
    queue: r.rows,
    counts: counts.rows[0],
  });
}
