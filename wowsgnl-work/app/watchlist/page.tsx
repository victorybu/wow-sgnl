import { sql } from '@/lib/db';
import { revalidatePath } from 'next/cache';

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
  const items = await sql`SELECT w.*, c.name as client_name FROM watchlist w JOIN clients c ON c.id = w.client_id ORDER BY c.name, w.kind`;
  const clients = await sql`SELECT * FROM clients ORDER BY name`;
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Watchlist</h1>
      <div className="space-y-2 mb-8">
        {items.rows.map((i: any) => (
          <form key={i.id} action={async () => { 'use server'; await toggle(i.id, i.active); }} className={`border border-neutral-800 rounded p-3 flex justify-between items-center ${!i.active && 'opacity-40'}`}>
            <span className="text-sm">{i.client_name} · {i.kind} · <code>{i.value}</code></span>
            <button type="submit" className="text-xs underline">{i.active ? 'pause' : 'enable'}</button>
          </form>
        ))}
      </div>
      <form action={addItem} className="space-y-3 border border-neutral-800 rounded p-4">
        <h3 className="font-bold">Add watch item</h3>
        <select name="client_id" required className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2">
          {clients.rows.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
