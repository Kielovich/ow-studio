import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded via getBuiltinModule so no bundler (Turbopack, Vite) tries to resolve "node:sqlite" itself.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncType;

/**
 * Runtime data (SQLite + content-addressed assets). Kept outside the repository on purpose: the dev bundler watches
 * the whole workspace, and database writes inside it caused endless page reloads. Override with OW_DATA_DIR.
 */
export const DATA_DIR = process.env.OW_DATA_DIR ?? join(homedir(), ".ow-studio", "data");
export const ASSET_DIR = join(DATA_DIR, "assets");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  model_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- draft | active | archived
  data TEXT NOT NULL,                           -- ModelVersion JSON (immutable once used)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (model_id, version)
);
CREATE TABLE IF NOT EXISTS productions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,                           -- frozen ProductionSpec JSON
  spec_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  est_cost REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,                          -- imageSpecId
  production_id TEXT NOT NULL REFERENCES productions(id),
  sku TEXT NOT NULL,
  preset TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  request TEXT NOT NULL,                        -- frozen CompiledRequest JSON
  compile_hash TEXT NOT NULL,
  job TEXT NOT NULL,                            -- JobRecord JSON
  state TEXT NOT NULL,                          -- mirrors job.state for queries
  raw_asset TEXT,                               -- provider output hash
  final_asset TEXT,                             -- background-normalised hash
  claimed_by TEXT,
  claimed_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS images_by_state ON images(state);
CREATE INDEX IF NOT EXISTS images_by_production ON images(production_id);
`;

/** Additive migrations only: existing productions keep working (new columns are NULL for them). */
function migrate(d: DatabaseSync) {
  const cols = new Set((d.prepare("PRAGMA table_info(images)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("depends_on")) d.exec("ALTER TABLE images ADD COLUMN depends_on TEXT");
  const pcols = new Set((d.prepare("PRAGMA table_info(productions)").all() as { name: string }[]).map((c) => c.name));
  // Idempotency key sent by the client on create: a repeated key returns the existing production instead of a new paid one.
  if (!pcols.has("create_key")) d.exec("ALTER TABLE productions ADD COLUMN create_key TEXT");
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS productions_by_create_key ON productions(create_key) WHERE create_key IS NOT NULL");
  const hadAttempts = !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attempts'").get();
  d.exec(`
    -- Every finished provider attempt of an image, with its own files. A retry never overwrites an earlier attempt.
    CREATE TABLE IF NOT EXISTS attempts (
      image_id TEXT NOT NULL REFERENCES images(id),
      attempt INTEGER NOT NULL,
      outcome TEXT NOT NULL,                      -- succeeded | needs_review | failed | unknown
      raw_asset TEXT,
      final_asset TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      error TEXT,
      review TEXT,                                -- NULL (not reviewed) | approved | rejected; at most one approved per image
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (image_id, attempt)
    );
    -- Import sessions: the new-production form, saved server-side so corrections survive a closed tab.
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      production_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // One-time backfill when the table is created: images finished before attempts were recorded keep their files as one attempt.
  if (!hadAttempts) d.exec(`INSERT OR IGNORE INTO attempts (image_id, attempt, outcome, raw_asset, final_asset, cost_usd, created_at)
    SELECT id, json_extract(job, '$.attempt'), CASE WHEN state = 'needs_review' THEN 'needs_review' ELSE 'succeeded' END,
      raw_asset, final_asset, COALESCE(json_extract(job, '$.costUsd'), 0), updated_at
    FROM images WHERE final_asset IS NOT NULL AND state IN ('succeeded', 'needs_review')`);
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(join(DATA_DIR, "studio.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * Daily consistent snapshot of the database (VACUUM INTO) under DATA_DIR/backups, keeping the newest `keep`.
 * Assets are content-addressed and never change, so the volume itself plus these snapshots cover recovery.
 * Returns the file written, or null when today's snapshot already exists.
 */
export function backupDatabase(keep = 7, now = new Date()): string | null {
  const dir = join(DATA_DIR, "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `studio-${now.toISOString().slice(0, 10)}.db`);
  if (existsSync(file)) return null;
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter((f) => /^studio-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) rmSync(join(dir, f));
  return file;
}
