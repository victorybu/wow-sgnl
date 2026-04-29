import { sql } from '@vercel/postgres';
import { generateAngles, generatePosts } from '@/lib/drafts';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

async function genAngles(eventId: number) {
  'use server';
  const e = await sql`SELECT e.*, c.name as client_name, c.voice_profile FROM events e JOIN clients c ON c.id = e.client_id WHERE e.id = ${eventId}`;
  const ev = e.rows[0];
  const angles = await generateAngles({ event: ev.content, clientName: ev.client_name, voiceProfile: ev.voice_profile || '' });
  for (const a of angles) {
    await sql`INSERT INTO drafts (event_id, angle) VALUES (${eventId}, ${a})`;
  }
  await sql`UPDATE events SET status = 'drafted' WHERE id = ${eventId}`;
  revalidatePath(`/event/${eventId}`);
}

async function genPosts(draftId: number) {
  'use server';
  const d = await sql`SELECT d.*, e.content as event_content, c.name as client_name, c.voice_profile
    FROM drafts d JOIN events e ON e.id = d.event_id JOIN clients c ON c.id = e.client_id WHERE d.id = ${draftId}`;
  const dr = d.rows[0];
  const posts = await generatePosts({ event: dr.event_content, angle: dr.angle, clientName: dr.client_name, voiceProfile: dr.voice_profile || '', platform: 'x' });
  await sql`UPDATE drafts SET content = ${posts.join('\n\n---\n\n')}, platform = 'x' WHERE id = ${draftId}`;
  revalidatePath(`/event/${dr.event_id}`);
}

async function markShipped(draftId: number, eventId: number) {
  'use server';
  await sql`UPDATE drafts SET shipped = TRUE, shipped_at = NOW() WHERE id = ${draftId}`;
  await sql`UPDATE events SET status = 'shipped' WHERE id = ${eventId}`;
  revalidatePath(`/event/${eventId}`);
}

export default async function EventPage({ params }: { params: { id: string } }) {
  const eventId = parseInt(params.id);
  const e = await sql`SELECT e.*, c.name as client_name FROM events e JOIN clients c ON c.id = e.client_id WHERE e.id = ${eventId}`;
  const ev = e.rows[0];
  const drafts = await sql`SELECT * FROM drafts WHERE event_id = ${eventId} ORDER BY id`;

  return (
    <main className="max-w-3xl mx-auto p-8">
      <a href="/" className="text-xs underline opacity-60">← back</a>
      <div className="border border-neutral-800 rounded p-4 my-6">
        <div className="text-xs opacity-60 mb-2">{ev.client_name} · {ev.source} · {ev.author} · {ev.relevance_score}/10</div>
        <p>{ev.content}</p>
      </div>

      {drafts.rows.length === 0 && (
        <form action={async () => { 'use server'; await genAngles(eventId); }}>
          <button type="submit" className="bg-white text-black px-4 py-2 rounded text-sm font-bold">Generate angles</button>
        </form>
      )}

      <div className="space-y-4 mt-6">
        {drafts.rows.map((d: any) => (
          <div key={d.id} className="border border-neutral-800 rounded p-4">
            <p className="text-sm font-bold mb-2">Angle: {d.angle}</p>
            {d.content ? (
              <pre className="text-xs whitespace-pre-wrap bg-neutral-900 p-3 rounded mb-3">{d.content}</pre>
            ) : (
              <form action={async () => { 'use server'; await genPosts(d.id); }}>
                <button type="submit" className="bg-neutral-700 text-white px-3 py-1 rounded text-xs">Draft posts for this angle</button>
              </form>
            )}
            {d.content && !d.shipped && (
              <form action={async () => { 'use server'; await markShipped(d.id, eventId); }}>
                <button type="submit" className="text-xs underline">Mark shipped</button>
              </form>
            )}
            {d.shipped && <p className="text-xs text-green-400">✓ Shipped</p>}
          </div>
        ))}
      </div>
    </main>
  );
}
