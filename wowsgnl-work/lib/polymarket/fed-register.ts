// Federal Register API client. No auth required (public API).
//
// Pulls documents published in the last 24 hours where either:
//   - the agency is the CFTC (any prediction-market regulatory move
//     would land here), OR
//   - the title or abstract matches our prediction-market keywords.
//
// We pull both buckets, dedupe on document_number, return a normalized
// shape ready for events-table insert.

const BASE = 'https://www.federalregister.gov/api/v1';

// CFTC's slug in the agencies endpoint. Verified at
// /api/v1/agencies — "commodity-futures-trading-commission".
const CFTC_AGENCY_SLUG = 'commodity-futures-trading-commission';

// Direct-name keywords. Federal Register full-text search treats the
// query as OR-ish, so a comma-joined list works. Quoted phrases are
// passed as-is and the API handles them.
const KEYWORDS = [
  '"prediction market"',
  '"event contract"',
  '"election betting"',
  '"binary option"',
  'kalshi',
  'polymarket',
];

export type FedRegDoc = {
  document_number: string;
  title: string;
  abstract: string | null;
  html_url: string;
  publication_date: string; // YYYY-MM-DD
  agency_names: string[];
  type: string | null;
};

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayUTC(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

async function fetchPage(params: URLSearchParams): Promise<FedRegDoc[]> {
  const url = `${BASE}/documents.json?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fed_register ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const results: any[] = data.results || [];
  return results.map((r: any) => ({
    document_number: String(r.document_number),
    title: String(r.title || ''),
    abstract: r.abstract || null,
    html_url: String(r.html_url || ''),
    publication_date: String(r.publication_date || ''),
    agency_names: Array.isArray(r.agencies)
      ? r.agencies.map((a: any) => String(a.name || a.raw_name || '')).filter(Boolean)
      : [],
    type: r.type || null,
  }));
}

export async function fetchFederalRegisterRecent(): Promise<FedRegDoc[]> {
  const from = yesterdayUTC();
  const to = todayUTC();

  // Bucket 1: anything from CFTC.
  const cftcParams = new URLSearchParams({
    'conditions[publication_date][gte]': from,
    'conditions[publication_date][lte]': to,
    'conditions[agencies][]': CFTC_AGENCY_SLUG,
    'fields[]': 'document_number',
    per_page: '100',
  });
  // Pull all relevant fields explicitly so the response isn't trimmed.
  for (const f of ['title', 'abstract', 'html_url', 'publication_date', 'agencies', 'type']) {
    cftcParams.append('fields[]', f);
  }

  // Bucket 2: keyword search across publication date window.
  const kwParams = new URLSearchParams({
    'conditions[publication_date][gte]': from,
    'conditions[publication_date][lte]': to,
    'conditions[term]': KEYWORDS.join(' OR '),
    per_page: '100',
  });
  for (const f of ['document_number', 'title', 'abstract', 'html_url', 'publication_date', 'agencies', 'type']) {
    kwParams.append('fields[]', f);
  }

  const [cftcDocs, kwDocs] = await Promise.allSettled([
    fetchPage(cftcParams),
    fetchPage(kwParams),
  ]);

  const out: FedRegDoc[] = [];
  const seen = new Set<string>();
  for (const r of [cftcDocs, kwDocs]) {
    if (r.status !== 'fulfilled') continue;
    for (const d of r.value) {
      if (!d.document_number || seen.has(d.document_number)) continue;
      seen.add(d.document_number);
      out.push(d);
    }
  }
  return out;
}
