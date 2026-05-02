import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/admin/pm-noise-purge
//
// Deletes pm_intel_items rows whose headline starts with "(noise)" —
// these were created by pm-analyze when the score prompt JSON
// truncated mid-output and the backfill marked every signal as
// not-promotable. Removing them re-opens the signal_event_ids in
// those rows for re-processing on the next pm-analyze run (since
// pm-analyze's NOT EXISTS query no longer matches them).
export async function POST() {
  const r = await sql`
    DELETE FROM pm_intel_items
    WHERE headline LIKE '(noise)%'
    RETURNING id, array_length(signal_event_ids, 1) AS n
  `;
  const deleted = r.rows;
  const totalEventsRecovered = deleted.reduce((s: number, row: any) => s + (row.n || 0), 0);
  return NextResponse.json({
    ok: true,
    rows_deleted: deleted.length,
    events_recovered: totalEventsRecovered,
  });
}
export async function GET() { return POST(); }
