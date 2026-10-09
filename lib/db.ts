import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getClient(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add a Postgres (Neon) connection string in your Vercel project settings.");
  }
  client ??= neon(process.env.DATABASE_URL);
  return client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scans (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    trigger TEXT NOT NULL DEFAULT 'manual',
    headlines INTEGER NOT NULL DEFAULT 0,
    markets INTEGER NOT NULL DEFAULT 0,
    candidates INTEGER NOT NULL DEFAULT 0,
    signals INTEGER NOT NULL DEFAULT 0,
    passes INTEGER NOT NULL DEFAULT 0,
    trades_opened INTEGER NOT NULL DEFAULT 0,
    ai_used BOOLEAN NOT NULL DEFAULT false,
    feeds JSONB,
    notes TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS headlines (
    id TEXT PRIMARY KEY,
    region TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    matched INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS headlines_published_idx ON headlines (published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS signals (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    headline_id TEXT NOT NULL,
    headline TEXT NOT NULL,
    headline_url TEXT NOT NULL,
    source TEXT NOT NULL,
    region TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    venue TEXT NOT NULL,
    market_id TEXT NOT NULL,
    market_question TEXT NOT NULL,
    market_url TEXT NOT NULL,
    closes_at TIMESTAMPTZ,
    side INTEGER,
    side_label TEXT,
    market_price DOUBLE PRECISION,
    fair_prob DOUBLE PRECISION,
    edge DOUBLE PRECISION,
    confidence DOUBLE PRECISION,
    match_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    reasoning TEXT,
    checks JSONB NOT NULL DEFAULT '[]'::jsonb,
    verdict TEXT NOT NULL,
    UNIQUE (headline_id, venue, market_id)
  )`,
  `CREATE INDEX IF NOT EXISTS signals_created_idx ON signals (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    signal_id INTEGER,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    venue TEXT NOT NULL,
    market_id TEXT NOT NULL,
    market_question TEXT NOT NULL,
    market_url TEXT NOT NULL,
    side INTEGER NOT NULL,
    side_label TEXT NOT NULL,
    entry_price DOUBLE PRECISION NOT NULL,
    shares DOUBLE PRECISION NOT NULL,
    stake DOUBLE PRECISION NOT NULL,
    fees DOUBLE PRECISION NOT NULL DEFAULT 0,
    fee_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    mark_price DOUBLE PRECISION,
    marked_at TIMESTAMPTZ,
    exit_price DOUBLE PRECISION,
    closed_at TIMESTAMPTZ,
    pnl DOUBLE PRECISION,
    auto BOOLEAN NOT NULL DEFAULT false,
    note TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS trades_status_idx ON trades (status)`,
  `CREATE TABLE IF NOT EXISTS equity (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    equity DOUBLE PRECISION NOT NULL,
    realized DOUBLE PRECISION NOT NULL,
    unrealized DOUBLE PRECISION NOT NULL,
    open_positions INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
  )`,
];

export function db(): NeonQueryFunction<false, false> {
  return getClient();
}

/** Run the idempotent schema once per server instance. */
export async function ready(): Promise<NeonQueryFunction<false, false>> {
  const sql = getClient();
  schemaReady ??= (async () => {
    for (const stmt of SCHEMA) await sql.query(stmt);
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  await schemaReady;
  return sql;
}
