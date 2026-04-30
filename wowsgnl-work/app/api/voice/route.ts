import { sql } from '@/lib/db';
import { composeVoiceBlock, getActiveVoiceExamples } from '@/lib/voice';
import { getCurrentClient } from '@/lib/clients';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// GET /api/voice?client_id=N — returns the client's voice profile,
// all examples, stats, and the live prompt preview. If client_id
// not specified, defaults to current cookie client.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let clientId = Number(searchParams.get('client_id'));
  if (!Number.isInteger(clientId) || clientId <= 0) {
    const cur = await getCurrentClient();
    if (!cur) return NextResponse.json({ ok: false, error: 'no clients' }, { status: 404 });
    clientId = cur.id;
  }

  const clientRes = await sql`
    SELECT id, name, mode, voice_profile, priority_topics
    FROM clients WHERE id = ${clientId}
  `;
  if (clientRes.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'client not found' }, { status: 404 });
  }
  const client = clientRes.rows[0];

  const examplesRes = await sql`
    SELECT id, source, source_post_id, source_event_id,
           content, context, angle, original_draft, was_edited,
           weight, notes, added_at
    FROM voice_examples
    WHERE client_id = ${clientId}
    ORDER BY weight DESC, added_at DESC
  `;

  const stats = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE weight > 0)::int AS active,
      COUNT(*) FILTER (WHERE weight = 0)::int AS excluded,
      COUNT(*) FILTER (WHERE weight > 1)::int AS boosted,
      COUNT(*) FILTER (WHERE source = 'shipped_post')::int AS from_shipped,
      COUNT(*) FILTER (WHERE source = 'manual')::int AS from_manual,
      COUNT(*) FILTER (WHERE was_edited = TRUE)::int AS edited
    FROM voice_examples WHERE client_id = ${clientId}
  `;

  // Build the live prompt preview (what the next gen call will see)
  const activeExamples = await getActiveVoiceExamples(clientId, 8);
  const promptPreview = composeVoiceBlock(client.voice_profile || '', activeExamples);

  return NextResponse.json({
    ts: new Date().toISOString(),
    client,
    examples: examplesRes.rows,
    stats: stats.rows[0],
    active_in_prompt: activeExamples.length,
    prompt_preview: promptPreview,
  });
}

// POST /api/voice — add manual example
// body: { client_id, content, context?, angle?, notes? }
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  const clientId = Number(body.client_id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });
  }
  const content = (body.content || '').toString().trim();
  if (!content) {
    return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
  }

  const r = await sql`
    INSERT INTO voice_examples
      (client_id, source, content, context, angle, notes, weight)
    VALUES
      (${clientId}, 'manual', ${content},
       ${body.context || null}, ${body.angle || null}, ${body.notes || null}, 1)
    RETURNING id
  `;

  return NextResponse.json({ ok: true, id: r.rows[0].id });
}
