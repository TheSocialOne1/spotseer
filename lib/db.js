import path from "path";

// One SQL code path everywhere: hosted Postgres (Neon, via DATABASE_URL) in
// production, an embedded Postgres (PGlite, stored in .pglite/) in local dev.
async function connect() {
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    return (text, params) => sql.query(text, params);
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(path.join(process.cwd(), ".pglite"));
  return async (text, params) => (await pg.query(text, params)).rows;
}

// Events are an append-only log: nothing is edited except claim/corroboration
// bookkeeping. That log is the long-term asset — occupancy, turnover, and
// search-time analytics are all derived from it later.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    first_seen_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    reports INT NOT NULL DEFAULT 0,
    claimed INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy_m REAL,
    geohash TEXT NOT NULL,
    street TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    corroborates TEXT,
    corroborations INT NOT NULL DEFAULT 0,
    claimed_at BIGINT,
    claimed_by_session TEXT,
    ip_hash TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_live ON events (expires_at) WHERE claimed_at IS NULL AND corroborates IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_device ON events (device_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_geohash ON events (geohash, created_at)`,
  `CREATE TABLE IF NOT EXISTS search_sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    start_lat DOUBLE PRECISION,
    start_lng DOUBLE PRECISION,
    last_lat DOUBLE PRECISION,
    last_lng DOUBLE PRECISION,
    last_seen_at BIGINT,
    ended_at BIGINT,
    end_lat DOUBLE PRECISION,
    end_lng DOUBLE PRECISION,
    outcome TEXT,
    used_event_id TEXT,
    baseline_minutes INT,
    alerts_sent INT NOT NULL DEFAULT 0,
    last_alert_at BIGINT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_open ON search_sessions (started_at) WHERE ended_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_device ON search_sessions (device_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS device_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_push_device ON push_subscriptions (device_id)`,
];

async function init() {
  const run = await connect();
  for (const statement of SCHEMA) {
    await run(statement, []);
  }
  return run;
}

// Cached on globalThis so dev hot-reloads don't open a second PGlite on the
// same directory, and serverless instances run migrations once per cold start.
export async function query(text, params = []) {
  globalThis.__spotseerDb ??= init().catch((err) => {
    globalThis.__spotseerDb = undefined;
    throw err;
  });
  const run = await globalThis.__spotseerDb;
  return run(text, params);
}
