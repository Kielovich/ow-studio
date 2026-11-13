import { DEFAULT_POLICY, measureColourDrift, normalizeBackground, runJob, type CompiledRequest, type JobRecord, type ProviderAdapter } from "@ow-studio/core";
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
  let checks: { colour?: { measuredHex: string; targetHex: string; distance: number; drift: boolean } } | undefined;
  if ((job.state === "succeeded" || job.state === "needs_review") && job.providerJobId) {
    const st = await deps.adapter.poll(job.providerJobId);
    if (st.state === "succeeded" && st.assets[0]) {
      raw = await assets.putBytes(st.assets[0].bytes);
      const norm = await normalizeBackground(st.assets[0].bytes);
      final = norm.report.ok ? await assets.putBytes(norm.bytes) : raw;
      // Colour drift against the packshot's measured colour lock (flags only clear drifts; see measureColourDrift).
      const p: any = db.prepare("SELECT spec FROM productions WHERE id = ?").get(row.production_id);
      const target = p ? (JSON.parse(p.spec).products as any[]).find((x) => x.sku === row.sku)?.colorHex : undefined;
      if (target) {
        const d = await measureColourDrift(norm.report.ok ? norm.bytes : st.assets[0].bytes, target);
        if (d) checks = { colour: { measuredHex: d.measuredHex, targetHex: target, distance: d.distance, drift: d.drift } };
      }
    }
  }
  // Every attempt is kept with its own files; the image row only points at the latest one.
  recordAttempt(row.id, { job, costBeforeUsd, ...(raw ? { raw } : {}), ...(final ? { final } : {}), ...(checks ? { checks } : {}) });
  db.prepare("UPDATE images SET claimed_by = NULL, claimed_until = NULL, raw_asset = COALESCE(?, raw_asset), final_asset = COALESCE(?, final_asset) WHERE id = ?")
    .run(raw ?? null, final ?? null, row.id);
  return job;
}
