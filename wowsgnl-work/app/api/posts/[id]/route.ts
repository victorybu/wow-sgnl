import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';
import { addShippedPostExample, unshipPostExample } from '@/lib/voice';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }
  let body: { content?: string; shipped?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body.content === 'string') {
    const content = body.content.slice(0, 4000);
    await sql`UPDATE posts SET content = ${content} WHERE id = ${id}`;
  }

  if (typeof body.shipped === 'boolean') {
    if (body.shipped) {
      await sql`UPDATE posts SET shipped = TRUE, shipped_at = NOW() WHERE id = ${id}`;
      // Cascade: mark parent draft + event as shipped, AND capture voice example.
      const r = await sql`
        SELECT p.id AS post_id, p.content, p.original_content,
               d.id AS draft_id, d.angle, d.event_id,
               e.content AS event_content, e.client_id
        FROM posts p
        JOIN drafts d ON d.id = p.draft_id
        JOIN events e ON e.id = d.event_id
        WHERE p.id = ${id}
      `;
      const meta = r.rows[0];
      if (meta) {
        await sql`UPDATE drafts SET shipped = TRUE, shipped_at = NOW() WHERE id = ${meta.draft_id}`;
        await sql`UPDATE events SET status = 'shipped' WHERE id = ${meta.event_id}`;
        // Voice loop: shipped post becomes a curated voice example.
        await addShippedPostExample({
          clientId: meta.client_id,
          postId: meta.post_id,
          eventId: meta.event_id,
          finalContent: meta.content,
          originalDraft: meta.original_content,
          context: meta.event_content,
          angle: meta.angle,
        });
      }
    } else {
      await sql`UPDATE posts SET shipped = FALSE, shipped_at = NULL WHERE id = ${id}`;
      // Voice loop: unshipping zero-weights the example (keeps row for audit).
      await unshipPostExample(id);
      const r = await sql`
        SELECT d.id AS draft_id, d.event_id,
               (SELECT COUNT(*)::int FROM posts p2
                  JOIN drafts d2 ON d2.id = p2.draft_id
                  WHERE d2.event_id = d.event_id AND p2.shipped = TRUE) AS shipped_post_count
        FROM posts p JOIN drafts d ON d.id = p.draft_id
        WHERE p.id = ${id}
      `;
      const meta = r.rows[0];
      if (meta) {
        if (meta.shipped_post_count === 0) {
          await sql`UPDATE events SET status = 'drafted' WHERE id = ${meta.event_id} AND status = 'shipped'`;
          await sql`
            UPDATE drafts SET shipped = FALSE, shipped_at = NULL
            WHERE id = ${meta.draft_id}
              AND NOT EXISTS (SELECT 1 FROM posts WHERE draft_id = ${meta.draft_id} AND shipped = TRUE)
          `;
        }
      }
    }
  }

  const r = await sql`SELECT id, content, shipped, shipped_at, feedback FROM posts WHERE id = ${id}`;
  return NextResponse.json({ ok: true, post: r.rows[0] });
}
