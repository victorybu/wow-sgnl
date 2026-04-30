import { cookies } from 'next/headers';
import { sql } from './db';

export type ClientMode = 'drafting' | 'intelligence';

export type Client = {
  id: number;
  name: string;
  mode: ClientMode;
  voice_profile: string | null;
  priority_topics: string | null;
};

export const CLIENT_COOKIE = 'signal_client_id';

/**
 * Resolve the user's currently-active client. Reads the
 * `signal_client_id` cookie; falls back to the lowest-id client
 * (Khanna at id=1 in the canonical setup) if cookie is missing
 * or refers to a deleted/unknown client.
 */
export async function getCurrentClient(): Promise<Client | null> {
  const cookieStore = cookies();
  const requested = cookieStore.get(CLIENT_COOKIE)?.value;

  if (requested && /^\d+$/.test(requested)) {
    const r = await sql`
      SELECT id, name, mode, voice_profile, priority_topics
      FROM clients WHERE id = ${parseInt(requested)}
    `;
    if (r.rows.length > 0) return r.rows[0] as Client;
  }

  const r = await sql`
    SELECT id, name, mode, voice_profile, priority_topics
    FROM clients ORDER BY id LIMIT 1
  `;
  return (r.rows[0] as Client) || null;
}

/**
 * Get just the id of the current client, with a single fallback
 * query — convenience for routes that don't need full client data.
 */
export async function getCurrentClientId(): Promise<number | null> {
  const c = await getCurrentClient();
  return c?.id ?? null;
}

export async function listClients(): Promise<Client[]> {
  const r = await sql`
    SELECT id, name, mode, voice_profile, priority_topics
    FROM clients ORDER BY id
  `;
  return r.rows as Client[];
}
