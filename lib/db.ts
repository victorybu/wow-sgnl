import { sql } from '@vercel/postgres';

export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      voice_profile TEXT,
      priority_topics TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('x_account','x_keyword','rss')),
      value TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      author TEXT,
      content TEXT NOT NULL,
      url TEXT,
      posted_at TIMESTAMPTZ,
      relevance_score INTEGER,
      relevance_reason TEXT,
      status TEXT DEFAULT 'new' CHECK (status IN ('new','ignored','drafted','shipped')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(source, source_id)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS events_score_idx ON events(relevance_score DESC, created_at DESC);`;
  await sql`
    CREATE TABLE IF NOT EXISTS drafts (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      angle TEXT,
      platform TEXT,
      content TEXT,
      shipped BOOLEAN DEFAULT FALSE,
      shipped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
}
