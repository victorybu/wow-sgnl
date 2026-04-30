import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  // Polymorphic across event/draft/post. Use kind+target_id (with event_id fallback for legacy rows).
  const r = await sql`
    SELECT
      h.id, h.kind, h.target_id, h.event_id, h.rating, h.reason, h.note, h.rated_at,
      -- event context (when kind='event' or via draft/post lookup)
      ev.id AS ev_id, ev.author AS ev_author, ev.content AS ev_content,
      -- draft context
      d.id AS d_id, d.angle AS d_angle, d.event_id AS d_event_id,
      de.author AS d_author, de.content AS d_event_content,
      -- post context
      p.id AS p_id, p.content AS p_content, p.draft_id AS p_draft_id,
      pd.angle AS p_angle, pd.event_id AS p_event_id,
      pe.author AS p_author
    FROM ratings_history h
    LEFT JOIN events ev ON ev.id = COALESCE(h.event_id, CASE WHEN h.kind = 'event' THEN h.target_id END)
    LEFT JOIN drafts d ON h.kind = 'draft' AND d.id = h.target_id
    LEFT JOIN events de ON de.id = d.event_id
    LEFT JOIN posts p ON h.kind = 'post' AND p.id = h.target_id
    LEFT JOIN drafts pd ON pd.id = p.draft_id
    LEFT JOIN events pe ON pe.id = pd.event_id
    ORDER BY h.rated_at DESC
    LIMIT 1000
  `;
  return NextResponse.json({ ts: new Date().toISOString(), rows: r.rows });
}
