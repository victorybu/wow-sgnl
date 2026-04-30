import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Body = {
  event_id?: number;
  rating?: 'signal' | 'noise' | null;
  reason?: string | null;
  note?: string | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const eventId = Number(body.event_id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ ok: false, error: 'event_id required' }, { status: 400 });
  }

  const rating = body.rating === 'signal' || body.rating === 'noise' ? body.rating : null;
  const reason = (body.reason ?? '').toString().slice(0, 200) || null;
  const note = (body.note ?? '').toString().slice(0, 280) || null;

  if (rating === null) {
    await sql`
      UPDATE events
      SET feedback = NULL, feedback_at = NULL, feedback_reason = NULL, feedback_note = NULL
      WHERE id = ${eventId}
    `;
    await sql`
      INSERT INTO ratings_history (event_id, rating, reason, note)
      VALUES (${eventId}, 'cleared', ${reason}, ${note})
    `;
  } else {
    await sql`
      UPDATE events
      SET feedback = ${rating},
          feedback_at = NOW(),
          feedback_reason = ${reason},
          feedback_note = ${note}
      WHERE id = ${eventId}
    `;
    await sql`
      INSERT INTO ratings_history (event_id, rating, reason, note)
      VALUES (${eventId}, ${rating}, ${reason}, ${note})
    `;
  }

  const r = await sql`
    SELECT id, feedback, feedback_at, feedback_reason, feedback_note
    FROM events WHERE id = ${eventId}
  `;
  return NextResponse.json({ ok: true, event: r.rows[0] });
}
