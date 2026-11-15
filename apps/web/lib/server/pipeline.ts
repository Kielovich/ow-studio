import { DEFAULT_POLICY, measureColourDrift, normalizeBackground, runJob, type CompiledRequest, type JobRecord, type ProviderAdapter } from "@ow-studio/core";
import { getDb } from "./db";
import { holdingStore, SqliteJobStore } from "./jobstore";
import { assets, budgetRemaining, freezeAnchor, recordAttempt } from "./repo";

/** Shown when an image was made (and may have been billed) but its file was not stored before the worker stopped. */
export const RESULT_LOST_MESSAGE = "The image was made, but its file was not saved before the worker stopped. It may have cost; a new attempt costs again.";

/** Turns a finished job whose result can no longer be fetched into "may have cost, ask before trying again". */
function resultLost(job: JobRecord): JobRecord {
  return {
    ...job, state: "awaiting_approval", awaitingReason: "result_lost", lastError: { kind: "unknown", message: RESULT_LOST_MESSAGE },
    events: [...job.events, { seq: job.events.length + 1, state: "awaiting_approval", note: "result lost before its file was stored" }],
  };
}

/** What the earlier attempts of an image cost, as recorded. */
const recordedCost = (imageId: string) =>
  ((getDb().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM attempts WHERE image_id = ?").get(imageId) as any)?.usd ?? 0) as number;

/**
 * One worker step for a claimed image: freeze the session anchor if needed, run the job (no automatic paid retries),
 * store the output as a new attempt, release the lease. Shared by the worker and the tests.
 *
 * The image reads as finished only after its files are stored: while the job runs, a finished state is held back as
 * "validating" (holdingStore). If the worker stops before the files are stored, the image is picked up again; if the
 * provider's result is then gone (it lives in memory), the image becomes "not saved, may have cost" with a new attempt
 * offered, instead of a finished image without a file.
 */
export async function processImage(row: any, deps: { adapter: ProviderAdapter; sleep: (ms: number) => Promise<void>; store?: SqliteJobStore }): Promise<JobRecord> {
  const db = getDb();
  // A dependent shot gets its session anchor frozen into the request before it is ever submitted.
  if (row.depends_on && freezeAnchor(row.id)) row = db.prepare("SELECT * FROM images WHERE id = ?").get(row.id);
  const request = JSON.parse(row.request) as CompiledRequest;
  const before = JSON.parse(row.job) as JobRecord;
  // Picked up again after a stop between "finished" and "files stored": this attempt's cost is already in the job.
  const resumedFinished = before.state === "succeeded" || before.state === "needs_review";
  const costBeforeUsd = resumedFinished ? recordedCost(row.id) : before.costUsd ?? 0;
  const store = deps.store ?? new SqliteJobStore();
  let job = await runJob(row.id, {
    store: holdingStore(store), adapter: deps.adapter, request,
    policy: { ...DEFAULT_POLICY, budgetRemainingUsd: budgetRemaining() },
    sleep: deps.sleep,
  });
  let raw: string | undefined, final: string | undefined;
  let checks: { colour?: { measuredHex: string; targetHex: string; distance: number; drift: boolean } } | undefined;
  if ((job.state === "succeeded" || job.state === "needs_review") && job.providerJobId) {
    const st = await deps.adapter.poll(job.providerJobId).catch(() => null); // the result lives in memory: gone after a restart
    if (st?.state === "succeeded" && st.assets[0]) {
      // The provider output is paid for: store it first, so a failure in post-processing can never lose it.
      raw = await assets.putBytes(st.assets[0].bytes);
      final = raw;
      let finalBytes = st.assets[0].bytes;
      try {
        const norm = await normalizeBackground(st.assets[0].bytes);
        if (norm.report.ok) { final = await assets.putBytes(norm.bytes); finalBytes = norm.bytes; }
      } catch (e) {
        console.error(`[pipeline] ${row.id}: background normalisation failed, keeping the raw output:`, (e as Error).message);
      }
      // Colour drift against the packshot's measured colour lock (flags only clear drifts; see measureColourDrift).
      try {
        const p: any = db.prepare("SELECT spec FROM productions WHERE id = ?").get(row.production_id);
        const target = p ? (JSON.parse(p.spec).products as any[]).find((x) => x.sku === row.sku)?.colorHex : undefined;
        if (target) {
          const d = await measureColourDrift(finalBytes, target);
          if (d) checks = { colour: { measuredHex: d.measuredHex, targetHex: target, distance: d.distance, drift: d.drift } };
        }
      } catch (e) {
        console.error(`[pipeline] ${row.id}: colour check failed, image kept unchecked:`, (e as Error).message);
      }
    } else {
      job = resultLost(job);
      await store.save(job);
    }
  }
  // Every attempt is kept with its own files; the image row only points at the latest one. Only now does the image
  // read as finished (the state column was held at "validating" while the job ran).
  recordAttempt(row.id, { job, costBeforeUsd, ...(raw ? { raw } : {}), ...(final ? { final } : {}), ...(checks ? { checks } : {}) });
  db.prepare("UPDATE images SET claimed_by = NULL, claimed_until = NULL, state = ?, raw_asset = COALESCE(?, raw_asset), final_asset = COALESCE(?, final_asset) WHERE id = ?")
    .run(job.state, raw ?? null, final ?? null, row.id);
  return job;
}

/**
 * Images left "finished" without a file by an earlier version (the window this pipeline now closes): they become
 * "not saved, may have cost" with a new attempt offered. Run when the worker starts. Returns how many were found.
 */
export async function recoverUnsavedResults(): Promise<number> {
  const db = getDb();
  const rows = db.prepare(`SELECT id, job FROM images WHERE state IN ('succeeded', 'needs_review') AND final_asset IS NULL AND raw_asset IS NULL
    AND (claimed_until IS NULL OR claimed_until < datetime('now'))`).all() as any[];
  const store = new SqliteJobStore();
  for (const r of rows) {
    const job = resultLost(JSON.parse(r.job) as JobRecord);
    await store.save(job);
    recordAttempt(r.id, { job, costBeforeUsd: recordedCost(r.id) });
  }
  return rows.length;
}
