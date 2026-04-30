import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  throw new Error('DATABASE_URL or POSTGRES_URL must be set');
}

export const sql: any = neon(url, { fullResults: true });

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
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback_reason TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback_note TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS ratings_history (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      rating TEXT NOT NULL,
      reason TEXT,
      note TEXT,
      rated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS ratings_history_event_idx ON ratings_history(event_id);`;
  await sql`CREATE INDEX IF NOT EXISTS ratings_history_rated_at_idx ON ratings_history(rated_at DESC);`;
}
