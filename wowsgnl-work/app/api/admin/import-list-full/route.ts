import { sql } from '@/lib/db';
import { fetchListMembers } from '@/lib/twitterapi';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

// POST /api/admin/import-list-full?list_id=...&client_id=N&audience_role=staffer&party=
//
// Variant of the /watchlist importFromList server action that's
// callable via curl. Pulls every page of an X List (up to 30 pages
// = ~600 members) and inserts new ones into the watchlist for the
// given client. Existing handles are skipped — they keep whatever
// audience_role + party they already have, so this is safe to run
// after a hand-tagged batch was already loaded.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const listId = searchParams.get('list_id') || '';
  const clientId = parseInt(searchParams.get('client_id') || '0');
  const audienceRole = (searchParams.get('audience_role') || '').trim() || null;
  const party = (searchParams.get('party') || '').trim() || null;

  if (!listId.match(/^\d+$/)) {
    return NextResponse.json({ ok: false, error: 'list_id required (numeric)' }, { status: 400 });
  }
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });
  }

  let result;
  try {
    result = await fetchListMembers({ listId, maxPages: 30 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message?.slice(0, 300) || 'fetch failed' }, { status: 502 });
  }

  const handles = result.members.map(m => m.userName).filter(Boolean);
  if (handles.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, inserted: 0 });
  }

  // Existing rows for dedupe.
  const existing = await sql`
    SELECT value FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account'
  `;
  const existingSet = new Set<string>(
    existing.rows.map((r: any) => String(r.value).toLowerCase()),
  );

  let inserted = 0;
  let skipped = 0;
  for (const h of handles) {
    if (existingSet.has(h)) { skipped++; continue; }
    await sql`
      INSERT INTO watchlist (client_id, kind, value, audience_role, party, active)
      VALUES (${clientId}, 'x_account', ${h}, ${audienceRole}, ${party}, TRUE)
    `;
    existingSet.add(h);
    inserted++;
  }

  return NextResponse.json({
    ok: true,
    list_id: listId,
    fetched: handles.length,
    pages: result.pages,
    capped_at: result.cappedAt,
    inserted,
    skipped,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
