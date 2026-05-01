import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
import { fetchListMembers } from '@/lib/twitterapi';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const AUDIENCE_ROLES = [
  { value: '', label: '— no role —' },
  { value: 'staffer', label: 'Hill staffer' },
  { value: 'journalist', label: 'Journalist' },
  { value: 'official', label: 'Official / spokesperson' },
  { value: 'creator', label: 'Creator / influencer' },
  { value: 'politician', label: 'Politician' },
];

const PARTIES = [
  { value: '', label: '— no side —' },
  { value: 'D', label: 'D-side' },
  { value: 'R', label: 'R-side' },
  { value: 'I', label: 'Independent / other' },
];

// Split comma- and newline-separated input. For x_account, also handles
// pasted "@handle, @handle" lists; for x_keyword we keep multi-word
// phrases intact and only split on commas/newlines.
function parseBulkValues(raw: string, kind: string): string[] {
  if (!raw) return [];
  const parts = raw.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
  const cleaned = parts.map(p => {
    if (kind === 'x_account') {
      let v = p.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '');
      v = v.replace(/^@+/, '').split(/[\/?#]/)[0].trim().toLowerCase();
      return v;
    }
    return p;
  }).filter(Boolean);
  return Array.from(new Set(cleaned));
}

// Accept either a numeric list ID or a full x.com/i/lists/{id} URL.
function parseListId(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/lists\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

async function applyHandlesToWatchlist(opts: {
  clientId: number;
  kind: string;
  values: string[];
  audience_role: string | null;
  party: string | null;
}): Promise<{ inserted: number; skipped: number; updated: number }> {
  const { clientId, kind, values, audience_role, party } = opts;
  if (values.length === 0) return { inserted: 0, skipped: 0, updated: 0 };

  const existing = await sql`
    SELECT value FROM watchlist WHERE client_id = ${clientId} AND kind = ${kind}
  `;
  const existingSet = new Set<string>(
    existing.rows.map((r: any) => kind === 'x_account' ? String(r.value).toLowerCase() : String(r.value)),
  );
  const fresh = values.filter(v => !existingSet.has(v));
  const already = values.filter(v => existingSet.has(v));

  let inserted = 0;
  for (const v of fresh) {
    await sql`
      INSERT INTO watchlist (client_id, kind, value, audience_role, party)
      VALUES (${clientId}, ${kind}, ${v}, ${audience_role}, ${party})
    `;
    inserted++;
  }

  let updated = 0;
  if (audience_role || party) {
    for (const v of already) {
      // Only update fields the user actually set; leave others alone.
      if (audience_role && party) {
        await sql`
          UPDATE watchlist SET audience_role = ${audience_role}, party = ${party}
          WHERE client_id = ${clientId} AND kind = ${kind} AND value = ${v}
        `;
      } else if (audience_role) {
        await sql`
          UPDATE watchlist SET audience_role = ${audience_role}
          WHERE client_id = ${clientId} AND kind = ${kind} AND value = ${v}
        `;
      } else {
        await sql`
          UPDATE watchlist SET party = ${party}
          WHERE client_id = ${clientId} AND kind = ${kind} AND value = ${v}
        `;
      }
      updated++;
    }
  }
  return { inserted, skipped: already.length - updated, updated };
}

async function bulkAdd(formData: FormData) {
  'use server';
  const clientId = parseInt(formData.get('client_id') as string);
  const kind = formData.get('kind') as string;
  const audience_role = ((formData.get('audience_role') as string) || '').trim() || null;
  const party = ((formData.get('party') as string) || '').trim() || null;
  const raw = ((formData.get('values') as string) || '').slice(0, 20000);

  if (!Number.isInteger(clientId) || clientId <= 0) return;
  if (!(kind === 'x_account' || kind === 'x_keyword' || kind === 'rss')) return;

  const values = parseBulkValues(raw, kind);
  if (values.length === 0) {
    redirect(`/watchlist?msg=${encodeURIComponent('no valid handles in input')}`);
  }

  const { inserted, skipped, updated } = await applyHandlesToWatchlist({
    clientId, kind, values, audience_role, party,
  });

  revalidatePath('/watchlist');
  const tags = [audience_role && `role: ${audience_role}`, party && `party: ${party}`].filter(Boolean).join(', ');
  redirect(
    `/watchlist?msg=${encodeURIComponent(
      `Added ${inserted} new${updated > 0 ? `, updated ${updated} existing` : ''}${skipped > 0 ? `, skipped ${skipped}` : ''}${tags ? ` (${tags})` : ''}`,
    )}`,
  );
}

async function importFromList(formData: FormData) {
  'use server';
  const clientId = parseInt(formData.get('client_id') as string);
  const audience_role = ((formData.get('audience_role') as string) || '').trim() || null;
  const party = ((formData.get('party') as string) || '').trim() || null;
  const listInput = ((formData.get('list_url') as string) || '').trim();

  const listId = parseListId(listInput);
  if (!Number.isInteger(clientId) || clientId <= 0 || !listId) {
    redirect(`/watchlist?msg=${encodeURIComponent('list id missing or invalid')}`);
  }

  let result;
  try {
    result = await fetchListMembers({ listId: listId!, maxPages: 30 });
  } catch (err: any) {
    redirect(`/watchlist?msg=${encodeURIComponent(`list fetch failed: ${(err.message || '').slice(0, 200)}`)}`);
  }

  const handles = result!.members.map(m => m.userName).filter(Boolean);
  if (handles.length === 0) {
    redirect(`/watchlist?msg=${encodeURIComponent('list returned 0 members')}`);
  }

  const { inserted, skipped, updated } = await applyHandlesToWatchlist({
    clientId,
    kind: 'x_account',
    values: handles,
    audience_role,
    party,
  });

  revalidatePath('/watchlist');
  const tags = [audience_role && `role: ${audience_role}`, party && `party: ${party}`].filter(Boolean).join(', ');
  const cap = result!.cappedAt ? ` (capped at ${result!.cappedAt})` : '';
  redirect(
    `/watchlist?msg=${encodeURIComponent(
      `List ${listId}: fetched ${handles.length}${cap} across ${result!.pages} pages → added ${inserted}${updated > 0 ? `, updated ${updated}` : ''}${skipped > 0 ? `, skipped ${skipped}` : ''}${tags ? ` (${tags})` : ''}`,
    )}`,
  );
}

async function toggle(id: number, active: boolean) {
  'use server';
  await sql`UPDATE watchlist SET active = ${!active} WHERE id = ${id}`;
  revalidatePath('/watchlist');
}

async function deleteRow(id: number) {
  'use server';
  await sql`DELETE FROM watchlist WHERE id = ${id}`;
  revalidatePath('/watchlist');
}

async function bulkDeleteByGroup(formData: FormData) {
  'use server';
  const clientId = parseInt(formData.get('client_id') as string);
  const kind = formData.get('kind') as string;
  const audience_role = ((formData.get('audience_role') as string) || '') || null;
  const party = ((formData.get('party') as string) || '') || null;
  if (!Number.isInteger(clientId) || clientId <= 0) return;

  if (audience_role && party) {
    await sql`DELETE FROM watchlist WHERE client_id = ${clientId} AND kind = ${kind} AND audience_role = ${audience_role} AND party = ${party}`;
  } else if (audience_role) {
    await sql`DELETE FROM watchlist WHERE client_id = ${clientId} AND kind = ${kind} AND audience_role = ${audience_role} AND party IS NULL`;
  } else if (party) {
    await sql`DELETE FROM watchlist WHERE client_id = ${clientId} AND kind = ${kind} AND audience_role IS NULL AND party = ${party}`;
  } else {
    await sql`DELETE FROM watchlist WHERE client_id = ${clientId} AND kind = ${kind} AND audience_role IS NULL AND party IS NULL`;
  }
  revalidatePath('/watchlist');
}

export default async function Watchlist({ searchParams }: { searchParams: { msg?: string } }) {
  const current = await getCurrentClient();
  if (!current) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <p className="opacity-60">No clients configured. <Link href="/clients" className="underline">Add one</Link>.</p>
      </main>
    );
  }

  const items = await sql`
    SELECT w.*, c.name as client_name
    FROM watchlist w JOIN clients c ON c.id = w.client_id
    WHERE w.client_id = ${current.id}
    ORDER BY w.kind, w.party NULLS LAST, w.audience_role NULLS LAST, w.value
  `;
  const clients = await sql`SELECT id, name, mode FROM clients ORDER BY name`;

  // Group items: kind | party | audience_role
  const byGroup = new Map<string, any[]>();
  for (const row of items.rows) {
    const k = `${row.kind}|${row.party || ''}|${row.audience_role || ''}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(row);
  }

  // Header role/party counts (x_account only)
  const accounts = items.rows.filter((r: any) => r.kind === 'x_account');
  const roleCounts: Record<string, number> = {};
  const partyCounts: Record<string, number> = {};
  for (const a of accounts) {
    const r = a.audience_role || 'unrolled';
    roleCounts[r] = (roleCounts[r] || 0) + 1;
    const p = a.party || 'unsided';
    partyCounts[p] = (partyCounts[p] || 0) + 1;
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4 text-xs">
        <Link href="/" className="underline opacity-60">← back to feed</Link>
        <div className="space-x-3 opacity-60">
          {current.mode === 'intelligence' && (
            <Link href="/briefing" className="underline">Briefing</Link>
          )}
          <Link href="/clients" className="underline">Clients</Link>
        </div>
      </div>

      <div className="flex justify-between items-baseline mb-2">
        <h1 className="text-2xl font-bold">{current.name} · Watchlist</h1>
        <span className="text-xs opacity-50">{items.rows.length} items</span>
      </div>

      {accounts.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3 text-xs">
          <div className="flex flex-wrap gap-1.5">
            <span className="opacity-50">Roles:</span>
            {Object.entries(roleCounts).map(([r, n]) => (
              <span key={r} className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
                {r}: {n}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="opacity-50">Sides:</span>
            {Object.entries(partyCounts).map(([p, n]) => (
              <span key={p} className={`px-2 py-0.5 rounded border ${partyClass(p)}`}>
                {p}: {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {searchParams.msg && (
        <div className="mb-4 border border-green-500/30 bg-green-500/5 rounded p-3 text-sm">
          {searchParams.msg}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <form action={bulkAdd} className="space-y-3 border border-neutral-800 rounded p-4">
          <h3 className="font-bold">Add watch items (paste)</h3>
          <p className="text-xs opacity-60">
            1–500 entries, comma- or newline-separated. <code>@</code> and <code>x.com/</code> URLs stripped automatically.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <select name="client_id" required defaultValue={current.id} className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              {clients.rows.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.mode})</option>
              ))}
            </select>
            <select name="kind" required defaultValue="x_account" className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              <option value="x_account">X account</option>
              <option value="x_keyword">X keyword/phrase</option>
            </select>
            <select name="audience_role" defaultValue="" className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              {AUDIENCE_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <select name="party" defaultValue="" className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              {PARTIES.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <textarea
            name="values"
            required
            rows={5}
            placeholder={`@nytimes\n@maggienyt, @kasie\nrokhanna`}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm font-mono"
          />
          <button type="submit" className="bg-white text-black px-4 py-2 rounded text-sm font-bold">
            Add to watchlist
          </button>
        </form>

        <form action={importFromList} className="space-y-3 border border-purple-500/30 bg-purple-500/5 rounded p-4">
          <h3 className="font-bold">Import from X List</h3>
          <p className="text-xs opacity-60">
            Paste an X list URL (<code>https://x.com/i/lists/...</code>) or just the numeric list ID. Pulls every member, dedupes against existing rows, applies role + side to the whole batch.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <select name="client_id" required defaultValue={current.id} className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              {clients.rows.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.mode})</option>
              ))}
            </select>
            <span />
            <select name="audience_role" defaultValue="" className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              {AUDIENCE_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <select name="party" defaultValue="" className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm">
              {PARTIES.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <input
            name="list_url"
            required
            placeholder="https://x.com/i/lists/1621268368039854085"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm font-mono"
          />
          <button type="submit" className="bg-purple-500 text-white px-4 py-2 rounded text-sm font-bold hover:bg-purple-400">
            Fetch + import
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {Array.from(byGroup.entries()).map(([key, rows]) => {
          const [kind, party, role] = key.split('|');
          return (
            <section key={key}>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs uppercase tracking-wider opacity-50">
                  {kind}
                  {party && <> · <span className={partyTextClass(party)}>{party}</span></>}
                  {role && <> · {role}</>}
                  <span className="ml-2 opacity-60">({rows.length})</span>
                </div>
                <span className="flex-1" />
                <form action={bulkDeleteByGroup}>
                  <input type="hidden" name="client_id" value={current.id} />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="audience_role" value={role} />
                  <input type="hidden" name="party" value={party} />
                  <button
                    type="submit"
                    className="text-[10px] uppercase tracking-wider opacity-40 hover:opacity-100 hover:text-red-300"
                  >
                    delete group
                  </button>
                </form>
              </div>
              <div className="space-y-1">
                {rows.map((i: any) => (
                  <div
                    key={i.id}
                    className={`border border-neutral-800 rounded px-3 py-2 flex items-center justify-between gap-2 text-sm ${!i.active ? 'opacity-40' : ''}`}
                  >
                    <code className="flex-1 truncate">{i.value}</code>
                    <RowEditor id={i.id} role={i.audience_role} party={i.party} />
                    <form action={async () => { 'use server'; await toggle(i.id, i.active); }}>
                      <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">
                        {i.active ? 'pause' : 'enable'}
                      </button>
                    </form>
                    <form action={async () => { 'use server'; await deleteRow(i.id); }}>
                      <button type="submit" className="text-xs opacity-50 hover:opacity-100 hover:text-red-300">
                        ✕
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function partyClass(p: string): string {
  if (p === 'D') return 'border-blue-500/40 bg-blue-500/10 text-blue-200';
  if (p === 'R') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (p === 'I') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200';
  return 'border-neutral-800 bg-neutral-900';
}

function partyTextClass(p: string): string {
  if (p === 'D') return 'text-blue-300';
  if (p === 'R') return 'text-red-300';
  if (p === 'I') return 'text-yellow-300';
  return '';
}

function RowEditor({ id, role, party }: { id: number; role: string | null; party: string | null }) {
  return (
    <form
      action={async (fd: FormData) => {
        'use server';
        const newRole = ((fd.get('audience_role') as string) || '').trim() || null;
        const newParty = ((fd.get('party') as string) || '').trim() || null;
        await sql`UPDATE watchlist SET audience_role = ${newRole}, party = ${newParty} WHERE id = ${id}`;
        revalidatePath('/watchlist');
      }}
      className="flex items-center gap-1.5"
    >
      <select
        name="audience_role"
        defaultValue={role || ''}
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-xs"
      >
        {AUDIENCE_ROLES.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <select
        name="party"
        defaultValue={party || ''}
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-xs"
      >
        {PARTIES.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">save</button>
    </form>
  );
}
