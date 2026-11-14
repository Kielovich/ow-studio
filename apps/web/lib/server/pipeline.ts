import { compositeFix, cropForFix, DEFAULT_POLICY, HAND_FIX_PROMPT, handBox, measureColourDrift, normalizeBackground, ProviderError, runJob, type CompiledRequest, type JobRecord, type ProviderAdapter } from "@ow-studio/core";
import { getDb } from "./db";
import { SqliteJobStore } from "./jobstore";
import { assets, budgetRemaining, DEFAULT_PROFILE, freezeAnchor, recordAttempt } from "./repo";

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
    }
  }
  // Every attempt is kept with its own files; the image row only points at the latest one.
  recordAttempt(row.id, { job, costBeforeUsd, ...(raw ? { raw } : {}), ...(final ? { final } : {}), ...(checks ? { checks } : {}) });
  db.prepare("UPDATE images SET claimed_by = NULL, claimed_until = NULL, raw_asset = COALESCE(?, raw_asset), final_asset = COALESCE(?, final_asset) WHERE id = ?")
    .run(raw ?? null, final ?? null, row.id);
  return job;
}

/** What a local edit needs from the provider (GeminiProvider and the simulated provider both have it). */
export type EditCapable = { edit(prompt: string, images: { bytes: Uint8Array; mime: string }[]): Promise<{ bytes: Uint8Array; costUsd: number }> };

/**
 * One claimed hand fix: crop around the clicked point, one paid edit call, blend back, store as a new attempt of the
 * image (the old attempts stay). Errors follow the job rules: a possibly billed failure becomes "unknown" (may have
 * cost), nothing is retried automatically.
 */
export async function processEdit(edit: any, deps: { adapter: EditCapable }): Promise<string> {
  const db = getDb();
  const finish = (state: string, patch: { error?: string; cost?: number; result?: number } = {}) =>
    db.prepare("UPDATE edits SET state = ?, error = ?, cost_usd = ?, result_attempt = ?, claimed_by = NULL, claimed_until = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(state, patch.error ?? null, patch.cost ?? 0, patch.result ?? null, edit.id);
  const base: any = db.prepare("SELECT final_asset FROM attempts WHERE image_id = ? AND attempt = ?").get(edit.image_id, edit.base_attempt);
  const img: any = db.prepare("SELECT job, state FROM images WHERE id = ?").get(edit.image_id);
  if (!base?.final_asset || !img || (img.state !== "succeeded" && img.state !== "needs_review")) {
    finish("failed", { error: "The image changed before the fix ran; nothing was sent." });
    return "failed";
  }
  if (budgetRemaining() < DEFAULT_PROFILE.estimatedCostUsd) { finish("failed", { error: "Monthly budget reached; nothing was sent." }); return "failed"; }
  db.prepare("UPDATE edits SET state = 'running', updated_at = datetime('now') WHERE id = ?").run(edit.id);

  const bytes = (await assets.resolve(base.final_asset)).bytes;
  const meta = await (await import("sharp")).default(bytes).metadata();
  const box = handBox(meta.width!, meta.height!, edit.x, edit.y);
  let result: { bytes: Uint8Array; costUsd: number };
  try {
    result = await deps.adapter.edit(HAND_FIX_PROMPT, [{ bytes: await cropForFix(bytes, box), mime: "image/png" }]);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    if (e.billable === false) finish("failed", { error: `${e.kind}: ${e.message}` });
    else if (e.billable === "unknown") finish("unknown", { error: `${e.kind}: ${e.message}. May have been billed.` });
    else finish("failed", { error: `${e.kind}: ${e.message}`, cost: DEFAULT_PROFILE.estimatedCostUsd });
    return "failed";
  }
  const raw = await assets.putBytes(result.bytes);
  const final = await assets.putBytes(await compositeFix(bytes, box, result.bytes));
  const job = JSON.parse(img.job) as JobRecord;
  const next = (db.prepare("SELECT MAX(attempt) AS m FROM attempts WHERE image_id = ?").get(edit.image_id) as any).m + 1;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO attempts (image_id, attempt, outcome, raw_asset, final_asset, cost_usd, note) VALUES (?, ?, 'succeeded', ?, ?, ?, ?)")
      .run(edit.image_id, next, raw, final, result.costUsd, `hand fix of attempt ${edit.base_attempt}`);
    const updated: JobRecord = { ...job, attempt: next, costUsd: job.costUsd + result.costUsd, state: "succeeded",
      events: [...job.events, { seq: job.events.length + 1, state: "succeeded", note: `hand fix of attempt ${edit.base_attempt} -> attempt ${next}` }] };
    db.prepare("UPDATE images SET job = ?, state = 'succeeded', raw_asset = ?, final_asset = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(updated), raw, final, edit.image_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  finish("succeeded", { cost: result.costUsd, result: next });
  return "succeeded";
}
