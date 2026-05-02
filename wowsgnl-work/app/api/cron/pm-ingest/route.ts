import { sql } from '@/lib/db';
import { fetchFederalRegisterRecent } from '@/lib/polymarket/fed-register';
import { fetchFECRecent } from '@/lib/polymarket/fec';
import { fetchSerpapiRecent } from '@/lib/polymarket/serpapi';
import { fetchCongressRecent } from '@/lib/polymarket/congress';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

const POLYMARKET_CLIENT_ID = 4;

// GET /api/cron/pm-ingest
//
// Daily Polymarket-scoped ingestion. Pulls from 4 new sources
// (Federal Register, FEC, SerpAPI, Congress.gov) and writes raw
// signals into the existing events table with client_id=4.
//
// Twitter/X is NOT re-polled here — the existing /api/poll cron
// already runs every 3h across all watchers including the 217
// Polymarket x_account rows + 14 keyword watchers. Re-polling would
// just double our twitterapi.io spend.
//
// Inserts use ON CONFLICT (source, source_id) DO NOTHING for
// idempotent re-runs. Each source runs in parallel via
// Promise.allSettled so one bad source doesn't block the rest.
export async function GET() {
  const debug: Record<string, any> = {};
  const errors: string[] = [];

  // Pull Kalshi target names for FEC donation lookups.
  const targetsRes = await sql`SELECT name FROM pm_kalshi_targets`;
  const targetNames: string[] = targetsRes.rows.map((r: any) => r.name);
  debug.kalshi_targets = targetNames.length;

  const [fedReg, fec, serp, congress] = await Promise.allSettled([
    fetchFederalRegisterRecent(),
    fetchFECRecent({ targetNames }),
    fetchSerpapiRecent(),
    fetchCongressRecent(),
  ]);

  let inserted = 0;
  const counts: Record<string, { fetched: number; inserted: number }> = {
    fed_register: { fetched: 0, inserted: 0 },
    fec: { fetched: 0, inserted: 0 },
    serpapi: { fetched: 0, inserted: 0 },
    congress: { fetched: 0, inserted: 0 },
  };

  // Federal Register
  if (fedReg.status === 'fulfilled') {
    const docs = fedReg.value;
    counts.fed_register.fetched = docs.length;
    for (const d of docs) {
      const author = d.agency_names[0] || 'Federal Register';
      const content = [d.title, d.abstract].filter(Boolean).join('\n\n');
      const ins = await sql`
        INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
        VALUES (${POLYMARKET_CLIENT_ID}, 'fed_register', ${d.document_number},
                ${author}, ${content}, ${d.html_url}, ${d.publication_date}::timestamptz)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
      `;
      if (ins.rows.length > 0) {
        inserted++;
        counts.fed_register.inserted++;
      }
    }
  } else {
    errors.push(`fed_register: ${(fedReg.reason as any)?.message || 'unknown'}`);
  }

  // FEC
  if (fec.status === 'fulfilled') {
    const items = fec.value;
    counts.fec.fetched = items.length;
    for (const it of items) {
      const content = `${it.title}\n\n${it.body}`;
      const ins = await sql`
        INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
        VALUES (${POLYMARKET_CLIENT_ID}, 'fec', ${it.source_id},
                ${'FEC'}, ${content}, ${it.url}, ${it.occurred_at}::timestamptz)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
      `;
      if (ins.rows.length > 0) {
        inserted++;
        counts.fec.inserted++;
      }
    }
  } else {
    errors.push(`fec: ${(fec.reason as any)?.message || 'unknown'}`);
  }

  // SerpAPI
  if (serp.status === 'fulfilled') {
    const items = serp.value;
    counts.serpapi.fetched = items.length;
    for (const it of items) {
      const content = `${it.title}\n\n${it.body}`;
      const ins = await sql`
        INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
        VALUES (${POLYMARKET_CLIENT_ID}, 'serpapi', ${it.source_id},
                ${it.source_name}, ${content}, ${it.url}, ${it.occurred_at}::timestamptz)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
      `;
      if (ins.rows.length > 0) {
        inserted++;
        counts.serpapi.inserted++;
      }
    }
  } else {
    errors.push(`serpapi: ${(serp.reason as any)?.message || 'unknown'}`);
  }

  // Congress
  if (congress.status === 'fulfilled') {
    const items = congress.value;
    counts.congress.fetched = items.length;
    for (const it of items) {
      const content = `${it.title}\n\n${it.body}`;
      const ins = await sql`
        INSERT INTO events (client_id, source, source_id, author, content, url, posted_at)
        VALUES (${POLYMARKET_CLIENT_ID}, 'congress', ${it.source_id},
                ${it.author}, ${content}, ${it.url}, ${it.occurred_at}::timestamptz)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
      `;
      if (ins.rows.length > 0) {
        inserted++;
        counts.congress.inserted++;
      }
    }
  } else {
    errors.push(`congress: ${(congress.reason as any)?.message || 'unknown'}`);
  }

  // Snapshot per-source totals for visibility on what's now in events
  // for the Polymarket client.
  const totals = await sql`
    SELECT source, COUNT(*)::int AS n
    FROM events
    WHERE client_id = ${POLYMARKET_CLIENT_ID}
    GROUP BY source
    ORDER BY source
  `;

  return NextResponse.json({
    ok: true,
    inserted,
    counts,
    debug,
    errors,
    totals_in_events: Object.fromEntries(totals.rows.map((r: any) => [r.source, r.n])),
  });
}
