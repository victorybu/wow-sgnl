import { anthropic } from '@/lib/anthropic';

// Polymarket score + dedup pass. Sonnet 4.6 (separate from the
// existing Signal scorer, which keeps running for non-intel clients).
//
// Scope: takes a batch of raw signals from the events table (Twitter,
// Federal Register, FEC, SerpAPI, Congress) for client_id=4 and
// returns per-signal classification with a dedup cluster key. The
// pm-analyze route then groups by cluster_key and creates one
// pm_intel_items row per cluster.
//
// Categories map to the dashboard sections:
//   - todays_read   — Caleb-attention-worthy today, narrative summary
//   - kalshi        — about Kalshi (any move: hire, lobbying, ad, exec
//                     speech, regulatory filing, partnership)
//   - hill          — Congress: bills, hearings, floor statements
//   - chatter       — staffer / operator / influencer sentiment
//   - event         — panel / sponsorship / reception / podcast slot

export type ScoredSignal = {
  signal_id: number;
  valence: number;          // -2 to +2
  relevance: number;        // 0-100, vs Polymarket's Democratic-staffer-sentiment goal
  reach: number;            // 0-100, audience scale
  category: 'todays_read' | 'kalshi' | 'hill' | 'chatter' | 'event';
  topic_tags: string[];
  dedup_cluster_key: string;
  should_promote: boolean;
  headline: string;         // ≤80 chars, used by analyze to seed pm_intel_items
  summary: string;          // 1-2 sentences
};

export type ScoreInputSignal = {
  id: number;
  source: string;
  author: string | null;
  content: string;
  url: string | null;
  posted_at: string | null;
};

const SYS = `You score raw signals for the Polymarket retainer (a $15K/month engagement focused on improving Polymarket's standing with Democratic staffers, operators, and progressive influencers in DC).

You have two parallel jobs:
1. SENTIMENT TRACKING — surface what Democrats and the broader online conversation are saying about Polymarket and prediction markets.
2. KALSHI OPP RESEARCH — track Kalshi (Polymarket's competitor) like an opposition research target. Every hire, lobbying move, regulatory filing, ad campaign, donation, partnership, and exec speech is potentially relevant.

For each input signal, output JSON with these fields:

- valence: integer -2 to +2. Positive = good for Polymarket's standing OR negative for Kalshi. Negative = the opposite. 0 = neutral / informational.
- relevance: 0-100. How directly does this advance the staffer-sentiment goal or expose a Kalshi move worth knowing?
- reach: 0-100. Author audience size + amplification potential. A Senator's tweet = high reach; a no-name account's reply = low.
- category: one of "todays_read" | "kalshi" | "hill" | "chatter" | "event"
  * todays_read — only for the 1-3 highest-relevance items per batch that are worth Caleb's attention TODAY (drop-everything tier or sharp turn in the conversation). Most items are NOT todays_read.
  * kalshi — any signal about Kalshi the company, its execs, lobbyists, ads, partnerships, regulatory filings.
  * hill — Congress-related: bills, hearings, floor statements, member tweets on prediction-market regulation.
  * chatter — staffer, operator, influencer commentary on prediction markets / Polymarket / event contracts in general.
  * event — panel/sponsorship/podcast/reception sightings worth tracking on Events Radar.
- topic_tags: array of up to 5 lowercase snake_case tags. Use specific named entities (kalshi, polymarket, cftc, sres_708, stephanie_cutter) over generic categories.
- dedup_cluster_key: short stable identifier for the underlying news beat. Multiple signals about THE SAME event share THE SAME key. Examples:
  * "senate_ban_sres_708" — for any tweet/article/bill about the Senate resolution banning members from prediction markets
  * "kalshi_cutter_hire" — for any signal about Stephanie Cutter joining Kalshi
  * "polymarket_april_volume_record" — for any signal about Polymarket's April trading volume hitting $150B
  Don't be cute — same beat, same key. If a signal doesn't cluster with anything else, give it a unique key.
- should_promote: boolean. true = worth showing on the dashboard. false = noise / off-topic / low-signal.
  PROMOTE-WORTHY heuristics:
  * Any signal directly mentioning Polymarket, Kalshi, prediction markets, event contracts, election betting, CFTC regulation of prediction markets, or named PM/Kalshi execs → DEFAULT TO TRUE.
  * Any signal from sources serpapi / fed_register / fec / congress (these are already keyword-pre-filtered for relevance) → STRONG DEFAULT TO TRUE unless completely off-topic.
  * Hill staffer / influencer chatter on these topics → TRUE.
  NOT-PROMOTE: generic political tweets from watchlist accounts that don't touch any priority topic, content-free posts (links only, single emoji), spam / scam crypto posts.
  Better to over-promote curated-source items than to under-promote — Caleb can mark noise on the dashboard, but he can't see what was rejected.
- headline: ≤80 chars, factual, no spin. Used as the dashboard card title.
- summary: 1-2 sentences. State what happened and why it matters. No em dashes. Operator voice.

Output JSON only:
{"items": [{"signal_id": 123, "valence": 1, "relevance": 75, "reach": 60, "category": "kalshi", "topic_tags": ["kalshi", "stephanie_cutter", "precision_strategies"], "dedup_cluster_key": "kalshi_cutter_hire", "should_promote": true, "headline": "Kalshi adds Cutter via Precision Strategies", "summary": "Stephanie Cutter joining Kalshi as advisor through Precision Strategies. Third Obama-world Democrat hire in six months — establishment-Dem lockdown."}, ...]}

Rules:
- Every input signal must appear in the output exactly once. No omissions, no duplicates.
- Don't fabricate facts. If the signal is content-free or you can't tell what it's about, set should_promote=false and use a generic dedup_cluster_key like "uncategorized_<id>".
- "todays_read" is rare — most batches will have 0-1 todays_read items. Reserve it for genuinely actionable moves.
- No em dashes anywhere in headline or summary.`;

function buildUser(signals: ScoreInputSignal[]): string {
  const lines = signals.map(s => {
    const author = s.author ? `@${s.author}` : 'unknown';
    const when = s.posted_at ? ` (${s.posted_at})` : '';
    const url = s.url ? `\n  url: ${s.url}` : '';
    const content = (s.content || '').replace(/\n+/g, ' ').slice(0, 600);
    return `[${s.id}] source=${s.source} ${author}${when}${url}\n  content: ${content}`;
  });
  return `Polymarket retainer scoring batch — ${signals.length} signals:\n\n${lines.join('\n\n')}`;
}

function safeJsonExtract(text: string): any | null {
  if (!text) return null;
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  // Try direct parse
  try { return JSON.parse(stripped); } catch {}
  // Try first {...} block
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  // Try auto-close
  if (!stripped.includes('}') && stripped.includes('{')) {
    try { return JSON.parse(stripped + '}'); } catch {}
  }
  return null;
}

function clamp(n: any, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function normalizeCategory(c: any): ScoredSignal['category'] {
  const v = String(c || '').trim().toLowerCase();
  if (v === 'todays_read' || v === 'kalshi' || v === 'hill' || v === 'chatter' || v === 'event') return v as any;
  return 'chatter';
}

function normalizeTags(t: any): string[] {
  if (!Array.isArray(t)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of t) {
    if (typeof x !== 'string') continue;
    const norm = x.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 5) break;
  }
  return out;
}

export async function scorePolymarketBatch(signals: ScoreInputSignal[]): Promise<ScoredSignal[]> {
  if (signals.length === 0) return [];
  // ~250 tokens per scored item (10 fields + headline/summary). At
  // BATCH_SIZE=20 in pm-analyze that's ~5000; budget 8000 for headroom
  // so the JSON never truncates and the backfill (which marks all
  // dropped signals as not-promotable) doesn't fire on the happy path.
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: SYS,
    messages: [{ role: 'user', content: buildUser(signals) }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const parsed = safeJsonExtract(text);
  const rawItems: any[] = parsed?.items || [];

  const out: ScoredSignal[] = [];
  const seen = new Set<number>();
  for (const r of rawItems) {
    const id = Number(r.signal_id);
    if (!Number.isInteger(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      signal_id: id,
      valence: clamp(r.valence, -2, 2),
      relevance: clamp(r.relevance, 0, 100),
      reach: clamp(r.reach, 0, 100),
      category: normalizeCategory(r.category),
      topic_tags: normalizeTags(r.topic_tags),
      dedup_cluster_key: String(r.dedup_cluster_key || `uncategorized_${id}`).trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80) || `uncategorized_${id}`,
      should_promote: !!r.should_promote,
      headline: String(r.headline || '').slice(0, 200) || `signal ${id}`,
      summary: String(r.summary || '').slice(0, 600),
    });
  }
  // Backfill any signal the model dropped — mark as not promotable so
  // we don't lose track of unprocessed events but they don't pollute
  // the dashboard.
  for (const s of signals) {
    if (seen.has(s.id)) continue;
    out.push({
      signal_id: s.id,
      valence: 0,
      relevance: 0,
      reach: 0,
      category: 'chatter',
      topic_tags: [],
      dedup_cluster_key: `unprocessed_${s.id}`,
      should_promote: false,
      headline: (s.content || '').slice(0, 80) || `signal ${s.id}`,
      summary: '(score returned no data for this signal)',
    });
  }
  return out;
}
