import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/admin/intel-debug?client_id=4 — dumps tag/sentiment
// summary + raw shape of topic_tags so we can see what type of value
// is coming back from the Postgres TEXT[] driver.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cid = parseInt(searchParams.get('client_id') || '0');
  if (cid <= 0) return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });

  const r = await sql`
    SELECT id, sentiment, topic_tags, relevance_score, content
    FROM events
    WHERE client_id = ${cid}
    ORDER BY id DESC
    LIMIT 50
  `;
  const sample = r.rows.slice(0, 10).map((row: any) => ({
    id: row.id,
    sentiment: row.sentiment,
    topic_tags: row.topic_tags,
    topic_tags_type: typeof row.topic_tags,
    topic_tags_is_array: Array.isArray(row.topic_tags),
    score: row.relevance_score,
    content_preview: (row.content || '').slice(0, 80),
  }));
  const counts = {
    total: r.rows.length,
    with_sentiment: r.rows.filter((row: any) => row.sentiment).length,
    with_topic_tags_truthy: r.rows.filter((row: any) => row.topic_tags).length,
    with_topic_tags_array_nonempty: r.rows.filter((row: any) => Array.isArray(row.topic_tags) && row.topic_tags.length > 0).length,
  };
  return NextResponse.json({ ok: true, counts, sample });
}
