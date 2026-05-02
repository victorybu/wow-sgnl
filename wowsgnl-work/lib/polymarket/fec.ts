// FEC OpenFEC API client. Auth via ?api_key=.
//
// Three daily pulls for the Polymarket retainer:
//   1. Committee filings searching for "Kalshi" — anything Kalshi-named
//      filing a recent report (registration, contributions, expenditures).
//   2. Donations from any name in pm_kalshi_targets — schedule_a
//      receipts where the contributor name matches.
//   3. New PAC formations with Kalshi-adjacent names — keyword search
//      against committee names registered in the last 30 days.
//
// Returns a normalized list of "FEC items" each ready for events-table
// insert with a stable source_id (filing/transaction/committee id).

const BASE = 'https://api.open.fec.gov/v1';

function key(): string {
  return process.env.FEC_API_KEY || '';
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoUTC(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
}

export type FECItem = {
  // Stable platform ID. Format depends on bucket: filing_id, sub_id
  // (transaction id), or committee_id.
  source_id: string;
  bucket: 'filing' | 'donation' | 'pac_formation';
  title: string;        // headline-style summary line
  body: string;         // 1-2 sentence detail
  url: string;
  occurred_at: string | null; // ISO timestamp where available
};

async function getJson(path: string, params: Record<string, string | string[] | number>): Promise<any> {
  const u = new URL(BASE + path);
  u.searchParams.set('api_key', key());
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const x of v) u.searchParams.append(k, String(x));
    } else {
      u.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(u.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fec ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// 1. Committee filings searching "Kalshi".
async function fetchKalshiFilings(since: string): Promise<FECItem[]> {
  const data = await getJson('/filings/', {
    q: 'kalshi',
    min_receipt_date: since,
    per_page: 50,
    sort: '-receipt_date',
  });
  const results: any[] = data.results || [];
  return results.map((r: any) => ({
    source_id: `filing-${r.file_number || r.filing_id || r.fec_file_id || `${r.committee_id}-${r.report_year}-${r.report_type}`}`,
    bucket: 'filing' as const,
    title: `FEC filing: ${r.committee_name || r.committee_id} — ${r.form_type || r.report_type_full || 'filing'}`,
    body: [r.report_type_full, r.report_year, r.amendment_indicator_full]
      .filter(Boolean).join(' · '),
    url: r.pdf_url || `https://docquery.fec.gov/cgi-bin/forms/${r.committee_id}/${r.file_number || r.filing_id || ''}/`,
    occurred_at: r.receipt_date || null,
  }));
}

// 2. Donations from any name in pm_kalshi_targets.
async function fetchTargetDonations(targetNames: string[], since: string): Promise<FECItem[]> {
  if (targetNames.length === 0) return [];
  const out: FECItem[] = [];
  // FEC's schedule_a contributor_name supports a single name per query;
  // loop through targets sequentially with a small delay.
  for (const name of targetNames) {
    try {
      const data = await getJson('/schedules/schedule_a/', {
        contributor_name: name,
        min_date: since,
        per_page: 25,
        sort: '-contribution_receipt_date',
      });
      const results: any[] = data.results || [];
      for (const r of results) {
        const subId = r.sub_id || `${r.transaction_id}-${r.contributor_name}-${r.contribution_receipt_date}`;
        out.push({
          source_id: `donation-${subId}`,
          bucket: 'donation' as const,
          title: `${r.contributor_name} → ${r.committee?.name || r.committee_id} · $${r.contribution_receipt_amount}`,
          body: [
            r.contribution_receipt_date,
            r.contributor_employer ? `employer: ${r.contributor_employer}` : null,
            r.contributor_occupation ? `occupation: ${r.contributor_occupation}` : null,
            r.memo_text || null,
          ].filter(Boolean).join(' · '),
          url: `https://www.fec.gov/data/receipts/?contributor_name=${encodeURIComponent(name)}`,
          occurred_at: r.contribution_receipt_date || null,
        });
      }
    } catch {
      // Skip this target on error; partial results still useful.
    }
    // Soft rate-limit pause between targets.
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

// 3. New PAC formations with Kalshi-adjacent names registered recently.
async function fetchKalshiAdjacentPACs(since: string): Promise<FECItem[]> {
  const data = await getJson('/committees/', {
    q: 'kalshi prediction market',
    min_first_file_date: since,
    per_page: 25,
    sort: '-first_file_date',
  });
  const results: any[] = data.results || [];
  return results.map((r: any) => ({
    source_id: `pac-${r.committee_id}`,
    bucket: 'pac_formation' as const,
    title: `New committee registered: ${r.name}`,
    body: [
      r.committee_type_full,
      r.designation_full,
      r.first_file_date ? `first filed ${r.first_file_date}` : null,
      r.party_full || null,
      r.state || null,
    ].filter(Boolean).join(' · '),
    url: `https://www.fec.gov/data/committee/${r.committee_id}/`,
    occurred_at: r.first_file_date || null,
  }));
}

export async function fetchFECRecent(opts: { targetNames: string[] }): Promise<FECItem[]> {
  if (!key()) return [];
  const sinceFilings = daysAgoUTC(1);     // last 24h for fast-moving filings
  const sinceDonations = daysAgoUTC(7);   // donations show up with lag, widen window
  const sincePAC = daysAgoUTC(30);        // PAC formations are rare, widen further

  const [filings, donations, pacs] = await Promise.allSettled([
    fetchKalshiFilings(sinceFilings),
    fetchTargetDonations(opts.targetNames, sinceDonations),
    fetchKalshiAdjacentPACs(sincePAC),
  ]);

  const out: FECItem[] = [];
  const seen = new Set<string>();
  for (const r of [filings, donations, pacs]) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (seen.has(item.source_id)) continue;
      seen.add(item.source_id);
      out.push(item);
    }
  }
  return out;
}
