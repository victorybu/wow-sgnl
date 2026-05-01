import { sql } from '@/lib/db';
import {
  addRejectedDraftExample,
  addRejectedPostExample,
  unrejectDraftExample,
  unrejectPostExample,
} from '@/lib/voice';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Kind = 'event' | 'draft' | 'post';

type Body = {
  // legacy: event_id only
  event_id?: number;
  // new: kind + target_id (kind defaults to 'event' when only event_id supplied)
  kind?: Kind;
  target_id?: number;
  rating?: 'signal' | 'noise' | null;
  reason?: string | null;
  note?: string | null;
};

const TABLES: Record<Kind, string> = {
  event: 'events',
  draft: 'drafts',
  post: 'posts',
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const kind: Kind = body.kind ?? 'event';
  if (!(kind === 'event' || kind === 'draft' || kind === 'post')) {
    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 });
  }
  const targetId = Number(body.target_id ?? body.event_id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: 'target_id required' }, { status: 400 });
  }

  const rating = body.rating === 'signal' || body.rating === 'noise' ? body.rating : null;
  const reason = (body.reason ?? '').toString().slice(0, 200) || null;
  const note = (body.note ?? '').toString().slice(0, 280) || null;

  if (rating === null) {
    if (kind === 'event') {
      await sql`UPDATE events SET feedback=NULL, feedback_at=NULL, feedback_reason=NULL, feedback_note=NULL WHERE id = ${targetId}`;
    } else if (kind === 'draft') {
      await sql`UPDATE drafts SET feedback=NULL, feedback_at=NULL, feedback_reason=NULL, feedback_note=NULL WHERE id = ${targetId}`;
      await unrejectDraftExample(targetId);
    } else if (kind === 'post') {
      await sql`UPDATE posts SET feedback=NULL, feedback_at=NULL, feedback_reason=NULL, feedback_note=NULL WHERE id = ${targetId}`;
      await unrejectPostExample(targetId);
    }
    await sql`
      INSERT INTO ratings_history (kind, target_id, event_id, rating, reason, note)
      VALUES (${kind}, ${targetId}, ${kind === 'event' ? targetId : null}, 'cleared', ${reason}, ${note})
    `;
  } else {
    if (kind === 'event') {
      await sql`UPDATE events SET feedback=${rating}, feedback_at=NOW(), feedback_reason=${reason}, feedback_note=${note} WHERE id = ${targetId}`;
    } else if (kind === 'draft') {
      await sql`UPDATE drafts SET feedback=${rating}, feedback_at=NOW(), feedback_reason=${reason}, feedback_note=${note} WHERE id = ${targetId}`;
      if (rating === 'noise') {
        const ctx = await sql`
          SELECT d.angle, e.id AS event_id, e.client_id, e.content AS event_content
          FROM drafts d JOIN events e ON e.id = d.event_id
          WHERE d.id = ${targetId}
        `;
        const c = ctx.rows[0];
        if (c && c.client_id) {
          await addRejectedDraftExample({
            clientId: c.client_id,
            draftId: targetId,
            eventId: c.event_id,
            angle: c.angle,
            eventContent: c.event_content,
            reason,
            note,
          });
        }
      } else {
        // Flipping draft to 'signal' deactivates any prior anti-voice row.
        await unrejectDraftExample(targetId);
      }
    } else if (kind === 'post') {
      await sql`UPDATE posts SET feedback=${rating}, feedback_at=NOW(), feedback_reason=${reason}, feedback_note=${note} WHERE id = ${targetId}`;
      if (rating === 'noise') {
        const ctx = await sql`
          SELECT p.content AS post_content, d.angle, e.id AS event_id, e.client_id, e.content AS event_content
          FROM posts p
          JOIN drafts d ON d.id = p.draft_id
          JOIN events e ON e.id = d.event_id
          WHERE p.id = ${targetId}
        `;
        const c = ctx.rows[0];
        if (c && c.client_id) {
          await addRejectedPostExample({
            clientId: c.client_id,
            postId: targetId,
            eventId: c.event_id,
            content: c.post_content,
            angle: c.angle,
            eventContent: c.event_content,
            reason,
            note,
          });
        }
      } else {
        await unrejectPostExample(targetId);
      }
    }
    await sql`
      INSERT INTO ratings_history (kind, target_id, event_id, rating, reason, note)
      VALUES (${kind}, ${targetId}, ${kind === 'event' ? targetId : null}, ${rating}, ${reason}, ${note})
    `;
  }

  let row: any = null;
  if (kind === 'event') {
    const r = await sql`SELECT id, feedback, feedback_at, feedback_reason, feedback_note FROM events WHERE id = ${targetId}`;
    row = r.rows[0];
  } else if (kind === 'draft') {
    const r = await sql`SELECT id, feedback, feedback_at, feedback_reason, feedback_note FROM drafts WHERE id = ${targetId}`;
    row = r.rows[0];
  } else if (kind === 'post') {
    const r = await sql`SELECT id, feedback, feedback_at, feedback_reason, feedback_note FROM posts WHERE id = ${targetId}`;
    row = r.rows[0];
  }
  return NextResponse.json({ ok: true, kind, target_id: targetId, row });
}
