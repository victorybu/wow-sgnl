import { anthropic } from './anthropic';

export async function scoreRelevance(args: {
  content: string;
  source: string;
  clientName: string;
  priorityTopics: string;
}): Promise<{ score: number; reason: string }> {
  const sys = `You score the relevance of news/social events for a digital strategy team running a rapid response operation.

Output JSON only: {"score": <0-10 integer>, "reason": "<one sentence under 20 words>"}

Rubric:
- 9-10: directly attacks/concerns client; immediate response window (within hours)
- 7-8: strong opportunity to insert client into a live conversation with cultural momentum
- 5-6: tangentially related, possible future angle
- 0-4: not actionable for this client right now

Be a hard grader. Most events are 0-4. Save 7+ for genuine opportunities.`;

  const user = `Client: ${args.clientName}
Priority topics: ${args.priorityTopics}

Source: ${args.source}
Content: ${args.content}

Score this event.`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return { score: Math.max(0, Math.min(10, parsed.score)), reason: parsed.reason };
  } catch {
    return { score: 0, reason: 'parse_error' };
  }
}
