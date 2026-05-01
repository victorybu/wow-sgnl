import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

// POST /api/admin/pm-seed
//
// Idempotent seed for the Polymarket retainer (client_id = 4):
//   - Adds watchlist x_account rows (skipping any handle already present
//     for client 4 from prior imports).
//   - Adds watchlist x_keyword rows (skipping existing).
//   - Adds pm_kalshi_targets starter rows.
//   - Adds 6 happy-hour pm_people seeds (priority + pending_review).
//
// Safe to re-run; existing rows are not duplicated. Returns counts so
// the caller can confirm.

const POLYMARKET_CLIENT_ID = 4;

// Draft watchlist accounts. ~100 handles across progressives, leadership,
// committee Dems, progressive media, policy reporters, regulation
// reporters, operative orgs, fintech voices, competitor-watch. All
// added at priority 2 (every 3 days); Caleb promotes to priority 1
// manually. audience_role + party left null on bulk seed — these are
// public commentators / pols, not the hand-tagged staffer set.
const WATCHLIST_HANDLES: string[] = [
  // Progressive members of Congress
  'BernieSanders', 'SenWarren', 'PramilaJayapal', 'AOC', 'RoKhanna', 'RepRaskin',
  'SenMarkey', 'maziehirono', 'SenWhitehouse', 'SenJeffMerkley', 'ChrisMurphyCT',
  'brianschatz', 'RonWyden', 'SenatorWarnock', 'SenTinaSmith', 'SenPeterWelch',
  'JohnFetterman', 'GregCasar', 'SummerForPA', 'MaxwellFrostFL', 'CoriBush',
  'IlhanMN', 'RashidaTlaib', 'AyannaPressley',

  // Centrist / leadership Dems
  'SenSchumer', 'RepJeffries', 'SenGaryPeters', 'MarkWarner', 'amyklobuchar',
  'SenAdamSchiff',

  // Committee Dems (HFS, Ag, Banking)
  'RepMaxineWaters', 'RepStephenLynch', 'repdavidscott', 'SenSherrodBrown',
  'SenStabenow',

  // Progressive media / pundits
  'mehdirhasan', 'krystalball', 'briebriejoy', 'SamSeder', 'PodSaveAmerica',
  'CrookedMedia', 'MeidasTouch', 'davidsirota', 'WalkerBragman', 'kenklippenstein',
  'ryangrim',

  // Dem-leaning policy reporters
  'JakeSherman', 'apalmerdc', 'BresPolitico', 'coprysko', 'lachlan',
  'SalehaMohsin', 'anniekarni', 'maxwelltani',

  // Election / regulation reporters
  'JessicaHuseman', 'mjs_DC', 'imillhiser',

  // Progressive operative orgs
  'sunrisemvmt', 'justicedems', 'WorkingFamilies', 'IndivisibleTeam',
  'DataProgress', 'LeadersWDeserve', 'MoveOn', 'WeDemandJustice',

  // Fintech / policy voices
  'ProfHilaryAllen', 'levmenand', 'rohangrey',

  // Polymarket / competitor watch
  'Kalshi', 'Polymarket', 'mansourtarek_', 'shayne_coplan',
];

// New x_keyword watchers. Existing 4 (polymarket, kalshi, prediction
// market, prediction markets) are skipped via the dedup check; the rest
// add fresh listening for direct mentions of regulation + adjacent terms.
const KEYWORDS: string[] = [
  'polymarket',
  'kalshi',
  'prediction market',
  'prediction markets',
  'event contract',
  'event contracts',
  'election betting',
  'election odds',
  'CFTC',
  'binary option',
  'binary options',
  'election market',
  'election markets',
  'Robinhood event',
];

const KALSHI_TARGETS: { name: string; role: string | null; organization: string | null; notes: string | null }[] = [
  { name: 'Tarek Mansour', role: 'CEO', organization: 'Kalshi', notes: 'Co-founder, public face on regulation + product' },
  { name: 'Luana Lopes Lara', role: 'Co-founder', organization: 'Kalshi', notes: 'Co-founder' },
  { name: 'Stephanie Cutter', role: 'Advisor (via Precision Strategies)', organization: 'Kalshi', notes: 'Recent Dem-side advisor hire per Axios — Obama-world establishment lane' },
  { name: 'Precision Strategies', role: 'Firm', organization: 'Kalshi (consulting relationship)', notes: 'Flag any new Precision hires moving to Kalshi or new Kalshi accounts under Precision' },
];

// 6 happy-hour entries. All marked priority + pending_review so Caleb
// is reminded to fill in real names before the data starts driving
// analysis. last_touched stamped to "yesterday" so they sort to top.
const HAPPY_HOUR_PEOPLE: {
  name: string;
  role: string | null;
  employer: string | null;
  lane: string;
  posture: string;
  posture_note: string | null;
  notes: string;
}[] = [
  {
    name: 'Sunrise Movement comms director',
    role: 'Comms director',
    employer: 'Sunrise Movement',
    lane: 'progressive',
    posture: 'unknown',
    posture_note: null,
    notes: 'Brought to Polymarket happy hour. Update name.',
  },
  {
    name: 'Drop Site News reporter',
    role: 'Reporter',
    employer: 'Drop Site News',
    lane: 'press',
    posture: 'unknown',
    posture_note: null,
    notes: 'Brought to Polymarket happy hour. Update name.',
  },
  {
    name: 'Ex-Sunrise Movement press secretary',
    role: 'Former press secretary',
    employer: '(former Sunrise Movement)',
    lane: 'progressive',
    posture: 'cold',
    posture_note: 'Skeptical on election betting framing',
    notes: 'Brought to happy hour. Update name and current role.',
  },
  {
    name: 'Emily Randall staffer',
    role: 'Staffer',
    employer: 'Office of Rep. Emily Randall',
    lane: 'progressive',
    posture: 'unknown',
    posture_note: null,
    notes: 'Brought to happy hour. Update name and role.',
  },
  {
    name: 'Leaders We Deserve comms',
    role: 'Comms',
    employer: 'Leaders We Deserve',
    lane: 'progressive',
    posture: 'unknown',
    posture_note: null,
    notes: 'Brought to happy hour. Update name.',
  },
  {
    name: 'Ex-Swalwell staffer',
    role: 'Former staffer',
    employer: '(former Office of Rep. Swalwell)',
    lane: 'centrist',
    posture: 'unknown',
    posture_note: null,
    notes: 'Brought to happy hour. Update name and current role.',
  },
];

export async function POST() {
  // Verify Polymarket client exists
  const c = await sql`SELECT id, name FROM clients WHERE id = ${POLYMARKET_CLIENT_ID}`;
  if (c.rows.length === 0) {
    return NextResponse.json({ ok: false, error: `client ${POLYMARKET_CLIENT_ID} not found` }, { status: 404 });
  }

  // ---- Watchlist accounts (dedup against existing rows) ----
  const existingAccts = await sql`
    SELECT value FROM watchlist
    WHERE client_id = ${POLYMARKET_CLIENT_ID} AND kind = 'x_account'
  `;
  const existingAcctSet = new Set<string>(
    existingAccts.rows.map((r: any) => String(r.value).toLowerCase()),
  );
  const wantHandles = WATCHLIST_HANDLES.map(h => h.replace(/^@+/, '').trim().toLowerCase()).filter(Boolean);
  const freshHandles = wantHandles.filter(h => !existingAcctSet.has(h));
  let acctsInserted = 0;
  for (const h of freshHandles) {
    await sql`
      INSERT INTO watchlist (client_id, kind, value, active)
      VALUES (${POLYMARKET_CLIENT_ID}, 'x_account', ${h}, TRUE)
    `;
    acctsInserted++;
  }

  // ---- Keywords (dedup against existing rows) ----
  const existingKw = await sql`
    SELECT value FROM watchlist
    WHERE client_id = ${POLYMARKET_CLIENT_ID} AND kind = 'x_keyword'
  `;
  const existingKwSet = new Set<string>(existingKw.rows.map((r: any) => String(r.value)));
  const freshKw = KEYWORDS.filter(k => !existingKwSet.has(k));
  let kwInserted = 0;
  for (const k of freshKw) {
    await sql`
      INSERT INTO watchlist (client_id, kind, value, active)
      VALUES (${POLYMARKET_CLIENT_ID}, 'x_keyword', ${k}, TRUE)
    `;
    kwInserted++;
  }

  // ---- pm_kalshi_targets (dedup by name) ----
  const existingTargets = await sql`SELECT name FROM pm_kalshi_targets`;
  const existingTargetSet = new Set<string>(
    existingTargets.rows.map((r: any) => String(r.name).toLowerCase()),
  );
  let targetsInserted = 0;
  for (const t of KALSHI_TARGETS) {
    if (existingTargetSet.has(t.name.toLowerCase())) continue;
    await sql`
      INSERT INTO pm_kalshi_targets (name, role, organization, notes)
      VALUES (${t.name}, ${t.role}, ${t.organization}, ${t.notes})
    `;
    targetsInserted++;
  }

  // ---- pm_people happy-hour seeds (dedup by name; all priority + pending_review) ----
  const existingPeople = await sql`SELECT name FROM pm_people`;
  const existingPeopleSet = new Set<string>(
    existingPeople.rows.map((r: any) => String(r.name).toLowerCase()),
  );
  // last_touched = "yesterday" so they sort to top of last_touched DESC.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  let peopleInserted = 0;
  for (const p of HAPPY_HOUR_PEOPLE) {
    if (existingPeopleSet.has(p.name.toLowerCase())) continue;
    await sql`
      INSERT INTO pm_people
        (name, role, employer, lane, posture, posture_note,
         last_touched, priority, pending_review, notes)
      VALUES
        (${p.name}, ${p.role}, ${p.employer}, ${p.lane},
         ${p.posture}, ${p.posture_note},
         ${yesterday}::timestamptz, TRUE, TRUE, ${p.notes})
    `;
    peopleInserted++;
  }

  // ---- Final counts for sanity ----
  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${POLYMARKET_CLIENT_ID} AND kind = 'x_account') AS watchlist_accounts,
      (SELECT COUNT(*)::int FROM watchlist WHERE client_id = ${POLYMARKET_CLIENT_ID} AND kind = 'x_keyword') AS watchlist_keywords,
      (SELECT COUNT(*)::int FROM pm_kalshi_targets) AS pm_kalshi_targets,
      (SELECT COUNT(*)::int FROM pm_people) AS pm_people,
      (SELECT COUNT(*)::int FROM pm_people WHERE pending_review = TRUE) AS pm_people_pending
  `;

  return NextResponse.json({
    ok: true,
    inserted: {
      watchlist_accounts: acctsInserted,
      watchlist_keywords: kwInserted,
      pm_kalshi_targets: targetsInserted,
      pm_people: peopleInserted,
    },
    skipped: {
      watchlist_accounts: wantHandles.length - freshHandles.length,
      watchlist_keywords: KEYWORDS.length - freshKw.length,
      pm_kalshi_targets: KALSHI_TARGETS.length - targetsInserted,
      pm_people: HAPPY_HOUR_PEOPLE.length - peopleInserted,
    },
    totals: counts.rows[0],
  });
}

export async function GET() {
  return POST();
}
