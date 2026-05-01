import { sql } from './db';
import { anthropic } from './anthropic';

export type ClusterCandidate = {
  id: number;
  author: string | null;
  content: string;
  relevance_score: number | null;
};

export type Cluster = {
  cluster_topic: string;
  primary_event_id: number;
  related_event_ids: number[];
};

/**
 * Build a stable signature from a list of qualifying event ids so we
 * can detect when the cluster set has changed (and thus needs
 * re-clustering). Same set of ids → same signature, regardless of
 * order. We don't include scores in the signature because rescoring
 * isn't a meaningful change to the topic clustering.
 */
function makeSignature(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',');
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch the cached clustering for this client if (a) the signature
 * matches the current set of qualifying event ids AND (b) it's < 30
 * minutes old. Otherwise returns null and the caller should
 * re-cluster.
 */
async function getCachedClusters(clientId: number, signature: string): Promise<Cluster[] | null> {
  const r = await sql`
    SELECT signature, clusters, computed_at
    FROM top_pick_clusters
    WHERE client_id = ${clientId}
  `;
  const row = r.rows[0];
  if (!row) return null;
  if (row.signature !== signature) return null;
  const age = Date.now() - Date.parse(row.computed_at);
  if (age > CACHE_TTL_MS) return null;
  return row.clusters as Cluster[];
}

async function saveClusters(clientId: number, signature: string, clusters: Cluster[]): Promise<void> {
  await sql`
    INSERT INTO top_pick_clusters (client_id, signature, clusters, computed_at)
    VALUES (${clientId}, ${signature}, ${JSON.stringify(clusters)}::jsonb, NOW())
    ON CONFLICT (client_id) DO UPDATE
    SET signature = EXCLUDED.signature,
        clusters = EXCLUDED.clusters,
        computed_at = EXCLUDED.computed_at
  `;
}

/**
 * Cluster the given top-pick candidates by topic via a single
 * Anthropic call. The model only groups events that are substantively
 * the same news beat (not "both about politics" — that's not a
 * cluster, that's a category).
 *
 * Singletons (events with no actual cluster mate) are returned as
 * one-element clusters so the caller renders them normally.
 *
 * Falls back gracefully on Anthropic errors: each event becomes its
 * own singleton cluster.
 */
async function clusterViaAnthropic(candidates: ClusterCandidate[]): Promise<Cluster[]> {
  const sys = `You group news/social events into topic clusters for a digital strategy team.

A "cluster" means 2+ events that are about the SAME news beat — same incident, same hearing moment, same statement, same breaking development. NOT "all about politics" or "all critical of Trump" — those are categories, not clusters.

When you find a cluster:
- pick the single tweet that most clearly conveys the topic (prefer specific quotes, named figures, dollar amounts) as primary_event_id
- list the others in related_event_ids

Singletons (events that don't truly cluster with any other) get returned as a 1-element cluster — primary_event_id set, related_event_ids empty.

Output JSON only:
{"clusters":[{"cluster_topic":"<3-8 word summary>","primary_event_id":<int>,"related_event_ids":[<int>,...]}, ...]}

Rules:
- Every input event id must appear in exactly one cluster (as primary or related). No omissions, no duplicates.
- cluster_topic should be specific and operator-readable, e.g. "Hegseth Iran cost confrontation" not "Iran war coverage".`;

  const numbered = candidates
    .map(c => `[${c.id}] @${c.author || 'unknown'} (score ${c.relevance_score ?? '?'}/10): ${c.content.slice(0, 240).replace(/\n/g, ' ')}`)
    .join('\n');

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: sys,
      messages: [{ role: 'user', content: numbered }],
    });
    const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const raw: Cluster[] = parsed.clusters || [];

    // Validate: every input id must appear exactly once. Backfill any
    // missing ids as singleton clusters so we never drop content.
    const seen = new Set<number>();
    const out: Cluster[] = [];
    for (const c of raw) {
      const pid = Number(c.primary_event_id);
      if (!Number.isInteger(pid) || seen.has(pid)) continue;
      seen.add(pid);
      const related: number[] = [];
      for (const rid of c.related_event_ids || []) {
        const n = Number(rid);
        if (Number.isInteger(n) && !seen.has(n)) {
          seen.add(n);
          related.push(n);
        }
      }
      out.push({
        cluster_topic: String(c.cluster_topic || '').slice(0, 80) || 'Untitled',
        primary_event_id: pid,
        related_event_ids: related,
      });
    }
    for (const cand of candidates) {
      if (!seen.has(cand.id)) {
        out.push({
          cluster_topic: cand.content.slice(0, 60),
          primary_event_id: cand.id,
          related_event_ids: [],
        });
      }
    }
    return out;
  } catch {
    // Fallback: each event is its own singleton cluster.
    return candidates.map(c => ({
      cluster_topic: c.content.slice(0, 60),
      primary_event_id: c.id,
      related_event_ids: [],
    }));
  }
}

/**
 * Public entry: returns clusters for these top-pick candidates,
 * using the per-client cache when valid. Skips clustering entirely
 * for ≤2 candidates (no benefit in API call).
 */
export async function getClustersForTopPicks(
  clientId: number,
  candidates: ClusterCandidate[]
): Promise<Cluster[]> {
  if (candidates.length === 0) return [];

  // Singletons / pairs: trivial clustering — each event is its own cluster.
  if (candidates.length <= 2) {
    return candidates.map(c => ({
      cluster_topic: c.content.slice(0, 60),
      primary_event_id: c.id,
      related_event_ids: [],
    }));
  }

  const ids = candidates.map(c => c.id);
  const signature = makeSignature(ids);

  const cached = await getCachedClusters(clientId, signature);
  if (cached) return cached;

  const clusters = await clusterViaAnthropic(candidates);
  // Save to cache (best-effort; failure here shouldn't block rendering)
  saveClusters(clientId, signature, clusters).catch(() => {});
  return clusters;
}
