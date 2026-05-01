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
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'drafting'`;
  await sql`UPDATE clients SET mode = 'drafting' WHERE mode IS NULL`;
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
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS original_content TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS voice_examples (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      source_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
      source_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      context TEXT,
      angle TEXT,
      original_draft TEXT,
      was_edited BOOLEAN DEFAULT FALSE,
      weight INTEGER DEFAULT 1,
      notes TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS voice_examples_client_idx ON voice_examples(client_id, weight DESC, added_at DESC);`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS voice_examples_unique_post ON voice_examples(source_post_id) WHERE source_post_id IS NOT NULL;`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS engagement_24h JSONB`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS engagement_velocity NUMERIC`;
  await sql`CREATE INDEX IF NOT EXISTS voice_examples_velocity_idx ON voice_examples(client_id, engagement_velocity DESC NULLS LAST);`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS shipped_tweet_id TEXT`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS engagement_7d JSONB`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS engagement_fetched_at TIMESTAMPTZ`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS auto_weight_reason TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS voice_examples_shipped_tweet_idx ON voice_examples(shipped_tweet_id) WHERE shipped_tweet_id IS NOT NULL;`;
  await sql`ALTER TABLE voice_examples ADD COLUMN IF NOT EXISTS source_draft_id INTEGER REFERENCES drafts(id) ON DELETE SET NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS voice_examples_unique_draft ON voice_examples(source_draft_id) WHERE source_draft_id IS NOT NULL;`;
  await sql`CREATE INDEX IF NOT EXISTS voice_examples_anti_idx ON voice_examples(client_id, added_at DESC) WHERE weight = -1;`;
  await sql`
    CREATE TABLE IF NOT EXISTS top_pick_clusters (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      signature TEXT NOT NULL,
      clusters JSONB NOT NULL,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(client_id)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS top_pick_clusters_client_idx ON top_pick_clusters(client_id);`;
  await sql`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS audience_role TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS watchlist_audience_role_idx ON watchlist(client_id, audience_role) WHERE audience_role IS NOT NULL;`;
  await sql`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS party TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS watchlist_party_idx ON watchlist(client_id, party) WHERE party IS NOT NULL;`;
  await sql`
    CREATE TABLE IF NOT EXISTS briefings (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      briefing_date DATE NOT NULL,
      content JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(client_id, briefing_date)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS briefings_client_date_idx ON briefings(client_id, briefing_date DESC);`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS sentiment TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS topic_tags TEXT[]`;
  await sql`CREATE INDEX IF NOT EXISTS events_sentiment_idx ON events(client_id, sentiment) WHERE sentiment IS NOT NULL;`;
  await sql`CREATE INDEX IF NOT EXISTS events_topic_tags_idx ON events USING GIN (topic_tags) WHERE topic_tags IS NOT NULL;`;
  // Idempotent: backfill Polymarket priority_topics with Kalshi (the
  // competitor) and direct-name terms so the relevance scorer fires
  // on tweets actually mentioning the product.
  await sql`
    UPDATE clients
    SET priority_topics = 'prediction markets, polymarket, kalshi, prediction market regulation, election odds, betting volume, political risk, CFTC, DC chatter on prediction markets'
    WHERE name = 'Polymarket' AND priority_topics NOT LIKE '%kalshi%'
  `;
}
