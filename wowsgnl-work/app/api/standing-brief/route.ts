import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
import { getClustersForTopPicks, ClusterCandidate } from '@/lib/clusters';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// GET /api/standing-brief?since=2026-05-01T10:00:00Z
//
// "While you were away" digest. Caller passes the localStorage
// lastSeenAt timestamp; we return everything that landed in the
// window plus a top-N tease list. Renders as a hero panel above the
// regular Top Picks on the homepage.
//
// Response: { ok, since, window_hours, totals, top_events[], clusters[] }
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const sinceMs = sinceParam ? Date.parse(sinceParam) : NaN;
  if (!Number.isFinite(sinceMs)) {
    return NextResponse.json({ ok: false, error: 'since (ISO) required' }, { status: 400 });
  }
  const sinceIso = new Date(sinceMs).toISOString();
  const windowHours = Math.max(0, (Date.now() - sinceMs) / 3_600_000);

  const client = await getCurrentClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'no client' }, { status: 404 });
  }
  const cid = client.id;

  const totals = await sql`
    SELECT
      COUNT(*)::int AS events,
      COUNT(*) FILTER (WHERE relevance_score >= 7)::int AS scored_7plus,
      COUNT(*) FILTER (WHERE relevance_score >= 9)::int AS scored_9plus,
      COUNT(*) FILTER (WHERE feedback = 'noise')::int AS noise_rated
    FROM events
    WHERE client_id = ${cid}
      AND created_at >= ${sinceIso}::timestamptz
  `;

  // Top events from the window — score DESC, then newest-first. Include
  // drafts so the operator can see if angles were already auto-generated.
  const topEvents = await sql`
    SELECT e.id, e.author, e.content, e.url, e.relevance_score, e.relevance_reason,
           e.posted_at, e.created_at, e.feedback,
           EXISTS(SELECT 1 FROM drafts d WHERE d.event_id = e.id AND d.shipped = TRUE) AS is_shipped,
           COALESCE(
             (SELECT COUNT(*)::int FROM drafts d WHERE d.event_id = e.id),
             0
           ) AS draft_count
    FROM events e
    WHERE e.client_id = ${cid}
      AND e.created_at >= ${sinceIso}::timestamptz
      AND (e.feedback IS DISTINCT FROM 'noise')
    ORDER BY e.relevance_score DESC NULLS LAST,
             COALESCE(e.posted_at, e.created_at) DESC
    LIMIT 10
  `;

  // Cluster summary: only meaningful when 3+ events scored ≥7 in the
  // window. Reuses the homepage's per-client cache via the same key.
  let clusters: any[] = [];
  const seven = topEvents.rows.filter((r: any) => (r.relevance_score ?? 0) >= 7);
  if (seven.length >= 3) {
    const candidates: ClusterCandidate[] = seven.map((r: any) => ({
      id: r.id,
      author: r.author,
      content: r.content,
      relevance_score: r.relevance_score,
    }));
    const built = await getClustersForTopPicks(cid, candidates);
    clusters = built
      .filter((c: any) => c.related_event_ids.length > 0)
      .map((c: any) => ({
        cluster_topic: c.cluster_topic,
        primary_event_id: c.primary_event_id,
        author_count: c.related_event_ids.length + 1,
      }));
  }

  return NextResponse.json({
    ok: true,
    since: sinceIso,
    window_hours: Number(windowHours.toFixed(2)),
    totals: totals.rows[0],
    top_events: topEvents.rows,
    clusters,
  });
}
