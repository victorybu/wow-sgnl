import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 120;

type Item = {
  handle: string;          // X handle, no @, lowercased
  audience_role?: string;  // staffer | journalist | official | creator | politician | null
  party?: string;          // D | R | I | null
  notes?: string;          // optional context (name, principal, tags)
};

// POST /api/admin/import-tagged-staffers
// body: { client_id: 4, items: [{handle, audience_role, party, notes}, ...] }
//
// Per-row insert with each handle's own role + party (vs the
// /watchlist bulk-add form which applies one role+party to the whole
// batch). Idempotent: handles already in the watchlist get their
// audience_role/party overwritten with the values from this payload.
export async function POST(req: Request) {
  let body: { client_id?: number; items?: Item[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const clientId = Number(body.client_id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: 'items[] required' }, { status: 400 });
  }

  // Pre-load existing handles for this client+kind so we can split into
  // insert vs update without N round trips.
  const existing = await sql`
    SELECT value FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account'
  `;
  const existingSet = new Set<string>(
    existing.rows.map((r: any) => String(r.value).toLowerCase()),
  );

  let inserted = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const it of items) {
    const handle = String(it.handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (!handle) {
      skipped.push('(empty handle)');
      continue;
    }
    const role = it.audience_role && it.audience_role.length > 0 ? it.audience_role : null;
    const party = it.party && it.party.length > 0 ? it.party : null;

    if (existingSet.has(handle)) {
      await sql`
        UPDATE watchlist SET audience_role = ${role}, party = ${party}
        WHERE client_id = ${clientId} AND kind = 'x_account' AND value = ${handle}
      `;
      updated++;
    } else {
      await sql`
        INSERT INTO watchlist (client_id, kind, value, audience_role, party, active)
        VALUES (${clientId}, 'x_account', ${handle}, ${role}, ${party}, TRUE)
      `;
      existingSet.add(handle);
      inserted++;
    }
  }

  // Summary counts so the client can sanity-check.
  const stats = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account') AS total_accounts,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account' AND audience_role = 'staffer') AS staffers,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account' AND audience_role = 'journalist') AS journalists,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account' AND audience_role = 'official') AS officials,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account' AND party = 'D') AS d_side,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account' AND party = 'R') AS r_side,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_account' AND party = 'I') AS i_side
  `;

  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    skipped: skipped.length,
    skipped_sample: skipped.slice(0, 10),
    stats: stats.rows[0],
  });
}
