import { sql } from '@/lib/db';
import {
  fetchTweetEngagement,
  clientMedianVelocity,
  autoWeightFromVelocity,
  EngagementMetrics,
} from '@/lib/engagement';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

// Compute velocity given live engagement and the original post timestamp.
// Same formula as Item 3's seed: floor denominator at 168h.
function computeVelocity(m: EngagementMetrics, addedAtIso: string): number {
  const ts = Date.parse(addedAtIso);
  const ageHours = Number.isFinite(ts) ? (Date.now() - ts) / 3_600_000 : 168;
  const denom = Math.max(ageHours, 168);
  return (m.likes + 2 * m.retweets + 0.5 * m.replies) / denom;
}

/**
 * Daily cron — refresh engagement for shipped voice examples.
 * Configured in vercel.json. Anyone with the URL can hit it; that's
 * fine because the operation is idempotent and rate-limited by what
 * voice_examples rows exist.
 *
 * Strategy:
 *   1. For each example with shipped_tweet_id where engagement_24h is
 *      NULL OR (engagement_fetched_at < now - 23h AND engagement_7d is
 *      NULL): fetch live engagement, store as engagement_24h.
 *   2. For each example with engagement_7d NULL where added_at is
 *      between 6.5d–8d old (so we capture 7d once): fetch and store
 *      engagement_7d.
 *   3. After updating engagement, recompute velocity and apply
 *      auto-weight policy (weight=3 if >2x median, weight=1 if <0.25x).
 *      Never zero-weights.
 *
 * Returns counts so cron logs are useful.
 */
export async function GET() {
  const startedAt = Date.now();
  const errors: string[] = [];

  // Step 1: 24h capture (haven't fetched yet, or stale)
  const need24h = await sql`
    SELECT id, client_id, shipped_tweet_id, added_at
    FROM voice_examples
    WHERE shipped_tweet_id IS NOT NULL
      AND (engagement_24h IS NULL OR engagement_fetched_at < NOW() - INTERVAL '23 hours')
      AND (engagement_7d IS NULL)
    ORDER BY added_at DESC
    LIMIT 50
  `;

  let updated24h = 0;
  for (const row of need24h.rows) {
    try {
      const live = await fetchTweetEngagement(row.shipped_tweet_id);
      if (!live) {
        errors.push(`24h fetch failed for example ${row.id} tweet ${row.shipped_tweet_id}`);
        continue;
      }
      const velocity = computeVelocity(live, row.added_at);
      await sql`
        UPDATE voice_examples
        SET engagement_24h = ${JSON.stringify(live)}::jsonb,
            engagement_velocity = ${velocity},
            engagement_fetched_at = NOW()
        WHERE id = ${row.id}
      `;
      updated24h++;
    } catch (e: any) {
      errors.push(`24h example ${row.id}: ${e.message}`);
    }
  }

  // Step 2: 7d capture (only once, when ready)
  const need7d = await sql`
    SELECT id, client_id, shipped_tweet_id, added_at
    FROM voice_examples
    WHERE shipped_tweet_id IS NOT NULL
      AND engagement_7d IS NULL
      AND added_at <= NOW() - INTERVAL '6 days 12 hours'
      AND added_at > NOW() - INTERVAL '14 days'
    ORDER BY added_at ASC
    LIMIT 50
  `;

  let updated7d = 0;
  for (const row of need7d.rows) {
    try {
      const live = await fetchTweetEngagement(row.shipped_tweet_id);
      if (!live) {
        errors.push(`7d fetch failed for example ${row.id} tweet ${row.shipped_tweet_id}`);
        continue;
      }
      const velocity = computeVelocity(live, row.added_at);
      await sql`
        UPDATE voice_examples
        SET engagement_7d = ${JSON.stringify(live)}::jsonb,
            engagement_velocity = ${velocity},
            engagement_fetched_at = NOW()
        WHERE id = ${row.id}
      `;
      updated7d++;
    } catch (e: any) {
      errors.push(`7d example ${row.id}: ${e.message}`);
    }
  }

  // Step 3: auto-weight pass for all examples that just got fresh engagement.
  // Compute per-client median once, then iterate.
  const clientIds: number[] = [
    ...new Set(
      [...need24h.rows, ...need7d.rows].map((r: any) => r.client_id as number)
    ),
  ];

  let auto_weight_changes = 0;
  for (const cid of clientIds) {
    try {
      const median = await clientMedianVelocity(cid);
      if (median === null || median <= 0) continue;
      const recents = await sql`
        SELECT id, weight, engagement_velocity
        FROM voice_examples
        WHERE client_id = ${cid}
          AND shipped_tweet_id IS NOT NULL
          AND engagement_velocity IS NOT NULL
          AND engagement_fetched_at >= NOW() - INTERVAL '5 minutes'
      `;
      for (const r of recents.rows) {
        const adj = autoWeightFromVelocity(Number(r.engagement_velocity), median);
        if (!adj) continue;
        if (adj.weight === r.weight) continue;
        await sql`
          UPDATE voice_examples
          SET weight = ${adj.weight}, auto_weight_reason = ${adj.reason}
          WHERE id = ${r.id}
        `;
        auto_weight_changes++;
      }
    } catch (e: any) {
      errors.push(`auto-weight client ${cid}: ${e.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    updated_24h: updated24h,
    updated_7d: updated7d,
    auto_weight_changes,
    duration_ms: Date.now() - startedAt,
    errors,
  });
}
