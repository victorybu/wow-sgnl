import { sql } from './db';

export type VoiceExample = {
  content: string;
  context: string | null;
  angle: string | null;
  weight: number;
};

/**
 * Fetch the top N active voice examples (weight > 0) for a client,
 * ordered by weight DESC then most recent. These are the curated
 * shipped posts (and any manually-added examples) that shape future
 * generations.
 */
export async function getActiveVoiceExamples(clientId: number, limit = 10): Promise<VoiceExample[]> {
  const r = await sql`
    SELECT content, context, angle, weight
    FROM voice_examples
    WHERE client_id = ${clientId} AND weight > 0
    ORDER BY weight DESC, added_at DESC
    LIMIT ${limit}
  `;
  return r.rows as VoiceExample[];
}

/**
 * Compose the voice block that gets injected into Anthropic prompts.
 * Combines the hand-tuned voice_profile (the "core") with the curated
 * shipped-post examples (the "loop"). Returns a single string ready to
 * splice into the user message.
 */
export function composeVoiceBlock(voiceProfile: string, examples: VoiceExample[]): string {
  const parts: string[] = [];
  if (voiceProfile && voiceProfile.trim()) {
    parts.push(`Core voice profile (hand-tuned):\n${voiceProfile.trim()}`);
  }
  if (examples.length > 0) {
    const lines: string[] = [];
    lines.push(`Recently shipped posts in this voice (curated examples — match this cadence/vocabulary):`);
    for (const ex of examples) {
      const ctx = ex.context ? ` [in response to: "${ex.context.slice(0, 120).replace(/\n/g, ' ')}"]` : '';
      const ang = ex.angle ? ` [angle: "${ex.angle.slice(0, 120).replace(/\n/g, ' ')}"]` : '';
      lines.push(`---${ctx}${ang}\n${ex.content}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Insert a voice example from a shipped post. Idempotent on
 * source_post_id (UNIQUE INDEX). If the post was edited (content !=
 * original_content), records both for diff-as-signal use later.
 */
export async function addShippedPostExample(opts: {
  clientId: number;
  postId: number;
  eventId: number;
  finalContent: string;
  originalDraft: string | null;
  context: string | null;
  angle: string | null;
}): Promise<void> {
  const wasEdited = !!(
    opts.originalDraft && opts.originalDraft.trim() !== opts.finalContent.trim()
  );
  await sql`
    INSERT INTO voice_examples
      (client_id, source, source_post_id, source_event_id,
       content, context, angle, original_draft, was_edited, weight)
    VALUES
      (${opts.clientId}, 'shipped_post', ${opts.postId}, ${opts.eventId},
       ${opts.finalContent}, ${opts.context}, ${opts.angle}, ${opts.originalDraft}, ${wasEdited}, 1)
    ON CONFLICT (source_post_id) DO UPDATE SET
       content = EXCLUDED.content,
       was_edited = EXCLUDED.was_edited,
       original_draft = COALESCE(voice_examples.original_draft, EXCLUDED.original_draft),
       weight = CASE WHEN voice_examples.weight = 0 THEN 1 ELSE voice_examples.weight END
  `;
}

/**
 * Remove (or zero-weight) the example that came from a specific post —
 * called when a post is unshipped. We keep the row but set weight=0 so
 * the audit trail stays.
 */
export async function unshipPostExample(postId: number): Promise<void> {
  await sql`UPDATE voice_examples SET weight = 0 WHERE source_post_id = ${postId}`;
}
