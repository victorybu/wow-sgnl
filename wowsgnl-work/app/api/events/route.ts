import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Filter = 'all_scored' | 'top' | 'drafted' | 'shipped';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filter = (searchParams.get('filter') || 'all_scored') as Filter;

  let events: any[] = [];

  if (filter === 'shipped') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE)
      ORDER BY e.relevance_score DESC NULLS LAST, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'drafted') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.status = 'drafted'
      ORDER BY e.relevance_score DESC NULLS LAST, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'top') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_score >= 7
      ORDER BY e.relevance_score DESC, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_score >= 5
      ORDER BY e.relevance_score DESC, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  }

  const stats = await sql`
    WITH today_start AS (
      SELECT (date_trunc('day', now() AT TIME ZONE 'America/New_York')) AT TIME ZONE 'America/New_York' AS ts
    )
    SELECT
      (SELECT COUNT(*)::int FROM events WHERE created_at >= (SELECT ts FROM today_start)) AS events_today,
      (SELECT COUNT(*)::int FROM events WHERE created_at >= (SELECT ts FROM today_start) AND relevance_score IS NOT NULL) AS scored_today,
      (SELECT COUNT(*)::int FROM events WHERE status = 'drafted') AS drafts_in_progress,
      (SELECT COUNT(*)::int FROM drafts WHERE shipped = TRUE AND shipped_at >= (SELECT ts FROM today_start)) AS shipped_today,
      (SELECT COUNT(*)::int FROM events) AS events_total,
      (SELECT COUNT(*)::int FROM events WHERE relevance_score IS NULL) AS events_unscored
  `;

  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM events WHERE relevance_score >= 5) AS all_scored,
      (SELECT COUNT(*)::int FROM events WHERE relevance_score >= 7) AS top,
      (SELECT COUNT(*)::int FROM events WHERE status = 'drafted') AS drafted,
      (SELECT COUNT(*)::int FROM events e WHERE EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE)) AS shipped
  `;

  return NextResponse.json({
    ts: new Date().toISOString(),
    filter,
    events,
    stats: stats.rows[0],
    counts: counts.rows[0],
  });
}
