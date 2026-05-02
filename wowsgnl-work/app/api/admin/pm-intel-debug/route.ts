import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/admin/pm-intel-debug
//
// Snapshot of pm_intel_items state plus what the next pm-analyze
// batch would pick up. Helps diagnose why promotions are 0.
export async function GET() {
  const items = await sql`
    SELECT id, category, headline, valence, priority, array_length(signal_event_ids, 1) AS member_count, for_date
    FROM pm_intel_items
    ORDER BY id DESC
    LIMIT 20
  `;

  // What's in the noise bucket (low-signal events the scorer rejected).
  const noiseRows = await sql`
    SELECT pi.id AS noise_row_id,
           array_length(pi.signal_event_ids, 1) AS noise_count,
           pi.signal_event_ids
    FROM pm_intel_items pi
    WHERE pi.headline LIKE '(noise)%'
    ORDER BY pi.id DESC
    LIMIT 5
  `;
  // Sample a few noise events.
  const noiseSampleIds = (noiseRows.rows[0]?.signal_event_ids || []).slice(0, 8);
  const noiseSample = noiseSampleIds.length > 0 ? (await sql`
    SELECT id, source, author, content
    FROM events
    WHERE id = ANY(${noiseSampleIds})
  `).rows : [];

  // What the next batch of 40 would look like (ordering only — don't actually score).
  const nextBatch = await sql`
    SELECT e.id, e.source, e.author, LEFT(e.content, 100) AS content_preview, e.created_at
    FROM events e
    WHERE e.client_id = 4
      AND NOT EXISTS (SELECT 1 FROM pm_intel_items pi WHERE e.id = ANY(pi.signal_event_ids))
    ORDER BY
      CASE e.source WHEN 'serpapi' THEN 1 WHEN 'fed_register' THEN 1 WHEN 'fec' THEN 1 WHEN 'congress' THEN 1 ELSE 2 END,
      e.created_at DESC, e.id DESC
    LIMIT 10
  `;

  // Source breakdown of unprocessed.
  const unprocessedBySource = await sql`
    SELECT source, COUNT(*)::int AS n
    FROM events e
    WHERE client_id = 4
      AND NOT EXISTS (SELECT 1 FROM pm_intel_items pi WHERE e.id = ANY(pi.signal_event_ids))
    GROUP BY source
    ORDER BY n DESC
  `;

  return NextResponse.json({
    ok: true,
    items: items.rows,
    noise_buckets: noiseRows.rows,
    noise_sample: noiseSample.map((r: any) => ({
      id: r.id,
      source: r.source,
      author: r.author,
      preview: (r.content || '').slice(0, 200),
    })),
    next_batch_preview: nextBatch.rows,
    unprocessed_by_source: unprocessedBySource.rows,
  });
}
