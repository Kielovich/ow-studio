import { mkdirSync } from "node:fs";
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
