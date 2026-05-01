import { sql } from '@/lib/db';
import { scoreRelevance } from '@/lib/relevance';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

// POST /api/admin/score-drain?client_id=4&limit=40
//
// Score the unscored backlog without doing watcher fetching. Useful
// after a /api/poll cycle lands a flood of new tweets and they need
// scoring before the next cron — and for catching up clients that
// were previously timing out.
//
// Idempotent: each call advances by `limit` rows. Hit it repeatedly
// until `remaining = 0`.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = parseInt(searchParams.get('client_id') || '0');
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '40')));

  let rows;
  if (clientId > 0) {
    const r = await sql`
      SELECT e.id, e.client_id, e.source, e.content, e.author,
             e.posted_at, e.created_at,
             c.name as client_name, c.priority_topics, c.mode
      FROM events e JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_score IS NULL AND e.client_id = ${clientId}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit}
    `;
    rows = r.rows;
  } else {
    const r = await sql`
      SELECT e.id, e.client_id, e.source, e.content, e.author,
             e.posted_at, e.created_at,
             c.name as client_name, c.priority_topics, c.mode
      FROM events e JOIN clients c ON c.id = e.client_id
      WHERE e.relevance_score IS NULL
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit}
    `;
    rows = r.rows;
  }

  let scored = 0;
  let failed = 0;
  for (const e of rows) {
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
    } catch {
      failed++;
    }
  }

  let remaining = 0;
  if (clientId > 0) {
    const c = await sql`SELECT COUNT(*)::int AS n FROM events WHERE relevance_score IS NULL AND client_id = ${clientId}`;
    remaining = c.rows[0].n;
  } else {
    const c = await sql`SELECT COUNT(*)::int AS n FROM events WHERE relevance_score IS NULL`;
    remaining = c.rows[0].n;
  }

  return NextResponse.json({ ok: true, processed: rows.length, scored, failed, remaining });
}

export async function GET(req: Request) {
  return POST(req);
}
