import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  // One row per draft (angle), with parent event info + post counts/ratings
  const r = await sql`
    SELECT
      d.id, d.event_id, d.angle, d.feedback, d.feedback_reason, d.feedback_note,
      d.shipped, d.shipped_at, d.created_at,
      e.author, e.content AS event_content, e.url AS event_url,
      e.relevance_score, e.posted_at,
      (SELECT COUNT(*)::int FROM posts p WHERE p.draft_id = d.id) AS post_count,
      (SELECT COUNT(*)::int FROM posts p WHERE p.draft_id = d.id AND p.shipped = TRUE) AS shipped_post_count,
      (SELECT COUNT(*)::int FROM posts p WHERE p.draft_id = d.id AND p.feedback = 'signal') AS post_signal_count,
      (SELECT COUNT(*)::int FROM posts p WHERE p.draft_id = d.id AND p.feedback = 'noise') AS post_noise_count
    FROM drafts d
    JOIN events e ON e.id = d.event_id
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 500
  `;
  return NextResponse.json({ ts: new Date().toISOString(), drafts: r.rows });
}
