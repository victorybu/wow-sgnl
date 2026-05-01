import { sql } from '@/lib/db';
import { fetchAllUserTweets, HistoricalTweet } from '@/lib/twitterapi';
import { anthropic } from '@/lib/anthropic';
import { getCurrentClient } from '@/lib/clients';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STYLE_TAGS = [
  'anaphora',
  'naming',
  'attack',
  'framing',
  'calibrated-length',
  'narrative',
  'contrarian',
  'multi-issue',
];

type Engagement = {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views?: number | null;
};

function engagementVelocity(t: HistoricalTweet): { score: number; ageHours: number } {
  const ts = Date.parse(t.createdAt);
  const ageHours = Number.isFinite(ts) ? (Date.now() - ts) / 3_600_000 : 0;
  // Floor denominator at 168h (1 week) so very recent tweets don't get
  // artificially boosted. Older tweets use their actual age.
  const denom = Math.max(ageHours, 168);
  const score = (t.likeCount + 2 * t.retweetCount + 0.5 * t.replyCount) / denom;
  return { score, ageHours };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

async function tagBatch(items: { idx: number; text: string }[]): Promise<Record<number, string[]>> {
  const sys = `You tag tweets with applicable style descriptors from this fixed list:
${STYLE_TAGS.join(', ')}

Definitions:
- anaphora: repeated sentence structures for emphasis ("They came for X. They came for Y.")
- naming: explicitly names specific people, companies, dollar amounts, bills
- attack: direct attack on a named opponent
- framing: re-frames an issue with a fresh angle
- calibrated-length: notably long and substantive (500+ char) post
- narrative: tells a story or evokes a scene
- contrarian: takes a position against the grain
- multi-issue: connects several priority issues into one argument

Output JSON only: {"results":[{"idx":<int>,"tags":[<tag>...]},...]}
Tag liberally; one tweet can match multiple. If none apply, return [].`;

  const numbered = items.map(it => `[${it.idx}] ${it.text.slice(0, 600)}`).join('\n\n');
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 800,
    system: sys,
    messages: [{ role: 'user', content: numbered }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(clean);
    const out: Record<number, string[]> = {};
    for (const r of parsed.results || []) {
      const idx = Number(r.idx);
      if (Number.isInteger(idx)) {
        out[idx] = (Array.isArray(r.tags) ? r.tags : [])
          .map((t: any) => String(t).toLowerCase().trim())
          .filter((t: string) => STYLE_TAGS.includes(t));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get('username') || '').replace(/^@/, '').trim();
  const maxPages = Math.max(1, Math.min(100, Number(searchParams.get('pages')) || 50));
  const maxAgeMonths = Math.max(1, Math.min(48, Number(searchParams.get('age_months')) || 18));
  const requestedClientId = Number(searchParams.get('client_id'));

  let clientId: number;
  let clientName = '';
  if (Number.isInteger(requestedClientId) && requestedClientId > 0) {
    const r = await sql`SELECT id, name FROM clients WHERE id = ${requestedClientId}`;
    if (r.rows.length === 0) {
      return new Response('client not found', { status: 404 });
    }
    clientId = r.rows[0].id;
    clientName = r.rows[0].name;
  } else {
    const cur = await getCurrentClient();
    if (!cur) return new Response('no clients', { status: 404 });
    clientId = cur.id;
    clientName = cur.name;
  }

  if (!username) {
    return new Response('username required', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send('log', { msg: `Seeding voice for ${clientName} from @${username} (max ${maxPages} pages, ${maxAgeMonths}mo back)` });

        // === 1. Fetch all pages ===
        let pageCount = 0;
        const allTweets = await fetchAllUserTweets({
          username,
          maxPages,
          maxAgeMonths,
          onPage: (page, items, cursor) => {
            pageCount = page + 1;
            send('page', {
              page: pageCount,
              fetched_this_page: items.length,
              has_cursor: !!cursor,
            });
          },
        });
        send('fetch_done', { total_fetched: allTweets.length, pages_used: pageCount });

        // === 2. Filter ===
        const cutoffMs = Date.now() - maxAgeMonths * 30 * 24 * 60 * 60 * 1000;
        let droppedRT = 0;
        let droppedReply = 0;
        let droppedAge = 0;
        let droppedEmpty = 0;

        const kept = allTweets.filter(t => {
          if (!t.text || t.text.trim().length < 5) { droppedEmpty++; return false; }
          if (t.is_retweet || t.text.startsWith('RT @')) { droppedRT++; return false; }
          if (t.isReply || t.text.trim().startsWith('@')) { droppedReply++; return false; }
          const ts = Date.parse(t.createdAt);
          if (Number.isFinite(ts) && ts < cutoffMs) { droppedAge++; return false; }
          return true;
        });

        send('filter_done', {
          kept: kept.length,
          dropped_rt: droppedRT,
          dropped_reply: droppedReply,
          dropped_age: droppedAge,
          dropped_empty: droppedEmpty,
        });

        if (kept.length === 0) {
          send('done', { imported: 0, skipped: 0, error: 'no eligible tweets after filter' });
          controller.close();
          return;
        }

        // === 3. Velocity & percentiles ===
        const withVelocity = kept.map(t => {
          const v = engagementVelocity(t);
          return { tweet: t, velocity: v.score, ageHours: v.ageHours };
        });
        const sortedScores = withVelocity.map(w => w.velocity).slice().sort((a, b) => a - b);
        const p50 = quantile(sortedScores, 0.5);
        const p75 = quantile(sortedScores, 0.75);
        const p95 = quantile(sortedScores, 0.95);

        send('percentile', {
          n: sortedScores.length,
          p50: Number(p50.toFixed(3)),
          p75: Number(p75.toFixed(3)),
          p95: Number(p95.toFixed(3)),
          gold_threshold: Number(p95.toFixed(3)),
          boost_threshold: Number(p75.toFixed(3)),
          canon_threshold: Number(p50.toFixed(3)),
        });

        // Determine weight per tweet; skip if below median
        const toImport = withVelocity
          .filter(w => w.velocity >= p50)
          .map(w => {
            let weight = 1;
            if (w.velocity >= p95) weight = 3;
            else if (w.velocity >= p75) weight = 2;
            return { ...w, weight };
          });

        const skippedLowEng = withVelocity.length - toImport.length;
        send('selection_done', {
          to_import: toImport.length,
          skipped_low_engagement: skippedLowEng,
          gold_count: toImport.filter(w => w.weight === 3).length,
          boost_count: toImport.filter(w => w.weight === 2).length,
          canon_count: toImport.filter(w => w.weight === 1).length,
        });

        // === 4. Batch-tag style descriptors ===
        const CHUNK = 25;
        const tagsByIdx: Record<number, string[]> = {};
        const totalChunks = Math.ceil(toImport.length / CHUNK);
        for (let chunkI = 0; chunkI < totalChunks; chunkI++) {
          const start = chunkI * CHUNK;
          const slice = toImport.slice(start, start + CHUNK);
          const items = slice.map((w, i) => ({ idx: start + i, text: w.tweet.text }));
          try {
            const got = await tagBatch(items);
            for (const k of Object.keys(got)) tagsByIdx[Number(k)] = got[Number(k)];
          } catch (e: any) {
            send('tag_error', { chunk: chunkI + 1, error: e.message });
          }
          send('tag_progress', { chunks_done: chunkI + 1, chunks_total: totalChunks });
        }

        // === 5. Insert into voice_examples ===
        let inserted = 0;
        for (let i = 0; i < toImport.length; i++) {
          const w = toImport[i];
          const t = w.tweet;
          const tags = tagsByIdx[i] || [];
          const engagement: Engagement = {
            likes: t.likeCount,
            retweets: t.retweetCount,
            replies: t.replyCount,
            quotes: t.quoteCount,
            views: t.viewCount ?? null,
          };
          try {
            await sql`
              INSERT INTO voice_examples
                (client_id, source, content, weight, notes,
                 engagement_24h, engagement_velocity, added_at)
              VALUES
                (${clientId}, 'auto_canon', ${t.text}, ${w.weight},
                 ${tags.join(', ') || null},
                 ${JSON.stringify(engagement)}::jsonb,
                 ${w.velocity},
                 ${t.createdAt ? new Date(t.createdAt).toISOString() : null})
            `;
            inserted++;
            if (inserted % 25 === 0) {
              send('insert_progress', { inserted, total: toImport.length });
            }
          } catch (e: any) {
            send('insert_error', { tweet_id: t.id, error: e.message });
          }
        }

        send('done', {
          imported: inserted,
          skipped: skippedLowEng,
          fetched: allTweets.length,
        });
      } catch (e: any) {
        send('error', { message: e.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
