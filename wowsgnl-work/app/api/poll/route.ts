import { sql } from '@/lib/db';
import { fetchUserTweets, searchTweets } from '@/lib/twitterapi';
import { scoreRelevance } from '@/lib/relevance';
import { generateAngles } from '@/lib/drafts';
import { getActiveVoiceExamples, getActiveAntiVoiceExamples } from '@/lib/voice';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

export async function GET() {
  const errors: string[] = [];
  const debug: any = { watchlist_count: 0, fetched_per_watcher: [], unscored_count: 0 };

  const watchlist = await sql`
    SELECT w.id, w.client_id, w.kind, w.value, w.active, w.last_seen_source_id,
           c.name as client_name, c.priority_topics, c.voice_profile
    FROM watchlist w JOIN clients c ON c.id = w.client_id
    WHERE w.active = TRUE
    ORDER BY w.id
  `;
  debug.watchlist_count = watchlist.rows.length;

  let inserted = 0;
  let scored = 0;

  // Parallelize watcher fetches in chunks. With 100+ active watchers,
  // a serial loop blows past the 300s lambda before scoring even
  // starts. Chunk size 8 is the sweet spot — twitterapi.io is
  // happy with bursts that small, and the math works out: 100
  // watchers / 8 in-flight × ~2s/call = ~25s for ingestion vs 200s+
  // serial. Per-chunk Promise.allSettled keeps one bad watcher from
  // poisoning the whole chunk.
  const CHUNK_SIZE = 8;
  for (let i = 0; i < watchlist.rows.length; i += CHUNK_SIZE) {
    const chunk = watchlist.rows.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(chunk.map(async (w: any) => {
      let result: { tweets: any[]; newestSeenId: string | null };
      if (w.kind === 'x_account') {
        result = await fetchUserTweets(w.value, { lastSeenId: w.last_seen_source_id, cap: 20 });
      } else if (w.kind === 'x_keyword') {
        result = await searchTweets(w.value, { lastSeenId: w.last_seen_source_id, cap: 20 });
      } else {
        return { skipped: true } as any;
      }
      return { w, result };
    }));

    // Sequentially handle DB writes — Neon's HTTP driver works best
    // with one query at a time, and the writes are fast (small rows,
    // ON CONFLICT DO NOTHING). Parallelizing fetches but serializing
    // writes is the right shape for this workload.
    for (let j = 0; j < results.length; j++) {
      const w = chunk[j];
      const r = results[j];
      if (r.status === 'rejected') {
        errors.push(`${w.value} (${w.kind}): ${(r.reason as any)?.message || 'unknown error'}`);
        continue;
      }
      const v = r.value as any;
      if (v.skipped) continue;
      const tweets = v.result.tweets as any[];
      debug.fetched_per_watcher.push({ value: w.value, kind: w.kind, count: tweets.length });
      if (v.result.newestSeenId && v.result.newestSeenId !== w.last_seen_source_id) {
        await sql`UPDATE watchlist SET last_seen_source_id = ${v.result.newestSeenId} WHERE id = ${w.id}`;
      }
      for (const t of tweets) {
        const url = `https://x.com/${t.author?.userName || ''}/status/${t.id}`;
        const ins = await sql`
          INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
          VALUES (${w.client_id}, 'x', ${t.id}, ${t.author?.userName || null}, ${t.text || ''}, ${url}, ${t.createdAt})
          ON CONFLICT (source, source_id) DO NOTHING
          RETURNING id
        `;
        if (ins.rows.length > 0) inserted++;
      }
    }
  }

  const unscored = await sql`
    SELECT e.id, e.client_id, e.source, e.content, e.author,
           e.posted_at, e.created_at,
           c.name as client_name, c.priority_topics, c.mode
    FROM events e JOIN clients c ON c.id = e.client_id
    WHERE e.relevance_score IS NULL
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 40
  `;
  debug.unscored_count = unscored.rows.length;

  for (const e of unscored.rows) {
    try {
      const refTs = e.posted_at ? Date.parse(e.posted_at) : Date.parse(e.created_at);
      const hoursOld = Number.isFinite(refTs) ? (Date.now() - refTs) / 3_600_000 : null;
      const r = await scoreRelevance({
        content: e.content,
        source: e.source,
        clientName: e.client_name,
        priorityTopics: e.priority_topics || '',
        author: e.author,
        hoursOld,
        mode: e.mode === 'intelligence' ? 'intelligence' : 'drafting',
      });
      await sql`
        UPDATE events
        SET relevance_score = ${r.score},
            relevance_reason = ${r.reason},
            sentiment = ${r.sentiment},
            topic_tags = ${r.topic_tags}
        WHERE id = ${e.id}
      `;
      if (r.score < 5) await sql`UPDATE events SET status = 'ignored' WHERE id = ${e.id}`;
      scored++;
    } catch (err: any) {
      errors.push(`score event ${e.id}: ${err.message}`);
    }
  }

  // Top picks: pre-generate angles for up to 5 fresh score>=7 events
  // that don't yet have any drafts, posted in the last 6 hours, not muted.
  // Only for drafting-mode clients — intelligence-mode skips drafting entirely.
  const topPicks = await sql`
    SELECT e.id, e.content, e.client_id, c.name AS client_name, c.voice_profile
    FROM events e JOIN clients c ON c.id = e.client_id
    WHERE c.mode = 'drafting'
      AND e.relevance_score >= 7
      AND (e.feedback IS DISTINCT FROM 'noise')
      AND COALESCE(e.posted_at, e.created_at) >= NOW() - INTERVAL '6 hours'
      AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.event_id = e.id)
    ORDER BY e.relevance_score DESC, COALESCE(e.posted_at, e.created_at) DESC
    LIMIT 5
  `;
  let auto_angled = 0;
  for (const ev of topPicks.rows) {
    try {
      const [voiceExamples, antiExamples] = await Promise.all([
        getActiveVoiceExamples(ev.client_id, 8),
        getActiveAntiVoiceExamples(ev.client_id, 5),
      ]);
      const angles = await generateAngles({
        event: ev.content,
        clientName: ev.client_name,
        voiceProfile: ev.voice_profile || '',
        voiceExamples,
        antiExamples,
      });
      for (const a of angles) {
        await sql`INSERT INTO drafts (event_id, angle, platform) VALUES (${ev.id}, ${a}, 'x')`;
      }
      if (angles.length > 0) {
        await sql`UPDATE events SET status = 'drafted' WHERE id = ${ev.id} AND status = 'new'`;
        auto_angled++;
      }
    } catch (err: any) {
      errors.push(`auto-angle event ${ev.id}: ${err.message}`);
    }
  }

  return NextResponse.json({ ok: true, inserted, scored, auto_angled, debug, errors });
}
