/**
 * Generation worker. Run next to the web app:  npm run worker
 * Claims queued images with a lease, runs them through the core job runner (no automatic paid retries),
 * stores the provider output and the background-normalised final. Safe to restart at any time.
 */
import { hostname } from "node:os";
import { DEFAULT_POLICY, GeminiProvider, loadLocalSecrets, normalizeBackground, runJob, type CompiledRequest } from "@ow-studio/core";
import { getDb } from "../lib/server/db";
import { SqliteJobStore } from "../lib/server/jobstore";
import { assets, budgetRemaining, DEFAULT_PROFILE } from "../lib/server/repo";

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
      ORDER BY i.updated_at LIMIT 1)
    RETURNING *`).get(WORKER_ID) ?? null;
}

function release(id: string, patch: { raw?: string; final?: string } = {}) {
  getDb().prepare("UPDATE images SET claimed_by = NULL, claimed_until = NULL, raw_asset = COALESCE(?, raw_asset), final_asset = COALESCE(?, final_asset) WHERE id = ?")
    .run(patch.raw ?? null, patch.final ?? null, id);
}

async function processOne(row: any) {
  const request = JSON.parse(row.request) as CompiledRequest;
  const job = await runJob(row.id, {
    store, adapter, request,
    policy: { ...DEFAULT_POLICY, budgetRemainingUsd: budgetRemaining() },
    sleep,
  });
  let raw: string | undefined, final: string | undefined;
  if ((job.state === "succeeded" || job.state === "needs_review") && job.providerJobId) {
    const st = await adapter.poll(job.providerJobId);
    if (st.state === "succeeded" && st.assets[0]) {
      raw = await assets.putBytes(st.assets[0].bytes);
      const norm = await normalizeBackground(st.assets[0].bytes);
      final = norm.report.ok ? await assets.putBytes(norm.bytes) : raw;
    }
  }
  release(row.id, { ...(raw ? { raw } : {}), ...(final ? { final } : {}) });
  console.log(`[${new Date().toISOString()}] ${row.sku} ${row.preset} -> ${job.state}${job.lastError ? ` (${job.lastError.kind})` : ""}`);
}

async function loop(n: number) {
  for (;;) {
    const row = claim();
    if (!row) { await sleep(2000); continue; }
    try {
      await processOne(row);
    } catch (e) {
      // A crash inside runJob leaves the job resumable; the lease expires and the job is picked up again.
      console.error(`[worker ${n}] ${row.id} crashed:`, (e as Error).message);
      await sleep(5000);
    }
  }
}

console.log(`worker ${WORKER_ID} up: provider ${profile.id}, concurrency ${profile.concurrency}`);
for (let n = 0; n < profile.concurrency; n++) void loop(n);
