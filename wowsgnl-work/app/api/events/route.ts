import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
import { getClustersForTopPicks, ClusterCandidate } from '@/lib/clusters';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Filter = 'all' | 'unscored' | 'top' | 'drafted' | 'shipped' | 'my_ratings' | 'muted';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filter = (searchParams.get('filter') || 'all') as Filter;

  const client = await getCurrentClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'no clients configured' }, { status: 404 });
  }
  const cid = client.id;

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
      WHERE e.client_id = ${cid}
        AND EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE)
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
      WHERE e.client_id = ${cid}
        AND e.status = 'drafted'
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
      WHERE e.client_id = ${cid}
        AND e.relevance_score >= 7
        AND (e.feedback IS DISTINCT FROM 'noise')
      ORDER BY (e.feedback = 'signal') DESC NULLS LAST,
               e.relevance_score DESC, e.posted_at DESC NULLS LAST, e.created_at DESC
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
      WHERE e.client_id = ${cid}
        AND e.relevance_score IS NULL
        AND (e.feedback IS DISTINCT FROM 'noise')
      ORDER BY (e.feedback = 'signal') DESC NULLS LAST,
               e.posted_at DESC NULLS LAST, e.created_at DESC
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
      WHERE e.client_id = ${cid}
        AND e.feedback IS NOT NULL
      ORDER BY e.feedback_at DESC NULLS LAST, e.id DESC
      LIMIT 200
    `;
    events = r.rows;
  } else if (filter === 'muted') {
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.client_id = ${cid}
        AND e.feedback = 'noise'
      ORDER BY e.feedback_at DESC NULLS LAST, e.id DESC
      LIMIT 200
    `;
    events = r.rows;
  } else {
    // 'all' default — exclude noise; signal floats to top
    const r = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             e.status, e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.client_id = ${cid}
        AND (e.feedback IS DISTINCT FROM 'noise')
      ORDER BY (e.feedback = 'signal') DESC NULLS LAST,
               e.relevance_score DESC NULLS LAST,
               e.posted_at DESC NULLS LAST,
               e.created_at DESC
      LIMIT 200
    `;
    events = r.rows;
  }

  const stats = await sql`
    WITH today_start AS (
      SELECT (date_trunc('day', now() AT TIME ZONE 'America/New_York')) AT TIME ZONE 'America/New_York' AS ts
    )
    SELECT
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND created_at >= (SELECT ts FROM today_start)) AS events_today,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND created_at >= (SELECT ts FROM today_start) AND relevance_score IS NOT NULL) AS scored_today,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND status = 'drafted') AS drafts_in_progress,
      (SELECT COUNT(*)::int FROM drafts d JOIN events e ON e.id = d.event_id
        WHERE e.client_id = ${cid} AND d.shipped = TRUE AND d.shipped_at >= (SELECT ts FROM today_start)) AS shipped_today,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid}) AS events_total,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND relevance_score IS NULL) AS events_unscored,
      (SELECT COUNT(*)::int FROM ratings_history h
        WHERE h.rated_at >= (SELECT ts FROM today_start)
          AND h.rating IN ('signal','noise')
          AND ((h.kind = 'event' AND h.target_id IN (SELECT id FROM events WHERE client_id = ${cid}))
            OR (h.kind = 'draft' AND h.target_id IN (SELECT d.id FROM drafts d JOIN events e ON e.id = d.event_id WHERE e.client_id = ${cid}))
            OR (h.kind = 'post' AND h.target_id IN (SELECT p.id FROM posts p JOIN drafts d ON d.id = p.draft_id JOIN events e ON e.id = d.event_id WHERE e.client_id = ${cid})))
      ) AS rated_today,
      (SELECT COUNT(*)::int FROM ratings_history h
        WHERE h.rated_at >= (SELECT ts FROM today_start)
          AND h.rating = 'signal'
          AND ((h.kind = 'event' AND h.target_id IN (SELECT id FROM events WHERE client_id = ${cid}))
            OR (h.kind = 'draft' AND h.target_id IN (SELECT d.id FROM drafts d JOIN events e ON e.id = d.event_id WHERE e.client_id = ${cid}))
            OR (h.kind = 'post' AND h.target_id IN (SELECT p.id FROM posts p JOIN drafts d ON d.id = p.draft_id JOIN events e ON e.id = d.event_id WHERE e.client_id = ${cid})))
      ) AS rated_today_signal,
      (SELECT COUNT(*)::int FROM ratings_history h
        WHERE h.rated_at >= (SELECT ts FROM today_start)
          AND h.rating = 'noise'
          AND ((h.kind = 'event' AND h.target_id IN (SELECT id FROM events WHERE client_id = ${cid}))
            OR (h.kind = 'draft' AND h.target_id IN (SELECT d.id FROM drafts d JOIN events e ON e.id = d.event_id WHERE e.client_id = ${cid}))
            OR (h.kind = 'post' AND h.target_id IN (SELECT p.id FROM posts p JOIN drafts d ON d.id = p.draft_id JOIN events e ON e.id = d.event_id WHERE e.client_id = ${cid})))
      ) AS rated_today_noise
  `;

  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND feedback IS DISTINCT FROM 'noise') AS all,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND relevance_score IS NULL AND feedback IS DISTINCT FROM 'noise') AS unscored,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND relevance_score >= 7 AND feedback IS DISTINCT FROM 'noise') AS top,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND status = 'drafted') AS drafted,
      (SELECT COUNT(*)::int FROM events e WHERE e.client_id = ${cid} AND EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE)) AS shipped,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND feedback IS NOT NULL) AS my_ratings,
      (SELECT COUNT(*)::int FROM events WHERE client_id = ${cid} AND feedback = 'noise') AS muted
  `;

  // Top picks only for drafting-mode clients (intelligence mode has /briefing instead).
  // Pull up to 30 qualifying candidates, cluster them, then return top 5 clusters.
  let topPicks: any[] = [];
  if (client.mode === 'drafting') {
    const tp = await sql`
      SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
             COALESCE(e.cluster_boost, 0) AS cluster_boost,
             e.posted_at, e.created_at,
             e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
             c.name AS client_name,
             EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped,
             COALESCE(
               (SELECT json_agg(json_build_object(
                  'id', d.id, 'angle', d.angle,
                  'feedback', d.feedback, 'feedback_reason', d.feedback_reason,
                  'post_count', (SELECT COUNT(*)::int FROM posts p WHERE p.draft_id = d.id),
                  'shipped_count', (SELECT COUNT(*)::int FROM posts p WHERE p.draft_id = d.id AND p.shipped = TRUE)
                ) ORDER BY d.id ASC)
                FROM drafts d WHERE d.event_id = e.id),
               '[]'::json
             ) AS drafts
      FROM events e
      JOIN clients c ON c.id = e.client_id
      WHERE e.client_id = ${cid}
        AND e.relevance_score >= 7
        AND (e.feedback IS DISTINCT FROM 'noise')
        AND COALESCE(e.posted_at, e.created_at) >= NOW() - INTERVAL '6 hours'
      ORDER BY e.relevance_score DESC, COALESCE(e.posted_at, e.created_at) DESC
      LIMIT 30
    `;
    const rows: any[] = tp.rows;

    if (rows.length > 0) {
      const candidates: ClusterCandidate[] = rows.map(r => ({
        id: r.id,
        author: r.author,
        content: r.content,
        relevance_score: r.relevance_score,
      }));
      const clusters = await getClustersForTopPicks(cid, candidates);
      const byId = new Map<number, any>();
      for (const r of rows) byId.set(r.id, r);

      const picks = clusters
        .map(c => {
          const primary = byId.get(c.primary_event_id);
          if (!primary) return null;
          const related = c.related_event_ids
            .map(rid => byId.get(rid))
            .filter(Boolean)
            .map(r => ({
              id: r.id,
              author: r.author,
              content: r.content,
              url: r.url,
              posted_at: r.posted_at,
              created_at: r.created_at,
            }));
          return {
            cluster_topic: c.cluster_topic,
            ...primary,
            related,
          };
        })
        .filter(Boolean) as any[];

      picks.sort((a, b) => {
        const sa = a.relevance_score ?? 0;
        const sb = b.relevance_score ?? 0;
        if (sb !== sa) return sb - sa;
        const ta = Date.parse(a.posted_at || a.created_at) || 0;
        const tb = Date.parse(b.posted_at || b.created_at) || 0;
        return tb - ta;
      });

      topPicks = picks.slice(0, 5);
    }
  }

  // Drop-everything alerts: events whose effective score (raw +
  // cluster_boost, capped at 10) hits ≥9 from the last 24h. The
  // cluster boost means a swarm of three 8s on the same beat fires the
  // banner just like a single 9 would. Rendered as a red hero above
  // the rest of the dashboard regardless of which filter is active.
  const dropEverything = await sql`
    SELECT e.id, e.author, e.content, e.url,
           e.relevance_score,
           COALESCE(e.cluster_boost, 0) AS cluster_boost,
           LEAST(COALESCE(e.relevance_score, 0) + COALESCE(e.cluster_boost, 0), 10) AS effective_score,
           e.relevance_reason,
           e.posted_at, e.created_at,
           c.name AS client_name,
           EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id) AS has_drafts,
           EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped
    FROM events e JOIN clients c ON c.id = e.client_id
    WHERE e.client_id = ${cid}
      AND LEAST(COALESCE(e.relevance_score, 0) + COALESCE(e.cluster_boost, 0), 10) >= 9
      AND (e.feedback IS DISTINCT FROM 'noise')
      AND COALESCE(e.posted_at, e.created_at) >= NOW() - INTERVAL '24 hours'
    ORDER BY effective_score DESC, COALESCE(e.posted_at, e.created_at) DESC
    LIMIT 5
  `;

  return NextResponse.json({
    ts: new Date().toISOString(),
    filter,
    current_client: { id: client.id, name: client.name, mode: client.mode },
    events,
    stats: stats.rows[0],
    counts: counts.rows[0],
    top_picks: topPicks,
    drop_everything: dropEverything.rows,
  });
}
