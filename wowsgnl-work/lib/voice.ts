import { sql } from './db';

export type VoiceExample = {
  content: string;
  context: string | null;
  angle: string | null;
  weight: number;
};

export type AntiVoiceExample = {
  content: string;
  context: string | null;
  angle: string | null;
  reason: string | null;
  note: string | null;
  source: string;
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
 * shipped-post examples (the "loop"), and — when present — an
 * anti-voice section listing recently-rejected angles/posts so the
 * model avoids that tone. Returns a single string ready to splice
 * into the user message.
 */
export function composeVoiceBlock(
  voiceProfile: string,
  examples: VoiceExample[],
  antiExamples: AntiVoiceExample[] = [],
): string {
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
  if (antiExamples.length > 0) {
    const lines: string[] = [];
    lines.push(`Do NOT sound like these — these were generated and rejected:`);
    for (const ex of antiExamples) {
      const why = [ex.reason, ex.note].filter(Boolean).join(' — ');
      const trail = why ? ` (rejected: ${why})` : ` (rejected)`;
      lines.push(`- "${ex.content.slice(0, 240).replace(/\n/g, ' ')}"${trail}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Pull the most recent active anti-voice examples (weight = -1) for
 * a client. These are angles/posts the user explicitly rated as
 * noise; we surface them in the prompt so the model doesn't repeat
 * the same misses.
 */
export async function getActiveAntiVoiceExamples(
  clientId: number,
  limit = 5,
): Promise<AntiVoiceExample[]> {
  const r = await sql`
    SELECT content, context, angle, notes, source
    FROM voice_examples
    WHERE client_id = ${clientId} AND weight = -1
    ORDER BY added_at DESC
    LIMIT ${limit}
  `;
  return r.rows.map((row: any) => {
    // notes column is "reason||note" packed when added by /api/feedback;
    // unpack here so we can format them separately in the prompt.
    let reason: string | null = null;
    let note: string | null = null;
    const raw = (row.notes ?? '') as string;
    const idx = raw.indexOf('||');
    if (idx >= 0) {
      reason = raw.slice(0, idx) || null;
      note = raw.slice(idx + 2) || null;
    } else if (raw) {
      reason = raw;
    }
    return {
      content: row.content,
      context: row.context,
      angle: row.angle,
      reason,
      note,
      source: row.source,
    };
  });
}

/**
 * Insert (or reactivate) an anti-voice example for a rejected draft
 * angle. Idempotent on source_draft_id (UNIQUE INDEX).
 */
export async function addRejectedDraftExample(opts: {
  clientId: number;
  draftId: number;
  eventId: number | null;
  angle: string;
  eventContent: string | null;
  reason: string | null;
  note: string | null;
}): Promise<void> {
  const packedNotes = `${opts.reason ?? ''}||${opts.note ?? ''}`;
  await sql`
    INSERT INTO voice_examples
      (client_id, source, source_draft_id, source_event_id,
       content, context, angle, weight, notes)
    VALUES
      (${opts.clientId}, 'rejected_angle', ${opts.draftId}, ${opts.eventId},
       ${opts.angle}, ${opts.eventContent}, ${opts.angle}, -1, ${packedNotes})
    ON CONFLICT (source_draft_id) DO UPDATE SET
       source = EXCLUDED.source,
       content = EXCLUDED.content,
       context = EXCLUDED.context,
       angle = EXCLUDED.angle,
       notes = EXCLUDED.notes,
       weight = -1,
       added_at = NOW()
  `;
}

/**
 * Insert (or reactivate) an anti-voice example for a rejected post
 * variant. Idempotent on source_post_id (UNIQUE INDEX from voice
 * fine-tuning loop). When a previously-shipped post gets rejected,
 * the existing weight=1 row flips to weight=-1 and source flips to
 * 'rejected_post' so the row's label matches its current state.
 */
export async function addRejectedPostExample(opts: {
  clientId: number;
  postId: number;
  eventId: number | null;
  content: string;
  angle: string | null;
  eventContent: string | null;
  reason: string | null;
  note: string | null;
}): Promise<void> {
  const packedNotes = `${opts.reason ?? ''}||${opts.note ?? ''}`;
  await sql`
    INSERT INTO voice_examples
      (client_id, source, source_post_id, source_event_id,
       content, context, angle, weight, notes)
    VALUES
      (${opts.clientId}, 'rejected_post', ${opts.postId}, ${opts.eventId},
       ${opts.content}, ${opts.eventContent}, ${opts.angle}, -1, ${packedNotes})
    ON CONFLICT (source_post_id) DO UPDATE SET
       source = EXCLUDED.source,
       content = EXCLUDED.content,
       context = EXCLUDED.context,
       angle = EXCLUDED.angle,
       notes = EXCLUDED.notes,
       weight = -1,
       added_at = NOW()
  `;
}

/**
 * Deactivate an anti-voice row when the user un-rates or flips a
 * rating to signal. We zero the weight rather than deleting so the
 * audit trail (and the original shipped-post weight, if any) is
 * preserved — but the row no longer feeds into prompts.
 */
export async function unrejectDraftExample(draftId: number): Promise<void> {
  await sql`UPDATE voice_examples SET weight = 0 WHERE source_draft_id = ${draftId} AND weight = -1`;
}

export async function unrejectPostExample(postId: number): Promise<void> {
  await sql`UPDATE voice_examples SET weight = 0 WHERE source_post_id = ${postId} AND weight = -1`;
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
