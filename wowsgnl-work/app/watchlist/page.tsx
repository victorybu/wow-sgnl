import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/clients';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function addItem(formData: FormData) {
  'use server';
  await sql`INSERT INTO watchlist (client_id, kind, value)
    VALUES (${parseInt(formData.get('client_id') as string)}, ${formData.get('kind') as string}, ${formData.get('value') as string})`;
  revalidatePath('/watchlist');
}

async function toggle(id: number, active: boolean) {
  'use server';
  await sql`UPDATE watchlist SET active = ${!active} WHERE id = ${id}`;
  revalidatePath('/watchlist');
}

export default async function Watchlist() {
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
    ORDER BY w.kind, w.value
  `;
  const clients = await sql`SELECT id, name, mode FROM clients ORDER BY name`;

  return (
    <main className="max-w-3xl mx-auto p-8">
      <div className="flex justify-between items-baseline mb-6">
        <h1 className="text-2xl font-bold">{current.name} · Watchlist</h1>
        <span className="text-xs opacity-50">{items.rows.length} items</span>
      </div>
      <div className="space-y-2 mb-8">
        {items.rows.length === 0 && (
          <p className="text-sm opacity-50">No watchers yet for {current.name}. Add one below.</p>
        )}
        {items.rows.map((i: any) => (
          <form key={i.id} action={async () => { 'use server'; await toggle(i.id, i.active); }} className={`border border-neutral-800 rounded p-3 flex justify-between items-center ${!i.active && 'opacity-40'}`}>
            <span className="text-sm">{i.kind} · <code>{i.value}</code></span>
            <button type="submit" className="text-xs underline">{i.active ? 'pause' : 'enable'}</button>
          </form>
        ))}
      </div>
      <form action={addItem} className="space-y-3 border border-neutral-800 rounded p-4">
        <h3 className="font-bold">Add watch item</h3>
        <select name="client_id" required defaultValue={current.id} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2">
          {clients.rows.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} ({c.mode})</option>
          ))}
        </select>
        <select name="kind" required className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2">
          <option value="x_account">X account (no @)</option>
          <option value="x_keyword">X keyword/search</option>
        </select>
        <input name="value" placeholder="username or keyword" required className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2" />
        <button type="submit" className="bg-white text-black px-4 py-2 rounded text-sm font-bold">Add</button>
      </form>
    </main>
  );
}
