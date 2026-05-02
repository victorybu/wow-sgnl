import { anthropic } from '@/lib/anthropic';

// Today's Read generator. Opus 4.7. One narrative paragraph (3-5
// sentences) synthesizing the day's promoted intel into a coherent
// "what Caleb should know this morning, with what to do about it."
//
// Voice rules from the spec:
//  - Direct, operator, no consulting language.
//  - No em dashes.
//  - No bullet points — natural sentences only.
//  - Source links inline as markdown [label](url).
//  - Action hints inline, parens or italics. Every action hint should
//    map to relationship-building, post-drafting, event consideration,
//    or Will-flagging.

export type TodaysReadInputItem = {
  id: number;
  category: string;
  headline: string;
  summary: string | null;
  valence: number | null;
  source_links: { label: string; url: string }[] | null;
};

export type PriorityPerson = {
  name: string;
  role: string | null;
  employer: string | null;
  lane: string | null;
  posture: string | null;
  last_touched: string | null;
};

export type TodaysReadResult = {
  narrative: string;
  action_hints: string[];
  source_links: { label: string; url: string }[];
};

const SYS = `You write the daily "Today's Read" for the Polymarket retainer dashboard. Caleb opens this with coffee. It's the first thing he sees.

Your job: synthesize today's promoted intel into 3-5 natural sentences that tell him (a) what's worth his attention, (b) what to do about it.

VOICE:
- Direct, operator, no consulting language.
- No em dashes anywhere. Use periods or commas.
- No bullet points or numbered lists. Natural prose only.
- Conversational but tight. Each sentence does work.
- No throat-clearing ("There are several developments to note..."). Lead with the substance.

CONTENT:
- Pick 3-5 most consequential things from today's promoted items. Don't try to cover everything.
- Tie every item to the strategic goal: improving Polymarket's standing with Democratic staffers, operators, and progressive influencers in DC.
- Where appropriate, fold in an action hint inline: post-drafting (what angle), relationship-building (who to DM), event consideration (what to attend or avoid), Will-flagging (what to surface to the client contact).
- Action hints should sound like a colleague telling Caleb what to do, not a consultant recommending. "Worth a DM to X" not "Consider engaging stakeholder X."
- If today is genuinely quiet (few promoted items, no major moves), say so briefly and use the second sentence to surface a useful background pattern from the 7-day context.

CITATIONS:
- Inline markdown link format: [source label](url). Use the label from source_links (e.g. "Politico", "@Polymarket", "Roll Call").
- One link per claim is enough. Don't over-cite.
- If multiple sources support the same claim, link the highest-quality one and mention the cluster size: "...covered by Politico and four others."

OUTPUT JSON ONLY:
{
  "narrative": "Three to five sentences as one paragraph. With inline [source](url) links.",
  "action_hints": ["DM X about Y", "Draft post on Z angle"],
  "source_links": [{"label": "Politico", "url": "https://..."}]
}

action_hints: a flat array of 1-4 short imperative phrases extracted from your narrative for the dashboard's "what to do today" sidebar. Same hints that appear inline in narrative.
source_links: deduped list of every URL referenced in narrative.

Final check before returning: read your narrative aloud. If any sentence has an em dash, fix it. If it sounds like consulting deck prose, rewrite.`;

function fmtItems(items: TodaysReadInputItem[]): string {
  if (items.length === 0) return '(no promoted items today)';
  return items.map(it => {
    const links = (it.source_links || []).slice(0, 3).map(l => `${l.label}: ${l.url}`).join('; ');
    return `[#${it.id}] ${it.category} · valence ${it.valence ?? 0}\n  HEAD: ${it.headline}\n  SUM: ${it.summary || '(no summary)'}\n  LINKS: ${links || '(none)'}`;
  }).join('\n\n');
}

function fmtPeople(people: PriorityPerson[]): string {
  if (people.length === 0) return '(none seeded yet)';
  return people.slice(0, 10).map(p => {
    const last = p.last_touched ? ` last touched ${String(p.last_touched).slice(0, 10)}` : '';
    return `- ${p.name} (${p.role || 'role unknown'} @ ${p.employer || 'unknown'}, lane ${p.lane || 'unknown'}, posture ${p.posture || 'unknown'}${last})`;
  }).join('\n');
}

function buildUser(opts: {
  todayItems: TodaysReadInputItem[];
  weekContext: TodaysReadInputItem[];
  priorityPeople: PriorityPerson[];
  forDate: string;
}): string {
  return `Date: ${opts.forDate}

TODAY'S PROMOTED INTEL ITEMS:
${fmtItems(opts.todayItems)}

LAST 7 DAYS — TOP CONTEXT (for memory only, don't re-cite if redundant):
${fmtItems(opts.weekContext)}

CURRENT RELATIONSHIP PRIORITIES (top of mind for action hints):
${fmtPeople(opts.priorityPeople)}

Write Caleb's Today's Read for ${opts.forDate}. 3-5 sentences. Source links inline. Action hints inline. JSON only.`;
}

function safeJsonExtract(text: string): any | null {
  if (!text) return null;
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

export async function generateTodaysRead(opts: {
  todayItems: TodaysReadInputItem[];
  weekContext: TodaysReadInputItem[];
  priorityPeople: PriorityPerson[];
  forDate: string;
}): Promise<TodaysReadResult | null> {
  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2000,
    system: SYS,
    messages: [{ role: 'user', content: buildUser(opts) }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const parsed = safeJsonExtract(text);
  if (!parsed) return null;
  const narrative = String(parsed.narrative || '').trim();
  if (!narrative) return null;
  // Defensive: strip any em dashes the model still slipped in.
  const clean = narrative.replace(/—/g, ',').replace(/–/g, ',');
  const hints: string[] = Array.isArray(parsed.action_hints)
    ? parsed.action_hints.filter((h: any) => typeof h === 'string').map((h: string) => h.trim()).filter(Boolean).slice(0, 4)
    : [];
  const links: { label: string; url: string }[] = Array.isArray(parsed.source_links)
    ? parsed.source_links
        .filter((l: any) => l && typeof l.url === 'string')
        .map((l: any) => ({ label: String(l.label || l.url).slice(0, 80), url: String(l.url).slice(0, 500) }))
        .slice(0, 8)
    : [];
  return { narrative: clean, action_hints: hints, source_links: links };
}
