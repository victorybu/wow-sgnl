import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/admin/add-keyword-watchers?client_id=4
// body: { keywords: ["polymarket", "kalshi", "prediction market"] }
//
// Adds x_keyword watchers so the search-tweets endpoint catches
// mentions of these terms across the open feed (not just from
// accounts on the watchlist). Idempotent — duplicate keywords for
// the same client are skipped.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = parseInt(searchParams.get('client_id') || '0');
  if (clientId <= 0) return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const keywords: string[] = Array.isArray(body.keywords) ? body.keywords : [];
  if (keywords.length === 0) return NextResponse.json({ ok: false, error: 'keywords array required' }, { status: 400 });

  const existing = await sql`SELECT value FROM watchlist WHERE client_id = ${clientId} AND kind = 'x_keyword'`;
  const existingSet = new Set<string>(existing.rows.map((r: any) => String(r.value)));

  let inserted = 0;
  let skipped = 0;
  for (const k of keywords) {
    const v = String(k).trim();
    if (!v) { skipped++; continue; }
    if (existingSet.has(v)) { skipped++; continue; }
    await sql`
      INSERT INTO watchlist (client_id, kind, value, active)
      VALUES (${clientId}, 'x_keyword', ${v}, TRUE)
    `;
    existingSet.add(v);
    inserted++;
  }
  return NextResponse.json({ ok: true, inserted, skipped });
}
