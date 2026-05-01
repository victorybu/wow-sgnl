import webpush from 'web-push';
import { sql } from './db';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@wowsgnl.com';

let configured = false;
function configure() {
  if (configured) return;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
}

export type PushSubscriptionRow = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string | null;
};

export type NotificationPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send a notification to every active subscription. Web push is one-
 * shot — if the endpoint returns 410 Gone, the subscription is dead
 * (user uninstalled, revoked permission, etc.) and we delete it. Any
 * other failure increments a counter so we can soft-quarantine flaky
 * endpoints without blocking the rest of the broadcast.
 *
 * Returns counts: sent / dead / failed.
 */
export async function broadcastPush(
  payload: NotificationPayload,
): Promise<{ sent: number; dead: number; failed: number }> {
  configure();
  if (!configured) {
    return { sent: 0, dead: 0, failed: 0 };
  }

  const subs = await sql`SELECT id, endpoint, p256dh, auth, label FROM push_subscriptions`;
  let sent = 0;
  let dead = 0;
  let failed = 0;

  await Promise.all(
    subs.rows.map(async (s: PushSubscriptionRow) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 30 }, // 30 min — score≥9 is hot, doesn't need to wait around if device is offline for hours
        );
        await sql`UPDATE push_subscriptions SET last_pushed_at = NOW(), failed_count = 0 WHERE id = ${s.id}`;
        sent++;
      } catch (err: any) {
        const status = err?.statusCode || err?.status;
        if (status === 404 || status === 410) {
          await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`;
          dead++;
        } else {
          await sql`UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ${s.id}`;
          failed++;
        }
      }
    }),
  );

  return { sent, dead, failed };
}

export function pushConfigured(): boolean {
  return !!(PUBLIC_KEY && PRIVATE_KEY);
}
