/**
 * Generation worker. Run next to the web app:  npm run worker
 * Claims queued images with a lease, runs them through the core job runner (no automatic paid retries),
 * stores the provider output and the background-normalised final as a new attempt (earlier attempts are kept).
 * Safe to restart at any time.
 */
import { hostname } from "node:os";
import { GeminiProvider, loadLocalSecrets } from "@ow-studio/core";
import { backupDatabase, getDb } from "../lib/server/db";
import { SqliteJobStore } from "../lib/server/jobstore";
import { processImage } from "../lib/server/pipeline";
import { assets, DEFAULT_PROFILE } from "../lib/server/repo";

loadLocalSecrets();
const WORKER_ID = `${hostname()}:${process.pid}`;
const LEASE_MINUTES = 10;
const profile = DEFAULT_PROFILE;
const adapter = new GeminiProvider(profile, { resolveAsset: assets.resolve });
const store = new SqliteJobStore();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function claim(): any | null {
  return getDb().prepare(`
    UPDATE images SET claimed_by = ?, claimed_until = datetime('now', '+${LEASE_MINUTES} minutes')
    WHERE id = (
      SELECT i.id FROM images i JOIN productions p ON p.id = i.production_id
      WHERE p.deleted_at IS NULL AND i.state IN ('queued', 'submitting', 'provider_running', 'validating')
        AND (i.claimed_until IS NULL OR i.claimed_until < datetime('now'))
        -- Shots that depend on a session anchor wait until the anchor has succeeded.
        AND (i.depends_on IS NULL OR EXISTS (SELECT 1 FROM images a WHERE a.id = i.depends_on AND a.state = 'succeeded' AND a.final_asset IS NOT NULL))
      ORDER BY i.updated_at LIMIT 1)
    RETURNING *`).get(WORKER_ID) ?? null;
}

async function loop(n: number) {
  for (;;) {
    const row = claim();
    if (!row) { await sleep(2000); continue; }
    try {
      const job = await processImage(row, { adapter, store, sleep });
      console.log(`[${new Date().toISOString()}] ${row.sku} ${row.preset} -> ${job.state} (attempt ${job.attempt})${job.lastError ? ` (${job.lastError.kind})` : ""}`);
    } catch (e) {
      // A crash inside runJob leaves the job resumable; the lease expires and the job is picked up again.
      console.error(`[worker ${n}] ${row.id} crashed:`, (e as Error).message);
      await sleep(5000);
    }
  }
}

function backup() {
  try {
    const f = backupDatabase();
    if (f) console.log(`[backup] ${f}`);
  } catch (e) {
    console.error("[backup] failed:", (e as Error).message);
  }
}
backup();
setInterval(backup, 60 * 60 * 1000).unref();

if (!process.env.GEMINI_API_KEY) console.error("[worker] GEMINI_API_KEY is not set: every generation will fail until it is.");
console.log(`worker ${WORKER_ID} up: provider ${profile.id}, concurrency ${profile.concurrency}`);
for (let n = 0; n < profile.concurrency; n++) void loop(n);
