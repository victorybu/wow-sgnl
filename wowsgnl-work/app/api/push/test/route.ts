import { broadcastPush, pushConfigured } from '@/lib/push';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/push/test — fire a sample notification to all active
// subscribers so you can verify the round-trip without waiting for a
// real 9+ event.
export async function POST() {
  if (!pushConfigured()) {
    return NextResponse.json({ ok: false, error: 'VAPID keys not configured in env' }, { status: 503 });
  }
  const result = await broadcastPush({
    title: 'Signal · push working',
    body: 'This is a test notification — your subscription is live.',
    url: '/',
    tag: 'signal-test',
  });
  return NextResponse.json({ ok: true, ...result });
}
