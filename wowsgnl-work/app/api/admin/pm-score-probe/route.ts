import { sql } from '@/lib/db';
import { scorePolymarketBatch } from '@/lib/polymarket/prompts/score';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 90;

// GET /api/admin/pm-score-probe?n=5
//
// Pulls N curated-source events (serpapi/fed_register/etc) and runs
// them through the scorer, returning per-item should_promote +
// rationale-ish info. Used to diagnose 0-promotion runs.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const n = Math.max(1, Math.min(10, parseInt(searchParams.get('n') || '5')));

  // Pull N curated-source events (skip Twitter to keep the test focused).
  const r = await sql`
    SELECT id, source, author, content, url, posted_at
    FROM events
    WHERE client_id = 4 AND source IN ('serpapi','fed_register','fec','congress')
    ORDER BY id DESC
    LIMIT ${n}
  `;
  type Sig = { id: number; source: string; author: string | null; content: string; url: string | null; posted_at: string | null };
  const signals: Sig[] = r.rows.map((row: any) => ({
    id: row.id,
    source: row.source || 'unknown',
    author: row.author,
    content: row.content || '',
    url: row.url,
    posted_at: row.posted_at,
  }));

  if (signals.length === 0) return NextResponse.json({ ok: false, error: 'no curated events' });

  const scored = await scorePolymarketBatch(signals);
  return NextResponse.json({
    ok: true,
    count: scored.length,
    signals_input: signals.map(s => ({ id: s.id, source: s.source, preview: s.content.slice(0, 100) })),
    scored: scored.map(s => ({
      signal_id: s.signal_id,
      should_promote: s.should_promote,
      relevance: s.relevance,
      reach: s.reach,
      valence: s.valence,
      category: s.category,
      cluster_key: s.dedup_cluster_key,
      headline: s.headline,
    })),
  });
}
