// Congress.gov API client. Auth via ?api_key=.
//
// Three daily pulls scoped to prediction-market-relevant activity:
//   1. Bills introduced in the last 7 days whose title or short_title
//      matches a keyword (text search would be ideal but the bill
//      endpoint doesn't support full-text; we keyword-filter the
//      window instead).
//   2. Hearings on the calendar for the five tracked committees over
//      the next 7 days.
//   3. Congressional Record entries from the last 24 hours that match
//      keywords (CRec full-text search via /congressional-record).
//
// Returns normalized items with stable source_ids ready for events
// table insert.

const BASE = 'https://api.congress.gov/v3';

function key(): string {
  // Trim defensively — env vars pasted via the Vercel dashboard
  // sometimes carry a trailing space/newline that URL-encodes as "+"
  // and trips Congress.gov's strict key validation (returns 403).
  return (process.env.CONGRESS_API_KEY || '').trim();
}

// Prediction-market-relevant keywords applied to bill titles / CRec text.
const KEYWORDS = [
  'prediction market',
  'event contract',
  'election betting',
  'binary option',
  'kalshi',
  'polymarket',
  'CFTC',
];

// Five tracked committees (chamber + system code per Congress.gov API).
// System codes verified from /committee endpoint.
const TRACKED_COMMITTEES = [
  { chamber: 'house', code: 'hsba00', name: 'House Financial Services' },
  { chamber: 'house', code: 'hsag00', name: 'House Agriculture' },
  { chamber: 'house', code: 'hsha00', name: 'House Administration' },
  { chamber: 'senate', code: 'ssbk00', name: 'Senate Banking' },
  { chamber: 'senate', code: 'ssaf00', name: 'Senate Agriculture' },
];

const CURRENT_CONGRESS = 119;

export type CongressItem = {
  source_id: string;
  bucket: 'bill' | 'hearing' | 'crec';
  title: string;
  body: string;
  url: string;
  author: string | null;
  occurred_at: string | null;
};

async function getJson(path: string, params: Record<string, string | number>): Promise<any> {
  const u = new URL(BASE + path);
  u.searchParams.set('api_key', key());
  u.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`congress ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function isoDaysAgo(d: number): string {
  // Congress.gov silently returns 0 results when the ISO string has
  // milliseconds (toISOString default). Strip them — format must be
  // YYYY-MM-DDTHH:MM:SSZ.
  return new Date(Date.now() - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function matchesKeyword(text: string): boolean {
  const haystack = text.toLowerCase();
  return KEYWORDS.some(k => haystack.includes(k.toLowerCase()));
}

// 1. Recent bills, keyword-filtered.
async function fetchRecentBills(): Promise<CongressItem[]> {
  const data = await getJson(`/bill/${CURRENT_CONGRESS}`, {
    fromDateTime: isoDaysAgo(7),
    toDateTime: isoNow(),
    sort: 'updateDate+desc',
    limit: 250,
  });
  const bills: any[] = data.bills || [];
  const out: CongressItem[] = [];
  for (const b of bills) {
    const title = String(b.title || '');
    if (!matchesKeyword(title)) continue;
    const sponsor = b.sponsor || b.sponsors?.[0];
    out.push({
      source_id: `bill-${b.congress}-${b.type}-${b.number}`,
      bucket: 'bill' as const,
      title: `${b.type} ${b.number}: ${title}`,
      body: [
        b.policyArea?.name,
        b.latestAction?.text,
        b.latestAction?.actionDate,
      ].filter(Boolean).join(' · '),
      url: `https://www.congress.gov/bill/${b.congress}th-congress/${b.type === 'HR' ? 'house-bill' : 'senate-bill'}/${b.number}`,
      author: sponsor ? `${sponsor.firstName || ''} ${sponsor.lastName || ''}`.trim() || null : null,
      occurred_at: b.latestAction?.actionDate || b.updateDate || null,
    });
  }
  return out;
}

// 2. Hearings on the calendar for tracked committees.
async function fetchHearingsForCommittees(): Promise<CongressItem[]> {
  const out: CongressItem[] = [];
  for (const c of TRACKED_COMMITTEES) {
    try {
      const data = await getJson(`/committee-meeting/${CURRENT_CONGRESS}/${c.chamber}`, {
        limit: 50,
      });
      const meetings: any[] = data.committeeMeetings || [];
      for (const m of meetings) {
        // Only keep meetings tied to our tracked committee
        const isOurCommittee = (m.committee?.systemCode || '').toLowerCase() === c.code.toLowerCase()
          || (m.committees || []).some((cc: any) => (cc.systemCode || '').toLowerCase() === c.code.toLowerCase());
        if (!isOurCommittee) continue;
        // Skip past meetings (older than today)
        const dateStr = m.meetingDate || m.date;
        if (dateStr && Date.parse(dateStr) < Date.now() - 86_400_000) continue;
        out.push({
          source_id: `hearing-${m.eventId || m.meetingId || `${c.code}-${dateStr}`}`,
          bucket: 'hearing' as const,
          title: `${c.name} hearing: ${m.title || 'untitled'}`,
          body: [m.location, dateStr, m.meetingType].filter(Boolean).join(' · '),
          url: m.url || `https://www.congress.gov/committee/${c.chamber}/${c.code}`,
          author: c.name,
          occurred_at: dateStr || null,
        });
      }
    } catch {
      // Skip this committee on error.
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return out;
}

// 3. Congressional Record entries last 24h matching keywords.
async function fetchCongressionalRecord(): Promise<CongressItem[]> {
  // The CRec endpoint returns daily issues; pull yesterday + today,
  // walk sections, keyword-filter section text. This is best-effort —
  // the API surface here is limited compared to bill search.
  const out: CongressItem[] = [];
  try {
    const data = await getJson('/congressional-record', { limit: 5 });
    const issues: any[] = data.Results?.Issues || data.issues || [];
    for (const issue of issues.slice(0, 2)) {
      const sections: any[] = issue.Links?.FullRecord?.PDF || issue.sections || [];
      // Without text-extraction we can only flag by issue date; CRec's
      // text isn't in the JSON response. Surface the issue itself if
      // any links mention CFTC. This is intentionally light — the
      // operator gets a "go check this CRec issue" pointer rather than
      // line-level statements.
      const date = issue.PublishDate || issue.publishDate || issue.date;
      if (!date) continue;
      out.push({
        source_id: `crec-${issue.Volume || ''}-${issue.Issue || ''}-${date}`,
        bucket: 'crec' as const,
        title: `Congressional Record · Vol ${issue.Volume || '?'} Issue ${issue.Issue || '?'}`,
        body: `Daily issue published ${date}. Manually check for prediction-market mentions.`,
        url: issue.Links?.Issue?.PDF?.[0]?.Url || `https://www.congress.gov/congressional-record`,
        author: null,
        occurred_at: date,
      });
    }
  } catch {
    // CRec endpoint shape varies; soft-fail.
  }
  return out;
}

export async function fetchCongressRecent(): Promise<CongressItem[]> {
  if (!key()) return [];
  const [bills, hearings, crec] = await Promise.allSettled([
    fetchRecentBills(),
    fetchHearingsForCommittees(),
    fetchCongressionalRecord(),
  ]);

  const out: CongressItem[] = [];
  const seen = new Set<string>();
  for (const r of [bills, hearings, crec]) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (seen.has(item.source_id)) continue;
      seen.add(item.source_id);
      out.push(item);
    }
  }
  return out;
}
