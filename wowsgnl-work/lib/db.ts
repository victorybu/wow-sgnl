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
  await sql`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS last_seen_source_id TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback_reason TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS feedback_note TEXT`;
  await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS feedback TEXT`;
  await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ`;
  await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS feedback_reason TEXT`;
  await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS feedback_note TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
      position INTEGER,
      content TEXT NOT NULL,
      platform TEXT,
      shipped BOOLEAN DEFAULT FALSE,
      shipped_at TIMESTAMPTZ,
      feedback TEXT,
      feedback_at TIMESTAMPTZ,
      feedback_reason TEXT,
      feedback_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS posts_draft_idx ON posts(draft_id);`;
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
  await sql`ALTER TABLE ratings_history ADD COLUMN IF NOT EXISTS kind TEXT`;
  await sql`ALTER TABLE ratings_history ADD COLUMN IF NOT EXISTS target_id INTEGER`;
  await sql`ALTER TABLE ratings_history ALTER COLUMN kind SET DEFAULT 'event'`;
  await sql`ALTER TABLE ratings_history ALTER COLUMN event_id DROP NOT NULL`;
  await sql`UPDATE ratings_history SET kind='event', target_id=event_id WHERE kind IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS ratings_history_event_idx ON ratings_history(event_id);`;
  await sql`CREATE INDEX IF NOT EXISTS ratings_history_target_idx ON ratings_history(kind, target_id);`;
  await sql`CREATE INDEX IF NOT EXISTS ratings_history_rated_at_idx ON ratings_history(rated_at DESC);`;
}
