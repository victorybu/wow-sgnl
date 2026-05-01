import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
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

// Split comma- and newline-separated input. For x_account, also handles
// pasted "@handle, @handle" lists; for x_keyword we keep multi-word
// phrases intact and only split on commas/newlines.
function parseBulkValues(raw: string, kind: string): string[] {
  if (!raw) return [];
  // Split on comma or newline (NOT spaces — keywords can be multi-word).
  const parts = raw.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
  const cleaned = parts.map(p => {
    if (kind === 'x_account') {
      // Strip @ prefix, lowercase, drop https://x.com/ prefix if pasted.
      let v = p.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '');
      v = v.replace(/^@+/, '').split(/[\/?#]/)[0].trim().toLowerCase();
      return v;
    }
    return p;
  }).filter(Boolean);
  // Dedupe within the input itself (preserve first occurrence).
  return Array.from(new Set(cleaned));
}

async function bulkAdd(formData: FormData) {
  'use server';
  const clientId = parseInt(formData.get('client_id') as string);
  const kind = formData.get('kind') as string;
  const audience_role = ((formData.get('audience_role') as string) || '').trim() || null;
  const raw = ((formData.get('values') as string) || '').slice(0, 20000);

  if (!Number.isInteger(clientId) || clientId <= 0) return;
  if (!(kind === 'x_account' || kind === 'x_keyword' || kind === 'rss')) return;

  const values = parseBulkValues(raw, kind);
  if (values.length === 0) {
    redirect(`/watchlist?msg=${encodeURIComponent('no valid handles in input')}`);
  }

  // Pull existing values for this client+kind so we can dedupe and report
  // accurately on what was actually new. For x_account these are already
  // lowercase coming in; legacy rows may not be — lowercase here for
  // comparison only.
  const existing = await sql`
    SELECT value FROM watchlist WHERE client_id = ${clientId} AND kind = ${kind}
  `;
  const existingSet = new Set<string>(
    existing.rows.map((r: any) => kind === 'x_account' ? String(r.value).toLowerCase() : String(r.value)),
  );
  const fresh = values.filter(v => !existingSet.has(v));

  let inserted = 0;
  for (const v of fresh) {
    await sql`
      INSERT INTO watchlist (client_id, kind, value, audience_role)
      VALUES (${clientId}, ${kind}, ${v}, ${audience_role})
    `;
    inserted++;
  }

  // If audience_role was set on the form, also backfill any of the already-
  // existing rows in this batch (so re-pasting an old list with a role
  // attached works as "tag these accounts with role X").
  if (audience_role) {
    const already = values.filter(v => existingSet.has(v));
    for (const v of already) {
      await sql`
        UPDATE watchlist SET audience_role = ${audience_role}
        WHERE client_id = ${clientId} AND kind = ${kind} AND value = ${v}
      `;
    }
  }

  revalidatePath('/watchlist');
  const skipped = values.length - inserted;
  redirect(
    `/watchlist?msg=${encodeURIComponent(
      `Added ${inserted} new${skipped > 0 ? `, skipped ${skipped} dup` : ''}${audience_role ? ` (role: ${audience_role})` : ''}`,
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
    ORDER BY w.kind, w.audience_role NULLS LAST, w.value
  `;
  const clients = await sql`SELECT id, name, mode FROM clients ORDER BY name`;

  // Group items for cleaner rendering: by kind, then within kind by role.
  const byKindRole = new Map<string, any[]>();
  for (const row of items.rows) {
    const k = `${row.kind}|${row.audience_role || ''}`;
    if (!byKindRole.has(k)) byKindRole.set(k, []);
    byKindRole.get(k)!.push(row);
  }

  // Stat row: count by audience_role within x_account
  const accounts = items.rows.filter((r: any) => r.kind === 'x_account');
  const roleCounts: Record<string, number> = {};
  for (const a of accounts) {
    const r = a.audience_role || 'unrolled';
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
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
        <div className="mb-6 text-xs opacity-60 flex flex-wrap gap-3">
          {Object.entries(roleCounts).map(([r, n]) => (
            <span key={r} className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800">
              {r}: {n}
            </span>
          ))}
        </div>
      )}

      {searchParams.msg && (
        <div className="mb-4 border border-green-500/30 bg-green-500/5 rounded p-3 text-sm">
          {searchParams.msg}
        </div>
      )}

      <form action={bulkAdd} className="space-y-3 border border-neutral-800 rounded p-4 mb-8">
        <h3 className="font-bold">Add watch items (bulk)</h3>
        <p className="text-xs opacity-60">
          Paste 1–500 handles separated by commas or newlines. <code>@</code> prefix and <code>x.com/</code>
          URLs are stripped automatically. Existing handles are skipped (their audience role gets
          updated if you set one).
        </p>
        <div className="grid grid-cols-3 gap-3">
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
        </div>
        <textarea
          name="values"
          required
          rows={6}
          placeholder={`@nytimes\n@maggienyt, @kasie\nrokhanna\nhttps://x.com/atrupar`}
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm font-mono"
        />
        <button type="submit" className="bg-white text-black px-4 py-2 rounded text-sm font-bold">
          Add to watchlist
        </button>
      </form>

      <div className="space-y-4">
        {Array.from(byKindRole.entries()).map(([key, rows]) => {
          const [kind, role] = key.split('|');
          return (
            <section key={key}>
              <div className="text-xs uppercase tracking-wider opacity-50 mb-2">
                {kind}{role ? ` · ${role}` : ''} ({rows.length})
              </div>
              <div className="space-y-1">
                {rows.map((i: any) => (
                  <div
                    key={i.id}
                    className={`border border-neutral-800 rounded px-3 py-2 flex items-center justify-between gap-2 text-sm ${!i.active ? 'opacity-40' : ''}`}
                  >
                    <code className="flex-1 truncate">{i.value}</code>
                    <RoleEditor id={i.id} current={i.audience_role} />
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

// Per-row role editor — submits via its own server action so the dropdown
// "save" is one click. The parent `setRole` is reused.
function RoleEditor({ id, current }: { id: number; current: string | null }) {
  return (
    <form
      action={async (fd: FormData) => {
        'use server';
        const newRole = ((fd.get('audience_role') as string) || '').trim() || null;
        await sql`UPDATE watchlist SET audience_role = ${newRole} WHERE id = ${id}`;
        revalidatePath('/watchlist');
      }}
      className="contents"
    >
      <select
        name="audience_role"
        defaultValue={current || ''}
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-xs"
      >
        {AUDIENCE_ROLES.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">save role</button>
    </form>
  );
}
