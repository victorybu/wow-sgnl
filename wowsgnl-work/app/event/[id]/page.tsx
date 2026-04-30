import { sql } from '@/lib/db';
import { generateAngles, generatePosts } from '@/lib/drafts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import RatingForm from '@/app/_components/RatingForm';
import PostCard from '@/app/_components/PostCard';

export const dynamic = 'force-dynamic';

function isAnthropicBillingError(e: any): boolean {
  const msg = (e?.message || '').toString();
  return msg.includes('credit balance') || msg.includes('Plans & Billing');
}

async function genAngles(eventId: number) {
  'use server';
  try {
    const e = await sql`
      SELECT e.*, c.name as client_name, c.voice_profile
      FROM events e JOIN clients c ON c.id = e.client_id
      WHERE e.id = ${eventId}
    `;
    const ev = e.rows[0];
    const angles = await generateAngles({
      event: ev.content,
      clientName: ev.client_name,
      voiceProfile: ev.voice_profile || '',
    });
    for (const a of angles) {
      await sql`INSERT INTO drafts (event_id, angle, platform) VALUES (${eventId}, ${a}, 'x')`;
    }
    await sql`UPDATE events SET status = 'drafted' WHERE id = ${eventId}`;
    revalidatePath(`/event/${eventId}`);
  } catch (e: any) {
    if (isAnthropicBillingError(e)) redirect(`/event/${eventId}?err=billing`);
    throw e;
  }
}

async function genPosts(draftId: number) {
  'use server';
  let evId: number | null = null;
  try {
    const d = await sql`
      SELECT d.*, e.id AS event_id, e.content as event_content, c.name as client_name, c.voice_profile
      FROM drafts d JOIN events e ON e.id = d.event_id JOIN clients c ON c.id = e.client_id
      WHERE d.id = ${draftId}
    `;
    const dr = d.rows[0];
    evId = dr.event_id;
    const variants = await generatePosts({
      event: dr.event_content,
      angle: dr.angle,
      clientName: dr.client_name,
      voiceProfile: dr.voice_profile || '',
      platform: 'x',
    });
    for (let i = 0; i < variants.length; i++) {
      await sql`
        INSERT INTO posts (draft_id, position, content, platform)
        VALUES (${draftId}, ${i}, ${variants[i]}, 'x')
      `;
    }
    revalidatePath(`/event/${dr.event_id}`);
  } catch (e: any) {
    if (isAnthropicBillingError(e) && evId) redirect(`/event/${evId}?err=billing`);
    throw e;
  }
}

async function deleteDraft(draftId: number, eventId: number) {
  'use server';
  await sql`DELETE FROM drafts WHERE id = ${draftId}`;
  // If no drafts remain, revert event status
  const r = await sql`SELECT COUNT(*)::int AS n FROM drafts WHERE event_id = ${eventId}`;
  if (r.rows[0].n === 0) {
    await sql`UPDATE events SET status = 'new' WHERE id = ${eventId} AND status IN ('drafted','shipped')`;
  }
  revalidatePath(`/event/${eventId}`);
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { err?: string };
}) {
  const eventId = parseInt(params.id);
  const e = await sql`
    SELECT e.id, e.author, e.content, e.url, e.posted_at, e.relevance_score,
           e.relevance_reason, e.status,
           e.feedback, e.feedback_at, e.feedback_reason, e.feedback_note,
           c.name as client_name
    FROM events e JOIN clients c ON c.id = e.client_id
    WHERE e.id = ${eventId}
  `;
  const ev = e.rows[0];
  if (!ev) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <Link href="/" className="text-xs underline opacity-60">← back</Link>
        <p className="opacity-60 mt-6">Event {eventId} not found.</p>
      </main>
    );
  }

  const draftsRes = await sql`
    SELECT d.id, d.angle, d.shipped, d.shipped_at,
           d.feedback, d.feedback_at, d.feedback_reason, d.feedback_note,
           d.created_at
    FROM drafts d
    WHERE d.event_id = ${eventId}
    ORDER BY d.id ASC
  `;
  const drafts = draftsRes.rows;

  let postsByDraft: Record<number, any[]> = {};
  if (drafts.length > 0) {
    const ids = drafts.map((d: any) => d.id);
    const postsRes = await sql`
      SELECT id, draft_id, position, content, platform, shipped, shipped_at,
             feedback, feedback_at, feedback_reason, feedback_note
      FROM posts
      WHERE draft_id = ANY(${ids})
      ORDER BY draft_id, position NULLS LAST, id
    `;
    for (const p of postsRes.rows) {
      (postsByDraft[p.draft_id] = postsByDraft[p.draft_id] || []).push(p);
    }
  }

  const scoreClass = (s: number | null) =>
    s === null
      ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
      : s >= 7
        ? 'bg-green-500/20 text-green-300 border-green-500/40'
        : s >= 5
          ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40'
          : 'bg-neutral-800 text-neutral-500 border-neutral-700';

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4 text-xs">
        <Link href="/" className="underline opacity-60">← back to feed</Link>
        <div className="space-x-3 opacity-60">
          <Link href="/drafts" className="underline">All drafts</Link>
          <Link href="/ratings" className="underline">Ratings</Link>
        </div>
      </div>

      {searchParams.err === 'billing' && (
        <div className="mb-4 border border-yellow-500/40 bg-yellow-500/10 rounded-lg p-4 text-sm">
          <p className="font-medium mb-1">Drafting is offline.</p>
          <p className="opacity-80">
            Anthropic API rejected with "credit balance too low" — billing isn't propagating.
            Rating still works.
          </p>
        </div>
      )}

      <article className="border border-neutral-800 rounded-lg p-4 mb-6">
        <header className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded border ${scoreClass(ev.relevance_score)}`}>
            {ev.relevance_score === null ? 'pending' : `${ev.relevance_score}/10`}
          </span>
          {ev.author && (
            <a
              href={`https://x.com/${ev.author}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:underline"
            >
              @{ev.author}
            </a>
          )}
          <span className="text-xs opacity-40">·</span>
          <span className="text-xs opacity-50">{ev.client_name}</span>
        </header>
        <p className="text-sm whitespace-pre-wrap mb-3 leading-relaxed">{ev.content}</p>
        {ev.relevance_reason && (
          <p className="text-xs opacity-60 italic mb-3">{ev.relevance_reason}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {ev.url && (
            <a
              href={ev.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Open on X ↗
            </a>
          )}
        </div>
        <div className="border-t border-neutral-800 pt-3">
          <RatingForm
            kind="event"
            targetId={ev.id}
            current={{
              feedback: ev.feedback,
              feedback_reason: ev.feedback_reason,
              feedback_note: ev.feedback_note,
            }}
          />
        </div>
      </article>

      {drafts.length === 0 && (
        <div className="space-y-3">
          <form action={async () => { 'use server'; await genAngles(eventId); }}>
            <button
              type="submit"
              className="bg-white text-black px-4 py-2 rounded text-sm font-bold"
            >
              Generate angles
            </button>
          </form>
          <p className="text-xs opacity-50">
            Anthropic generates 3 strategic angles. You can then generate 3 post variants per angle.
            Both angles and post variants are individually rateable.
          </p>
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <h2 className="text-sm font-bold uppercase opacity-60 mb-3">
            Angles ({drafts.length})
          </h2>
          <div className="space-y-4">
            {drafts.map((d: any) => {
              const posts = postsByDraft[d.id] || [];
              return (
                <section
                  key={d.id}
                  className={`border rounded-lg p-4 ${
                    d.feedback === 'signal'
                      ? 'border-green-500/40 bg-green-500/5'
                      : d.feedback === 'noise'
                        ? 'border-red-500/30 bg-red-500/5 opacity-80'
                        : 'border-neutral-800'
                  }`}
                >
                  <div className="mb-3">
                    <p className="text-sm font-medium mb-2">{d.angle}</p>
                    <RatingForm
                      kind="draft"
                      targetId={d.id}
                      size="sm"
                      current={{
                        feedback: d.feedback,
                        feedback_reason: d.feedback_reason,
                        feedback_note: d.feedback_note,
                      }}
                    />
                  </div>

                  {posts.length === 0 ? (
                    <div className="flex items-center gap-2 mt-3">
                      <form action={async () => { 'use server'; await genPosts(d.id); }}>
                        <button
                          type="submit"
                          className="text-xs px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600"
                        >
                          Generate posts for this angle
                        </button>
                      </form>
                      <form action={async () => { 'use server'; await deleteDraft(d.id, eventId); }}>
                        <button
                          type="submit"
                          className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-red-500/50 hover:text-red-300"
                        >
                          Delete angle
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-3 mt-3">
                      <div className="text-xs uppercase opacity-50">Variants ({posts.length})</div>
                      {posts.map(p => (
                        <PostCard key={p.id} post={p} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <div className="mt-6 pt-4 border-t border-neutral-800">
            <form action={async () => { 'use server'; await genAngles(eventId); }}>
              <button
                type="submit"
                className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
              >
                Generate 3 more angles
              </button>
            </form>
          </div>
        </>
      )}
    </main>
  );
}
