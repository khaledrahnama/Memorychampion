import { config, isProduction } from "./config.js";

// Tiny query layer over either a real Postgres (pg Pool — Neon/Vercel Postgres
// in production) or PGlite (embedded WASM Postgres — zero-setup local dev).
// Both speak the same SQL with $1-style parameters.

type Row = Record<string, any>;

interface Driver {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  // Runs `fn` with exclusive access (used for migrations only).
  exclusive<T>(fn: (q: Driver["query"]) => Promise<T>): Promise<T>;
}

let driverPromise: Promise<Driver> | undefined;

async function createDriver(): Promise<Driver> {
  if (config.databaseUrl) {
    const { default: pg } = await import("pg");
    // NUMERIC columns hold wei amounts; keep them as strings (no float precision loss).
    pg.types.setTypeParser(1700, (v: string) => v);
    pg.types.setTypeParser(20, (v: string) => Number(v)); // BIGINT (unix seconds, ids) fits in a JS number
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 5) });
    return {
      query: async (text, params) => (await pool.query(text, params as any[])).rows,
      exclusive: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("SELECT pg_advisory_lock(424242)");
          return await fn(async (t, p) => (await client.query(t, p as any[])).rows);
        } finally {
          await client.query("SELECT pg_advisory_unlock(424242)").catch(() => {});
          client.release();
        }
      }
    };
  }

  if (isProduction) {
    throw new Error("DATABASE_URL is not set. Add a Postgres database (e.g. Neon from the Vercel Marketplace) and redeploy.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { types } = await import("@electric-sql/pglite");
  const db = new PGlite(config.pgliteDir, {
    parsers: {
      [types.NUMERIC]: (v: string) => v,
      [types.INT8]: (v: string) => Number(v)
    }
  });
  const query: Driver["query"] = async (text, params) => (await db.query<Row>(text, params as any[])).rows;
  return { query, exclusive: (fn) => fn(query) };
}

async function getDriver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = (async () => {
      const driver = await createDriver();
      await driver.exclusive(migrate);
      return driver;
    })().catch((err) => {
      driverPromise = undefined; // allow a retry on the next request
      throw err;
    });
  }
  return driverPromise;
}

export async function query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await getDriver()).query(text, params) as Promise<T[]>;
}

export async function queryOne<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

async function migrate(q: Driver["query"]) {
  await q(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      code_hash TEXT,
      code_expires_at BIGINT,
      code_attempts INT NOT NULL DEFAULT 0,
      code_sent_at BIGINT,
      nickname TEXT,
      nickname_key TEXT UNIQUE,
      wallet_address TEXT UNIQUE,
      wallet_nonce TEXT,
      created_at BIGINT NOT NULL
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      onchain_game_id BIGINT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      start_time BIGINT NOT NULL,
      rounds_count INT NOT NULL,
      photo_seconds INT NOT NULL,
      question_seconds INT NOT NULL,
      entry_fee_wei NUMERIC NOT NULL DEFAULT 0,
      cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      finalize_state TEXT NOT NULL DEFAULT 'pending',
      finalize_started_at BIGINT,
      finalize_tx TEXT,
      winners_count INT,
      reward_per_winner_wei NUMERIC,
      rewards_root TEXT,
      created_tx TEXT,
      created_at BIGINT NOT NULL
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS game_rounds (
      game_id TEXT NOT NULL REFERENCES games(id),
      round_index INT NOT NULL,
      scene_id TEXT,
      photo TEXT NOT NULL,
      question TEXT NOT NULL,
      options JSONB NOT NULL,
      correct_index INT NOT NULL,
      PRIMARY KEY (game_id, round_index)
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS game_participants (
      game_id TEXT NOT NULL REFERENCES games(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      wallet_address TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      score INT,
      reward_wei NUMERIC,
      PRIMARY KEY (game_id, account_id)
    )`);
  await q(`ALTER TABLE game_participants ADD COLUMN IF NOT EXISTS join_tx TEXT`);
  await q(`
    CREATE TABLE IF NOT EXISTS game_answers (
      game_id TEXT NOT NULL REFERENCES games(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      round_index INT NOT NULL,
      option_index INT NOT NULL,
      answered_at BIGINT NOT NULL,
      PRIMARY KEY (game_id, account_id, round_index)
    )`);
}
