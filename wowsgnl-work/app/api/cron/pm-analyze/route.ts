import { sql } from '@/lib/db';
import { scorePolymarketBatch, type ScoreInputSignal } from '@/lib/polymarket/prompts/score';
import { generateTodaysRead, type TodaysReadInputItem, type PriorityPerson } from '@/lib/polymarket/prompts/todays-read';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

const POLYMARKET_CLIENT_ID = 4;
// 20 events per batch keeps the score prompt JSON output well within
// max_tokens (8000). Earlier 40-event batches were truncating mid-JSON,
// which fired the score.ts backfill marking every signal as
// not-promotable — pm-analyze landed 0 promotions across 4 runs.
const BATCH_SIZE = 20;

// GET /api/cron/pm-analyze
//
// Polymarket-scoped scoring + dedup pass. Reads up to BATCH_SIZE
// unprocessed events for client_id=4, batches through the score
// prompt, groups results by dedup_cluster_key, and creates ONE
// pm_intel_items row per cluster. signal_event_ids[] holds every
// events.id that the cluster synthesizes — that's also our
// "processed" marker (any event referenced in pm_intel_items.signal_event_ids
// is considered done).
//
// Idempotent: re-running picks up only events not yet referenced.
// Also runs additively alongside the existing /api/poll Signal scorer
// — events.relevance_score keeps getting written by /api/poll for
// /briefing compatibility; pm_intel_items is the richer view layered
// on top for /polymarket.
export async function GET() {
  const errors: string[] = [];

  // Pull unprocessed events for Polymarket. UNNEST flattens the
  // signal_event_ids arrays from pm_intel_items into a single set
  // we can NOT IN against. With <10K Polymarket events the perf is
  // fine; revisit if scale grows.
  const unprocessed = await sql`
    SELECT e.id, e.source, e.author, e.content, e.url, e.posted_at
    FROM events e
    WHERE e.client_id = ${POLYMARKET_CLIENT_ID}
      AND NOT EXISTS (
        SELECT 1 FROM pm_intel_items pi
        WHERE e.id = ANY(pi.signal_event_ids)
      )
    ORDER BY
      -- Curated sources first (pre-filtered to be Polymarket-relevant
      -- by their respective lib queries). Twitter is broad watcher
      -- chatter — most isn't promote-worthy. Without this ordering
      -- the first batches drown in raw Twitter noise.
      CASE e.source
        WHEN 'serpapi' THEN 1
        WHEN 'fed_register' THEN 1
        WHEN 'fec' THEN 1
        WHEN 'congress' THEN 1
        ELSE 2
      END,
      e.created_at DESC, e.id DESC
    LIMIT ${BATCH_SIZE}
  `;

  const signals: ScoreInputSignal[] = unprocessed.rows.map((r: any) => ({
    id: r.id,
    source: r.source || 'unknown',
    author: r.author,
    content: r.content || '',
    url: r.url,
    posted_at: r.posted_at,
  }));

  if (signals.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      promoted: 0,
      clusters_created: 0,
      message: 'no unprocessed Polymarket events',
    });
  }

  let scored;
  try {
    scored = await scorePolymarketBatch(signals);
  } catch (err: any) {
    errors.push(`score: ${err?.message || 'unknown'}`);
    return NextResponse.json({ ok: false, errors }, { status: 500 });
  }

  // Group by dedup_cluster_key. Only promotable items contribute.
  // Drop should_promote=false signals from cluster bodies but still
  // mark them as processed (so we don't re-score them next run) by
  // attaching them to a "noise" cluster that gets one minimal row.
  type ClusterAcc = {
    key: string;
    members: typeof scored;
    primary: typeof scored[number] | null;
  };
  const promotedByKey = new Map<string, ClusterAcc>();
  const noiseSignalIds: number[] = [];

  for (const s of scored) {
    if (!s.should_promote) {
      noiseSignalIds.push(s.signal_id);
      continue;
    }
    let agg = promotedByKey.get(s.dedup_cluster_key);
    if (!agg) {
      agg = { key: s.dedup_cluster_key, members: [], primary: null };
      promotedByKey.set(s.dedup_cluster_key, agg);
    }
    agg.members.push(s);
    // Primary = highest relevance, ties broken by reach.
    if (!agg.primary
      || s.relevance > agg.primary.relevance
      || (s.relevance === agg.primary.relevance && s.reach > agg.primary.reach)) {
      agg.primary = s;
    }
  }

  // Pre-fetch URLs for source_links assembly.
  const allSignalIds = scored.map(s => s.signal_id);
  const urlRowsRes = await sql`
    SELECT id, author, source, url
    FROM events
    WHERE id = ANY(${allSignalIds})
  `;
  const urlById = new Map<number, { author: string | null; source: string; url: string | null }>();
  for (const row of urlRowsRes.rows) {
    urlById.set(row.id, { author: row.author, source: row.source, url: row.url });
  }

  function priorityFor(relevance: number, valence: number): number {
    // Priority 1 = top of the dashboard. Big relevance OR strong
    // valence (very positive or very negative) elevates priority.
    if (relevance >= 80 || Math.abs(valence) >= 2) return 1;
    if (relevance >= 50) return 2;
    return 3;
  }

  const today = new Date().toISOString().slice(0, 10);
  let clustersCreated = 0;
  let promotedCount = 0;

  for (const agg of promotedByKey.values()) {
    if (!agg.primary) continue;
    const memberIds = agg.members.map(m => m.signal_id);
    const links = memberIds.map(id => {
      const u = urlById.get(id);
      if (!u || !u.url) return null;
      const label = u.author ? `@${u.author}` : u.source;
      return { label, url: u.url };
    }).filter(Boolean);
    const tagsUnion = Array.from(new Set(agg.members.flatMap(m => m.topic_tags))).slice(0, 8);
    const priority = priorityFor(agg.primary.relevance, agg.primary.valence);
    try {
      await sql`
        INSERT INTO pm_intel_items
          (signal_event_ids, category, headline, summary, valence, priority,
           topic_tags, source_links, for_date)
        VALUES
          (${memberIds}::int[], ${agg.primary.category}, ${agg.primary.headline},
           ${agg.primary.summary}, ${agg.primary.valence}, ${priority},
           ${tagsUnion}::text[], ${JSON.stringify(links)}::jsonb, ${today}::date)
      `;
      clustersCreated++;
      promotedCount += memberIds.length;
    } catch (err: any) {
      errors.push(`insert cluster ${agg.key}: ${err?.message || 'unknown'}`);
    }
  }

  // Emit one "noise bucket" row per analyze run so noise events get
  // marked processed (they appear in signal_event_ids of a not-promote
  // pm_intel_items row). Category = 'chatter', priority = 3, low
  // relevance — never surfaced on the dashboard's priority filter,
  // but the row keeps the dedup-tracking contract intact.
  if (noiseSignalIds.length > 0) {
    try {
      await sql`
        INSERT INTO pm_intel_items
          (signal_event_ids, category, headline, summary, valence, priority,
           topic_tags, source_links, for_date)
        VALUES
          (${noiseSignalIds}::int[], 'chatter',
           ${`(noise) ${noiseSignalIds.length} unpromoted signals`},
           'Batch of low-relevance signals marked processed; not surfaced on dashboard.',
           0, 3, ${[]}::text[], ${'[]'}::jsonb, ${today}::date)
      `;
    } catch (err: any) {
      errors.push(`insert noise bucket: ${err?.message || 'unknown'}`);
    }
  }

  // === STEP 2: Today's Read narrative generator ===
  // After scoring + dedup, synthesize today's promoted items into one
  // morning narrative paragraph. Idempotent: if today's Today's Read
  // row already exists (headline starts with "Today's Read · "),
  // UPDATE it instead of inserting a duplicate. Skips entirely if
  // there are no promoted items today (don't burn an Opus call to
  // produce nothing).
  let todaysReadGenerated = false;
  try {
    // Today's promoted items (excludes the noise bucket — its
    // headline starts with "(noise)").
    const todayItemsRes = await sql`
      SELECT id, category, headline, summary, valence, source_links
      FROM pm_intel_items
      WHERE for_date = ${today}::date
        AND headline NOT LIKE '(noise)%'
        AND headline NOT LIKE 'Today''s Read · %'
      ORDER BY priority ASC, ABS(COALESCE(valence, 0)) DESC, id DESC
      LIMIT 25
    `;
    const todayItems: TodaysReadInputItem[] = todayItemsRes.rows.map((r: any) => ({
      id: r.id, category: r.category, headline: r.headline, summary: r.summary,
      valence: r.valence, source_links: r.source_links || [],
    }));

    if (todayItems.length > 0) {
      // Last 7 days of high-priority context (excluding today and noise).
      const weekRes = await sql`
        SELECT id, category, headline, summary, valence, source_links
        FROM pm_intel_items
        WHERE for_date >= (CURRENT_DATE - INTERVAL '7 days')
          AND for_date < ${today}::date
          AND headline NOT LIKE '(noise)%'
          AND headline NOT LIKE 'Today''s Read · %'
          AND priority <= 2
        ORDER BY for_date DESC, priority ASC
        LIMIT 15
      `;
      const weekContext: TodaysReadInputItem[] = weekRes.rows.map((r: any) => ({
        id: r.id, category: r.category, headline: r.headline, summary: r.summary,
        valence: r.valence, source_links: r.source_links || [],
      }));

      // Priority people for action-hint context.
      const peopleRes = await sql`
        SELECT name, role, employer, lane, posture, last_touched
        FROM pm_people
        WHERE priority = TRUE
        ORDER BY last_touched DESC NULLS LAST
        LIMIT 12
      `;
      const priorityPeople: PriorityPerson[] = peopleRes.rows.map((r: any) => ({
        name: r.name, role: r.role, employer: r.employer, lane: r.lane,
        posture: r.posture, last_touched: r.last_touched,
      }));

      const result = await generateTodaysRead({
        todayItems, weekContext, priorityPeople, forDate: today,
      });

      if (result && result.narrative) {
        // Check for existing Today's Read row for today.
        const existing = await sql`
          SELECT id FROM pm_intel_items
          WHERE for_date = ${today}::date
            AND category = 'todays_read'
            AND headline LIKE 'Today''s Read · %'
          LIMIT 1
        `;
        const headline = `Today's Read · ${today}`;
        const tagsArr = ['todays_read', 'daily_summary'];
        const linksJson = JSON.stringify(result.source_links || []);
        const hintsCsv = result.action_hints.join(' · ');
        const memberIdsForRow = todayItems.map(t => t.id);
        if (existing.rows.length > 0) {
          await sql`
            UPDATE pm_intel_items
            SET signal_event_ids = ${memberIdsForRow}::int[],
                summary = ${result.narrative},
                analysis = ${hintsCsv || null},
                source_links = ${linksJson}::jsonb,
                topic_tags = ${tagsArr}::text[],
                priority = 1,
                valence = 0
            WHERE id = ${existing.rows[0].id}
          `;
        } else {
          await sql`
            INSERT INTO pm_intel_items
              (signal_event_ids, category, headline, summary, analysis,
               valence, priority, topic_tags, source_links, for_date)
            VALUES
              (${memberIdsForRow}::int[], 'todays_read', ${headline},
               ${result.narrative}, ${hintsCsv || null},
               0, 1, ${tagsArr}::text[],
               ${linksJson}::jsonb, ${today}::date)
          `;
        }
        todaysReadGenerated = true;
      }
    }
  } catch (err: any) {
    errors.push(`todays_read: ${err?.message || 'unknown'}`);
  }

  // Snapshot of pm_intel_items state.
  const totals = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM pm_intel_items) AS total_items,
      (SELECT COUNT(*)::int FROM pm_intel_items WHERE for_date = ${today}::date) AS items_today,
      (SELECT COUNT(*)::int FROM pm_intel_items WHERE category = 'kalshi') AS kalshi_items,
      (SELECT COUNT(*)::int FROM pm_intel_items WHERE category = 'todays_read') AS todays_read_items
  `;

  return NextResponse.json({
    ok: true,
    processed: signals.length,
    promoted: promotedCount,
    clusters_created: clustersCreated,
    noise_bucket: noiseSignalIds.length,
    todays_read_generated: todaysReadGenerated,
    totals: totals.rows[0],
    errors,
  });
}
