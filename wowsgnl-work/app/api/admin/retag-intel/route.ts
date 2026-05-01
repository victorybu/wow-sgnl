import { sql } from '@/lib/db';
import { scoreRelevance } from '@/lib/relevance';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

// POST /api/admin/retag-intel?client_id=4&limit=20
//
// Rescore events for an intelligence-mode client that already have a
// relevance_score but lack topic_tags. This is the catch-up path
// for events scored before topic_tags + sentiment were extracted, or
// before the prompt was loosened to tag broad themes (not just
// priority_topics matches). Idempotent — once an event has tags,
// it's no longer in the WHERE filter.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = parseInt(searchParams.get('client_id') || '0');
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20')));
  if (clientId <= 0) {
    return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });
  }

  // Confirm the client is intelligence-mode — drafting clients don't
  // get topic_tags written; we'd just be burning Sonnet credits.
  const c = await sql`SELECT id, name, mode, priority_topics FROM clients WHERE id = ${clientId}`;
  const client = c.rows[0];
  if (!client) return NextResponse.json({ ok: false, error: 'client not found' }, { status: 404 });
  if (client.mode !== 'intelligence') {
    return NextResponse.json({ ok: false, error: 'client is not intelligence-mode' }, { status: 400 });
  }

  const r = await sql`
    SELECT e.id, e.client_id, e.source, e.content, e.author,
           e.posted_at, e.created_at
    FROM events e
    WHERE e.client_id = ${clientId}
      AND e.relevance_score IS NOT NULL
      AND e.topic_tags IS NULL
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${limit}
  `;

  let retagged = 0;
  let stillEmpty = 0;
  const sample: any[] = [];
  for (const e of r.rows) {
    try {
      const refTs = e.posted_at ? Date.parse(e.posted_at) : Date.parse(e.created_at);
      const hoursOld = Number.isFinite(refTs) ? (Date.now() - refTs) / 3_600_000 : null;
      const result = await scoreRelevance({
        content: e.content,
        source: e.source || 'twitter',
        clientName: client.name,
        priorityTopics: client.priority_topics || '',
        author: e.author,
        hoursOld,
        mode: 'intelligence',
      });
      await sql`
        UPDATE events
        SET relevance_score = ${result.score},
            relevance_reason = ${result.reason},
            sentiment = ${result.sentiment},
            topic_tags = ${result.topic_tags}
        WHERE id = ${e.id}
      `;
      if (result.topic_tags && result.topic_tags.length > 0) {
        retagged++;
        if (sample.length < 5) {
          sample.push({
            id: e.id,
            sentiment: result.sentiment,
            tags: result.topic_tags,
            score: result.score,
          });
        }
      } else {
        stillEmpty++;
      }
    } catch {
      stillEmpty++;
    }
  }

  const remaining = await sql`
    SELECT COUNT(*)::int AS n FROM events
    WHERE client_id = ${clientId}
      AND relevance_score IS NOT NULL
      AND topic_tags IS NULL
  `;

  return NextResponse.json({
    ok: true,
    processed: r.rows.length,
    retagged,
    still_empty: stillEmpty,
    remaining: remaining.rows[0].n,
    sample,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
