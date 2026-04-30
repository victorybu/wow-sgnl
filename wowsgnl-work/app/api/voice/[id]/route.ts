import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// PATCH /api/voice/[id] — update weight or notes or content
// body: { weight?: number, notes?: string, content?: string }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  if (typeof body.weight === 'number') {
    const w = Math.max(0, Math.min(5, Math.floor(body.weight)));
    await sql`UPDATE voice_examples SET weight = ${w} WHERE id = ${id}`;
  }
  if (typeof body.notes === 'string') {
    await sql`UPDATE voice_examples SET notes = ${body.notes.slice(0, 500)} WHERE id = ${id}`;
  }
  if (typeof body.content === 'string' && body.content.trim()) {
    await sql`UPDATE voice_examples SET content = ${body.content.trim()} WHERE id = ${id}`;
  }

  const r = await sql`SELECT id, weight, notes, content FROM voice_examples WHERE id = ${id}`;
  return NextResponse.json({ ok: true, example: r.rows[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }
  await sql`DELETE FROM voice_examples WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
