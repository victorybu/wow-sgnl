import { anthropic } from './anthropic';

export async function scoreRelevance(args: {
  content: string;
  source: string;
  clientName: string;
  priorityTopics: string;
  author?: string | null;
  hoursOld?: number | null;
}): Promise<{ score: number; reason: string }> {
  const sys = `You score the relevance of news/social events for a digital strategy team running rapid response for a political principal.

Output JSON only: {"score": <0-10 integer>, "reason": "<one sentence under 25 words>"}

PHILOSOPHY: Be ruthless. Most posts are noise. The principal can only act on a few things per week. Your job is to find genuine opportunities, not generate a list. When in doubt, score lower.

RUBRIC (target distribution: 9–10 <1%, 7–8 ~5%, 5–6 ~15%, 0–4 ~80%):

9–10: Drop-everything moment. Once-a-month event for this principal. The event is so on-target and time-sensitive that not responding within hours would be malpractice. Direct attack on the principal, breaking news on a signature issue, a named opponent caught dead-to-rights on a priority topic.

7–8: Worth drafting against today. Should happen 2–5x per week max. A live conversation the principal can credibly insert into with a sharp angle, on or adjacent to a priority topic, with cultural momentum.

5–6: On-topic but not urgent. Reference material. Useful background, not actionable now.

3–4: Tangentially relevant. Connects to principal's world but no clear angle.

0–2: Not for this principal. Skip entirely.

ANTI-CRITERIA — apply these penalties to your initial read:
- Generic political content (rage tweets, dunks-without-substance, vague "we must" calls): −2
- Stale takes / news older than 24h: −2
- Low-credibility messenger (fringe accounts, anonymous, persons with no relevant standing on the topic): −1
- Off-topic from principal's named priority topics: −2

REWARD CRITERIA:
- Direct hit on a named priority topic: +2
- Breaking news within last 4 hours: +1
- Principal personally referenced or implicated: +2
- Named opposition figure caught in a moment that fits principal's framing: +1

Score the FINAL number after applying penalties and rewards. Cap at 0–10. Be honest about the math — a generic political tweet from a low-credibility account on an off-topic subject is a 0, not a 3.

REASON FIELD: One sentence, under 25 words, naming the SPECIFIC priority-topic match (or lack thereof) and the time-sensitivity. Do not be generic.`;

  const ageLine =
    typeof args.hoursOld === 'number' && Number.isFinite(args.hoursOld)
      ? `Hours since posted: ${args.hoursOld.toFixed(1)}`
      : `Hours since posted: unknown`;

  const authorLine = args.author ? `Author: @${args.author}` : 'Author: unknown';

  const user = `Principal: ${args.clientName}
Priority topics for this principal: ${args.priorityTopics || '(none specified)'}

Source: ${args.source}
${authorLine}
${ageLine}
Content: ${args.content}

Score this event using the rubric above. Apply anti-criteria and reward criteria explicitly.`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 250,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return {
      score: Math.max(0, Math.min(10, Number(parsed.score) || 0)),
      reason: String(parsed.reason || '').slice(0, 240),
    };
  } catch {
    return { score: 0, reason: 'parse_error' };
  }
}
