import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Filter = 'all' | 'unscored' | 'top' | 'drafted' | 'shipped' | 'my_ratings';

const SELECT_COLS = `
  e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
  e.status, e.posted_at, e.created_at,
  e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
  c.name AS client_name,
  EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
  EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filter = (searchParams.get('filter') || 'all') as Filter;

  let events: any[] = [];

  if (filter === 'shipped') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE)
      ORDER BY e.relevance_score DESC NULLS LAST, e.posted_at DESC NULLS LAST, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'drafted') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.status = 'drafted'
      ORDER BY e.relevance_score DESC NULLS LAST, e.posted_at DESC NULLS LAST, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'top') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_score >= 7
      ORDER BY e.relevance_score DESC, e.posted_at DESC NULLS LAST, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'unscored') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_score IS NULL
      ORDER BY e.posted_at DESC NULLS LAST, e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'my_ratings') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.feedback IS NOT NULL
      ORDER BY e.feedback_at DESC NULLS LAST, e.id DESC
      LIMIT 200
    `;
    events = r.rows;
  } else {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      ORDER BY e.relevance_score DESC NULLS LAST, e.posted_at DESC NULLS LAST, e.created_at DESC
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
      (SELECT COUNT(*)::int FROM events WHERE relevance_score IS NULL) AS events_unscored,
      (SELECT COUNT(*)::int FROM ratings_history WHERE rated_at >= (SELECT ts FROM today_start) AND rating IN ('signal','noise')) AS rated_today,
      (SELECT COUNT(*)::int FROM ratings_history WHERE rated_at >= (SELECT ts FROM today_start) AND rating = 'signal') AS rated_today_signal,
      (SELECT COUNT(*)::int FROM ratings_history WHERE rated_at >= (SELECT ts FROM today_start) AND rating = 'noise') AS rated_today_noise
  `;

  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM events) AS all,
      (SELECT COUNT(*)::int FROM events WHERE relevance_score IS NULL) AS unscored,
      (SELECT COUNT(*)::int FROM events WHERE relevance_score >= 7) AS top,
      (SELECT COUNT(*)::int FROM events WHERE status = 'drafted') AS drafted,
      (SELECT COUNT(*)::int FROM events e WHERE EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE)) AS shipped,
      (SELECT COUNT(*)::int FROM events WHERE feedback IS NOT NULL) AS my_ratings
  `;

  return NextResponse.json({
    ts: new Date().toISOString(),
    filter,
    events,
    stats: stats.rows[0],
    counts: counts.rows[0],
  });
}
