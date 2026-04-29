import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

async function addClient(formData: FormData) {
  'use server';
  await sql`INSERT INTO clients (name, voice_profile, priority_topics)
    VALUES (${formData.get('name') as string}, ${formData.get('voice') as string}, ${formData.get('topics') as string})
    ON CONFLICT (name) DO UPDATE SET voice_profile = EXCLUDED.voice_profile, priority_topics = EXCLUDED.priority_topics`;
  revalidatePath('/clients');
}

export default async function Clients() {
  const clients = await sql`SELECT * FROM clients ORDER BY name`;
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Clients</h1>
      <div className="space-y-4 mb-8">
        {clients.rows.map((c: any) => (
          <div key={c.id} className="border border-neutral-800 rounded p-4">
            <h2 className="font-bold">{c.name}</h2>
            <p className="text-xs opacity-60 mt-1">Topics: {c.priority_topics}</p>
            <p className="text-xs opacity-60 mt-1 line-clamp-2">Voice: {c.voice_profile}</p>
          </div>
        ))}
      </div>
      <form action={addClient} className="space-y-3 border border-neutral-800 rounded p-4">
        <h3 className="font-bold">Add / update client</h3>
        <input name="name" placeholder="Name (e.g. Khanna)" required className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2" />
        <textarea name="topics" placeholder="Priority topics, comma separated" rows={2} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2" />
        <textarea name="voice" placeholder="Voice profile + 5-10 example posts. Be specific about cadence, vocabulary, what they DO and DON'T say." rows={10} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-xs" />
        <button type="submit" className="bg-white text-black px-4 py-2 rounded text-sm font-bold">Save</button>
      </form>
    </main>
  );
}
