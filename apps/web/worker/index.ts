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
import { processEdit, processImage } from "../lib/server/pipeline";
import { simulatedProvider } from "../lib/server/simulated";
import { assets, DEFAULT_PROFILE } from "../lib/server/repo";

loadLocalSecrets();
const WORKER_ID = `${hostname()}:${process.pid}`;
const LEASE_MINUTES = 10;
const profile = DEFAULT_PROFILE;
// OW_PROVIDER=simulated: local simulation for end-to-end tests and demos (no network, no cost). Default: the real API.
const simulated = process.env.OW_PROVIDER === "simulated";
const adapter = simulated ? simulatedProvider() : new GeminiProvider(profile, { resolveAsset: assets.resolve });
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

function claimEdit(): any | null {
  return getDb().prepare(`
    UPDATE edits SET claimed_by = ?, claimed_until = datetime('now', '+${LEASE_MINUTES} minutes')
    WHERE id = (SELECT id FROM edits WHERE state = 'queued' AND (claimed_until IS NULL OR claimed_until < datetime('now')) ORDER BY created_at LIMIT 1)
    RETURNING *`).get(WORKER_ID) ?? null;
}

/** Hand fixes run one at a time beside generation. A crash marks the fix "unknown": it may have been sent. */
async function editLoop() {
  for (;;) {
    const e = claimEdit();
    if (!e) { await sleep(2000); continue; }
    try {
      console.log(`[${new Date().toISOString()}] edit ${e.id} (${e.kind}) -> ${await processEdit(e, { adapter })}`);
    } catch (err) {
      console.error(`[edit] ${e.id} crashed:`, (err as Error).stack ?? (err as Error).message);
      try { getDb().prepare("UPDATE edits SET state = 'unknown', error = ?, claimed_by = NULL, claimed_until = NULL WHERE id = ?").run(`crashed: ${(err as Error).message}. May have been billed.`, e.id); } catch {}
    }
  }
}

async function loop(n: number) {
  for (;;) {
    const row = claim();
    if (!row) { await sleep(2000); continue; }
    try {
      const job = await processImage(row, { adapter, store, sleep });
      console.log(`[${new Date().toISOString()}] ${row.sku} ${row.preset} -> ${job.state} (attempt ${job.attempt})${job.lastError ? ` (${job.lastError.kind})` : ""}`);
    } catch (e) {
      // A crash leaves the job resumable. Release the lease now (not after LEASE_MINUTES), so it is picked up again
      // shortly; runJob's resume rules then decide (a request that may have been sent becomes "unknown outcome").
      console.error(`[worker ${n}] ${row.id} crashed:`, (e as Error).stack ?? (e as Error).message);
      try { getDb().prepare("UPDATE images SET claimed_by = NULL, claimed_until = NULL WHERE id = ? AND claimed_by = ?").run(row.id, WORKER_ID); } catch {}
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

if (simulated) console.log("[worker] SIMULATED provider: no real images, no cost.");
else if (!process.env.GEMINI_API_KEY) console.error("[worker] GEMINI_API_KEY is not set: every generation will fail until it is.");
console.log(`worker ${WORKER_ID} up: provider ${simulated ? "simulated" : profile.id}, concurrency ${profile.concurrency}`);
for (let n = 0; n < profile.concurrency; n++) void loop(n);
void editLoop();
