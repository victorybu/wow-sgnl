import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/push/subscribe
// body: { endpoint, keys: { p256dh, auth }, label? }
//
// Stores the subscription so /api/poll's 9+ trigger can broadcast.
// Idempotent on endpoint (UNIQUE constraint).
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const endpoint = String(body.endpoint || '');
  const p256dh = String(body.keys?.p256dh || '');
  const auth = String(body.keys?.auth || '');
  const label = body.label ? String(body.label).slice(0, 80) : null;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'endpoint + keys.p256dh + keys.auth required' }, { status: 400 });
  }
  await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, label)
    VALUES (${endpoint}, ${p256dh}, ${auth}, ${label})
    ON CONFLICT (endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label, failed_count = 0
  `;
  return NextResponse.json({ ok: true });
}
