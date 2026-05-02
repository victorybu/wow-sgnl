import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 90;

// GET /api/admin/pm-source-probe?source=fec|congress|fed_register|serpapi
//
// Calls a single integration directly with errors UNCAUGHT so we can
// see if a 0-fetched result is "real empty" or "exception swallowed
// by Promise.allSettled in pm-ingest." Used only for debugging
// when pm-ingest reports 0 from a key-confirmed source.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get('source');
  try {
    if (source === 'fed_register') {
      const { fetchFederalRegisterRecent } = await import('@/lib/polymarket/fed-register');
      const r = await fetchFederalRegisterRecent();
      return NextResponse.json({ ok: true, count: r.length, sample: r.slice(0, 3) });
    }
    if (source === 'serpapi') {
      const { fetchSerpapiRecent } = await import('@/lib/polymarket/serpapi');
      const r = await fetchSerpapiRecent();
      return NextResponse.json({ ok: true, count: r.length, sample: r.slice(0, 3) });
    }
    if (source === 'fec') {
      const { fetchFECRecent } = await import('@/lib/polymarket/fec');
      const { sql } = await import('@/lib/db');
      const targets = await sql`SELECT name FROM pm_kalshi_targets`;
      const targetNames = targets.rows.map((r: any) => r.name);
      const r = await fetchFECRecent({ targetNames });
      return NextResponse.json({ ok: true, count: r.length, targets: targetNames, sample: r.slice(0, 3) });
    }
    if (source === 'congress') {
      const { fetchCongressRecent } = await import('@/lib/polymarket/congress');
      const r = await fetchCongressRecent();
      return NextResponse.json({ ok: true, count: r.length, sample: r.slice(0, 3) });
    }
    return NextResponse.json({ ok: false, error: 'source must be fed_register|fec|serpapi|congress' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err?.message || 'unknown error',
      stack: (err?.stack || '').split('\n').slice(0, 5).join('\n'),
    }, { status: 500 });
  }
}
