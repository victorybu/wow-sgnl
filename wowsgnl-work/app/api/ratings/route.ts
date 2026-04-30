import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  const r = await sql`
    SELECT h.id, h.event_id, h.rating, h.reason, h.note, h.rated_at,
           e.author, e.content, e.url
    FROM ratings_history h
    LEFT JOIN events e ON e.id = h.event_id
    ORDER BY h.rated_at DESC
    LIMIT 1000
  `;
  return NextResponse.json({ ts: new Date().toISOString(), rows: r.rows });
}
