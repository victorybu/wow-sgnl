import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/admin/pm-todays-read
//
// Returns today's Today's Read meta row (the synthesized narrative)
// for inspection. Includes narrative, action_hints, and source_links
// so the operator can sanity-check the prose without having to look
// at the dashboard render.
export async function GET() {
  const r = await sql`
    SELECT id, headline, summary, analysis, source_links, signal_event_ids, valence, priority, for_date, created_at
    FROM pm_intel_items
    WHERE category = 'todays_read'
      AND headline LIKE 'Today''s Read · %'
      AND for_date = CURRENT_DATE
    ORDER BY id DESC
    LIMIT 1
  `;
  if (r.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'no Today\'s Read for today' }, { status: 404 });
  }
  const row = r.rows[0];
  return NextResponse.json({
    ok: true,
    id: row.id,
    headline: row.headline,
    narrative: row.summary,
    action_hints: row.analysis,
    source_links: row.source_links,
    member_count: (row.signal_event_ids || []).length,
    member_event_ids: row.signal_event_ids,
    for_date: row.for_date,
    created_at: row.created_at,
  });
}
