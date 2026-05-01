import { fetchListMembers } from '@/lib/twitterapi';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// GET /api/admin/list-preview?list_id=...&max_pages=2
//
// Read-only sanity check: fetches the first N pages of an X list via
// twitterapi.io and returns count + sample handles. Useful for confirming
// that the list URL is correct (and that the upstream endpoint is up)
// BEFORE running the actual /watchlist import which writes to the DB.
//
// Returns: {ok, list_id, pages, member_count, sample, capped_at}
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listId = searchParams.get('list_id') || '';
  const maxPages = Math.max(1, Math.min(5, parseInt(searchParams.get('max_pages') || '2')));
  if (!listId.match(/^\d+$/)) {
    return NextResponse.json({ ok: false, error: 'list_id required (numeric)' }, { status: 400 });
  }

  try {
    const result = await fetchListMembers({ listId, maxPages });
    return NextResponse.json({
      ok: true,
      list_id: listId,
      pages: result.pages,
      member_count: result.members.length,
      capped_at: result.cappedAt,
      sample: result.members.slice(0, 20).map(m => ({ userName: m.userName, name: m.name })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: (err.message || 'unknown error').slice(0, 500) },
      { status: 500 },
    );
  }
}
