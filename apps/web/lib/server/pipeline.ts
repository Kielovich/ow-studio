import { DEFAULT_POLICY, normalizeBackground, runJob, type CompiledRequest, type JobRecord, type ProviderAdapter } from "@ow-studio/core";
import { getDb } from "./db";
import { SqliteJobStore } from "./jobstore";
import { assets, budgetRemaining, freezeAnchor, recordAttempt } from "./repo";

/**
 * One worker step for a claimed image: freeze the session anchor if needed, run the job (no automatic paid retries),
 * store the output as a new attempt, release the lease. Shared by the worker and the tests.
 */
export async function processImage(row: any, deps: { adapter: ProviderAdapter; sleep: (ms: number) => Promise<void>; store?: SqliteJobStore }): Promise<JobRecord> {
  const db = getDb();
  // A dependent shot gets its session anchor frozen into the request before it is ever submitted.
  if (row.depends_on && freezeAnchor(row.id)) row = db.prepare("SELECT * FROM images WHERE id = ?").get(row.id);
  const request = JSON.parse(row.request) as CompiledRequest;
  const costBeforeUsd = (JSON.parse(row.job) as { costUsd?: number }).costUsd ?? 0;
  const job = await runJob(row.id, {
    store: deps.store ?? new SqliteJobStore(), adapter: deps.adapter, request,
    policy: { ...DEFAULT_POLICY, budgetRemainingUsd: budgetRemaining() },
    sleep: deps.sleep,
  });
  let raw: string | undefined, final: string | undefined;
  if ((job.state === "succeeded" || job.state === "needs_review") && job.providerJobId) {
    const st = await deps.adapter.poll(job.providerJobId);
    if (st.state === "succeeded" && st.assets[0]) {
      raw = await assets.putBytes(st.assets[0].bytes);
      const norm = await normalizeBackground(st.assets[0].bytes);
      final = norm.report.ok ? await assets.putBytes(norm.bytes) : raw;
    }
  }
  // Every attempt is kept with its own files; the image row only points at the latest one.
  recordAttempt(row.id, { job, costBeforeUsd, ...(raw ? { raw } : {}), ...(final ? { final } : {}) });
  db.prepare("UPDATE images SET claimed_by = NULL, claimed_until = NULL, raw_asset = COALESCE(?, raw_asset), final_asset = COALESCE(?, final_asset) WHERE id = ?")
    .run(raw ?? null, final ?? null, row.id);
  return job;
}
