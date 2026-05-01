import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/push/unsubscribe — body: { endpoint }
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const endpoint = String(body.endpoint || '');
  if (!endpoint) return NextResponse.json({ ok: false, error: 'endpoint required' }, { status: 400 });
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  return NextResponse.json({ ok: true });
}
