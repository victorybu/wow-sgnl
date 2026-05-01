import { anthropic } from './anthropic';

export type RelevanceResult = {
  score: number;
  reason: string;
  // Intelligence-mode only: how the author seems to view the topic
  // (positive/negative/neutral/mixed) and which named topic tags
  // apply. Drafting-mode calls leave both null.
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed' | null;
  topic_tags: string[] | null;
};

export async function scoreRelevance(args: {
  content: string;
  source: string;
  clientName: string;
  priorityTopics: string;
  author?: string | null;
  hoursOld?: number | null;
  // 'drafting' (default) returns just score+reason. 'intelligence'
  // also returns sentiment + topic_tags so /briefing can group by side
  // and topic without a second model call.
  mode?: 'drafting' | 'intelligence';
}): Promise<RelevanceResult> {
  const isIntel = args.mode === 'intelligence';

  const sys = `You score the relevance of news/social events for a digital strategy team running rapid response for a political principal.

${isIntel
  ? `Output JSON only: {"score": <0-10 integer>, "reason": "<one sentence under 25 words>", "sentiment": "<positive|negative|neutral|mixed>", "topic_tags": ["<tag1>", "<tag2>", ...]}`
  : `Output JSON only: {"score": <0-10 integer>, "reason": "<one sentence under 25 words>"}`
}

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

REASON FIELD: One sentence, under 25 words, naming the SPECIFIC priority-topic match (or lack thereof) and the time-sensitivity. Do not be generic.${isIntel ? `

SENTIMENT FIELD (intelligence mode):
- "positive" — author endorses, defends, or speaks favorably about a priority topic
- "negative" — author attacks, criticizes, or speaks unfavorably about a priority topic
- "neutral" — descriptive coverage, no clear lean toward priority topics
- "mixed" — complex take with both pos/neg signal toward priority topics
- If the post doesn't substantively touch any priority topic, use "neutral".

TOPIC_TAGS FIELD (intelligence mode):
- Lowercase short tags identifying which priority topics the post touches.
- Up to 5 tags. Use specific names where possible (e.g. "polymarket", "kalshi", "prediction_markets") not generic categories.
- Empty array [] if no priority topic applies.` : ''}`;

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

Score this event using the rubric above. Apply anti-criteria and reward criteria explicitly.${isIntel ? ' Also classify sentiment toward the priority topics and emit relevant topic_tags.' : ''}`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: isIntel ? 600 : 400,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const parsed = parseScoreResponse(text);
  if (parsed) return parsed;

  // Last resort: pull the integer out of the response text. Better to
  // land a real number than to leave the row at score=0.
  const m = text.match(/"score"\s*:\s*(\d+)|score(?:\s*(?:is|of|:))?\s*[:=]?\s*(\d+)/i);
  if (m) {
    const n = parseInt(m[1] || m[2] || '0', 10);
    const reasonM = text.match(/"reason"\s*:\s*"([^"]{1,500})"/);
    return {
      score: Math.max(0, Math.min(10, n)),
      reason: reasonM
        ? reasonM[1].slice(0, 240)
        : `(parse-fallback) ${text.replace(/\s+/g, ' ').slice(0, 200)}`,
      sentiment: null,
      topic_tags: null,
    };
  }
  return { score: 0, reason: 'parse_error', sentiment: null, topic_tags: null };
}

// Try several strategies to extract the {score, reason, sentiment?,
// topic_tags?} object from a model response. The model usually returns
// clean JSON, but sometimes it wraps in prose, uses smart quotes inside
// the reason field, or truncates at max_tokens.
function parseScoreResponse(raw: string): RelevanceResult | null {
  if (!raw) return null;
  const stripped = raw.replace(/```(?:json)?/g, '').trim();

  const candidates: string[] = [];
  candidates.push(stripped);
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) candidates.push(m[0]);
  const lastBrace = stripped.lastIndexOf('}');
  if (lastBrace === -1 && stripped.includes('{')) {
    candidates.push(stripped + '}');
  }

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      const score = Number(parsed.score);
      if (Number.isFinite(score)) {
        return {
          score: Math.max(0, Math.min(10, score)),
          reason: String(parsed.reason || '').slice(0, 240),
          sentiment: normalizeSentiment(parsed.sentiment),
          topic_tags: normalizeTags(parsed.topic_tags),
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function normalizeSentiment(s: any): RelevanceResult['sentiment'] {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  if (v === 'positive' || v === 'negative' || v === 'neutral' || v === 'mixed') return v;
  return null;
}

function normalizeTags(t: any): string[] | null {
  if (!Array.isArray(t)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of t) {
    if (typeof x !== 'string') continue;
    const norm = x.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 40);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 8) break;
  }
  return out.length > 0 ? out : null;
}
