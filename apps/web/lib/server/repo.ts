import { randomBytes } from "node:crypto";
import {
  BOTTOM_CATEGORIES, compileProduction, cropFabric, DEFAULT_CONTEXT, GEMINI_PRO_PROFILE, hashOf, LocalAssetStore, measureBottomsSilhouette, measureGarmentColour, measureHemAsymmetry, ModelVersion, newJob,
  type Category, type CompiledRequest, type Conflict, type GarmentFlag, type JobRecord, type PresetId, type ProductionSpecInput,
  type ProviderProfile, type Styling, approveRetry, OW_SET,
} from "@ow-studio/core";
import { attemptOutcome, productionMetrics, statusView, type Attempt, type StatusView } from "../outcome";
import { ASSET_DIR, getDb } from "./db";

export const assets = new LocalAssetStore(ASSET_DIR);

/** Provider profiles available to productions. Nano Banana Pro is the project default. */
export const PROFILES: Record<string, ProviderProfile> = { [GEMINI_PRO_PROFILE.id]: GEMINI_PRO_PROFILE };
export const DEFAULT_PROFILE = GEMINI_PRO_PROFILE;
export const MONTHLY_BUDGET_USD = Number(process.env.OW_BUDGET_USD ?? 25);

// ---------- Models ----------

export type ModelRow = { modelId: string; version: number; status: string; data: ModelVersion; createdAt: string };

export function listModels(): ModelRow[] {
  return getDb()
    .prepare("SELECT model_id, version, status, data, created_at FROM models ORDER BY model_id, version DESC")
    .all()
    .map((r: any) => ({ modelId: r.model_id, version: r.version, status: r.status, data: JSON.parse(r.data), createdAt: r.created_at }));
}

export function getModel(modelId: string, version: number): ModelVersion | null {
  const r: any = getDb().prepare("SELECT data FROM models WHERE model_id = ? AND version = ?").get(modelId, version);
  return r ? ModelVersion.parse(JSON.parse(r.data)) : null;
}

function modelStatus(modelId: string, version: number): string | null {
  const r: any = getDb().prepare("SELECT status FROM models WHERE model_id = ? AND version = ?").get(modelId, version);
  return r?.status ?? null;
}

/** Model versions are immutable: inserting an existing (id, version) is refused. */
export function insertModelVersion(model: ModelVersion, status = "active") {
  const m = ModelVersion.parse(model);
  getDb().prepare("INSERT INTO models (model_id, version, status, data) VALUES (?, ?, ?, ?)").run(m.modelId, m.version, status, JSON.stringify(m));
}

export function setModelStatus(modelId: string, version: number, status: "active" | "archived") {
  getDb().prepare("UPDATE models SET status = ? WHERE model_id = ? AND version = ?").run(status, modelId, version);
}

// ---------- Production drafts ----------

export type DraftProduct = {
  sku: string;
  name: string;
  category: Category;
  color: string;
  description: string;
  flags: GarmentFlag[];
  packshots: { front?: string; back?: string; detail?: string; side?: string };
};

export type ProductionDraft = {
  name: string;
  products: DraftProduct[];
  modelId: string;
  modelVersion: number;
  presets: PresetId[];
  styling: Styling;
  providerProfileId?: string;
  /** Generate each SKU's front shot first and use it as the session reference for the other shots. Default true. */
  sessionAnchor?: boolean;
};

async function buildSpec(draft: ProductionDraft, productionId: string): Promise<{ spec: ProductionSpecInput; profile: ProviderProfile }> {
  const model = getModel(draft.modelId, draft.modelVersion);
  if (!model) throw new Error(`Model ${draft.modelId} v${draft.modelVersion} not found`);
  // Server-side rule, not just a UI filter: only active model versions can start new productions.
  if (modelStatus(draft.modelId, draft.modelVersion) !== "active") throw new Error(`Model ${draft.modelId} v${draft.modelVersion} is not active`);
  const profile = PROFILES[draft.providerProfileId ?? DEFAULT_PROFILE.id] ?? DEFAULT_PROFILE;
  const products = [];
  for (const p of draft.products) {
    const packshots = Object.fromEntries(Object.entries(p.packshots).filter(([, v]) => v));
    let silhouette, asymmetry;
    if (BOTTOM_CATEGORIES.includes(p.category) && p.packshots.front) {
      silhouette = (await measureBottomsSilhouette((await assets.resolve(p.packshots.front)).bytes)) ?? undefined;
    }
    if (p.flags.includes("asymmetric_hem") && p.packshots.front) {
      const back = p.packshots.back ? (await assets.resolve(p.packshots.back)).bytes : undefined;
      asymmetry = (await measureHemAsymmetry((await assets.resolve(p.packshots.front)).bytes, back)) ?? undefined;
    }
    const colorHex = p.packshots.front ? (await measureGarmentColour((await assets.resolve(p.packshots.front)).bytes)) ?? undefined : undefined;
    // Plain-fabric crop from the front packshot, sent as a surface-only reference (sheen, weave, pile, colour).
    const crop = p.packshots.front ? await cropFabric((await assets.resolve(p.packshots.front)).bytes) : null;
    const fabricCrop = crop ? await assets.putBytes(crop.bytes) : undefined;
    products.push({ ...p, packshots, ...(silhouette ? { silhouette } : {}), ...(asymmetry ? { asymmetry } : {}), ...(colorHex ? { colorHex } : {}), ...(fabricCrop ? { fabricCrop } : {}) });
  }
  return {
    profile,
    spec: {
      productionId,
      model,
      products,
      slots: draft.presets.map((preset) => ({ preset })),
      styling: draft.styling,
      style: { background: [241, 241, 241], aspectRatio: "1:1", longEdgePx: 2000 },
      providerProfileId: profile.id,
      sessionAnchor: draft.sessionAnchor ?? true,
      // Seed from the draft content (not the production id), so the preview plans exactly what the run will do.
      seed: "s_" + hashOf({ products: products.map((p) => ({ sku: p.sku, packshots: p.packshots })), presets: draft.presets, model: [model.modelId, model.version] }).slice(0, 16),
    },
  };
}

/** For scripts that inspect payloads without creating a production. */
export async function buildSpecForInspection(draft: ProductionDraft) {
  return (await buildSpec(draft, "inspect")).spec;
}

export type CompilePreview = {
  canRun: boolean;
  conflicts: Conflict[];
  images: { imageSpecId: string; sku: string; preset: PresetId; poseId: string; expressionId: string; refs: string[]; dependsOn?: string }[];
  estCostUsd: number;
  budgetRemainingUsd: number;
};

export async function previewDraft(draft: ProductionDraft): Promise<CompilePreview> {
  const { spec, profile } = await buildSpec(draft, "draft");
  const r = compileProduction(spec, profile);
  return {
    canRun: r.canRun,
    conflicts: r.conflicts,
    images: r.images.map((i) => ({ imageSpecId: i.imageSpecId, sku: i.sku, preset: i.preset, poseId: i.assignment.poseId, expressionId: i.assignment.expressionId, refs: i.refs.map((x) => x.role), ...(i.dependsOn ? { dependsOn: i.dependsOn } : {}) })),
    estCostUsd: r.images.length * profile.estimatedCostUsd,
    budgetRemainingUsd: budgetRemaining(),
  };
}

export type CreateOptions = {
  /** Client-generated idempotency key. Repeating it (double click, network retry, reload) returns the same production. */
  createKey?: string;
  /** Import session this production was created from; it is marked as run. */
  draftId?: string;
};

export type CreateResult = { id: string; existing?: boolean } | { error: string; conflicts: Conflict[] };

function productionByKey(createKey: string): string | null {
  const r: any = getDb().prepare("SELECT id FROM productions WHERE create_key = ?").get(createKey);
  return r?.id ?? null;
}

export async function createProduction(draft: ProductionDraft, opts: CreateOptions = {}): Promise<CreateResult> {
  const key = opts.createKey?.trim() || null;
  if (key) {
    const existing = productionByKey(key);
    if (existing) return { id: existing, existing: true };
  }
  const id = "prod_" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "_" + randomBytes(3).toString("hex");
  const { spec, profile } = await buildSpec(draft, id);
  const r = compileProduction(spec, profile);
  if (!r.canRun) return { error: "Production has blocking conflicts", conflicts: r.conflicts };
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Checked again inside the write transaction: a concurrent request with the same key may have won while we compiled.
    const won = key ? productionByKey(key) : null;
    if (won) {
      db.exec("ROLLBACK");
      return { id: won, existing: true };
    }
    db.prepare("INSERT INTO productions (id, name, spec, spec_hash, provider, est_cost, create_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, draft.name || id, JSON.stringify(r.spec), r.specHash, profile.id, r.images.length * profile.estimatedCostUsd, key);
    const ins = db.prepare("INSERT INTO images (id, production_id, sku, preset, slot_index, request, compile_hash, job, state, depends_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)");
    for (const img of r.images) {
      const slotIndex = r.spec.slots.findIndex((s) => s.preset === img.preset);
      ins.run(img.imageSpecId, id, img.sku, img.preset, slotIndex, JSON.stringify(img), img.compileHash, JSON.stringify(newJob(img.imageSpecId, img)), img.dependsOn ?? null);
    }
    if (opts.draftId) db.prepare("UPDATE drafts SET production_id = ? WHERE id = ?").run(id, opts.draftId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { id };
}

// ---------- Productions ----------

export type ImageRow = {
  id: string; sku: string; preset: PresetId; slotIndex: number; state: JobRecord["state"]; job: JobRecord; dependsOn: string | null;
  rawAsset: string | null; finalAsset: string | null; prompt: string; refs: CompiledRequest["refs"]; updatedAt: string;
  /** Every finished attempt, oldest first, each with its own files and review. */
  attempts: Attempt[];
  /** The attempt marked approved, if any. */
  approvedAttempt: number | null;
  status: StatusView;
};

const toAttempt = (a: any): Attempt => ({
  attempt: a.attempt, outcome: a.outcome, rawAsset: a.raw_asset, finalAsset: a.final_asset, costUsd: a.cost_usd, error: a.error, review: a.review ?? null, createdAt: a.created_at,
  checks: a.checks ? JSON.parse(a.checks) : null,
});

const toImage = (r: any, attempts: Attempt[], anchorState?: string): ImageRow => {
  const req = JSON.parse(r.request) as CompiledRequest;
  const job = JSON.parse(r.job) as JobRecord;
  const latest = attempts.at(-1);
  // The review shown on the tile is the review of the attempt it shows: the latest one.
  const review = latest && latest.attempt === job.attempt ? latest.review : null;
  return {
    id: r.id, sku: r.sku, preset: r.preset, slotIndex: r.slot_index, state: r.state, job, dependsOn: r.depends_on ?? null,
    rawAsset: r.raw_asset, finalAsset: r.final_asset, prompt: req.prompt, refs: req.refs, updatedAt: r.updated_at,
    attempts,
    approvedAttempt: attempts.find((a) => a.review === "approved")?.attempt ?? null,
    status: statusView(r.state, job, review, {
      waitingForAnchor: !!r.depends_on && anchorState !== undefined && anchorState !== "succeeded",
      checks: latest && latest.attempt === job.attempt ? latest.checks : null,
    }),
  };
};

export function listProductions() {
  return getDb().prepare(`
    SELECT p.id, p.name, p.provider, p.est_cost, p.created_at,
      COUNT(i.id) AS total,
      SUM(i.state = 'succeeded') AS done,
      SUM(i.state IN ('failed', 'needs_review', 'awaiting_approval')) AS attention,
      SUM(i.state IN ('queued', 'submitting', 'provider_running', 'validating')) AS active,
      SUM(EXISTS (SELECT 1 FROM attempts a WHERE a.image_id = i.id AND a.review = 'approved')) AS approved,
      -- Waiting for a human: finished, nothing approved yet, and the current attempt not reviewed.
      SUM(i.state IN ('succeeded', 'needs_review') AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.image_id = i.id
        AND (a.review = 'approved' OR (a.attempt = json_extract(i.job, '$.attempt') AND a.review IS NOT NULL)))) AS to_review,
      (SELECT final_asset FROM images WHERE production_id = p.id AND final_asset IS NOT NULL ORDER BY slot_index LIMIT 1) AS cover
    FROM productions p LEFT JOIN images i ON i.production_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id ORDER BY p.created_at DESC`).all() as any[];
}

export function getProduction(id: string) {
  const db = getDb();
  const p: any = db.prepare("SELECT * FROM productions WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!p) return null;
  const rows = db.prepare("SELECT * FROM images WHERE production_id = ? ORDER BY sku, slot_index").all(id) as any[];
  const attempts = new Map<string, Attempt[]>();
  for (const a of db.prepare("SELECT a.* FROM attempts a JOIN images i ON i.id = a.image_id WHERE i.production_id = ? ORDER BY a.attempt").all(id) as any[]) {
    attempts.set(a.image_id, [...(attempts.get(a.image_id) ?? []), toAttempt(a)]);
  }
  const stateOf = new Map(rows.map((r) => [r.id, r.state as string]));
  const images = rows.map((r) => toImage(r, attempts.get(r.id) ?? [], r.depends_on ? stateOf.get(r.depends_on) : undefined));
  return {
    id: p.id, name: p.name, provider: p.provider, estCost: p.est_cost, createdAt: p.created_at, spec: JSON.parse(p.spec), images,
    metrics: productionMetrics(images),
  };
}

/** One image with its attempts, for single-image routes. */
export function getImage(imageId: string): ImageRow | null {
  const r: any = getDb().prepare("SELECT production_id FROM images WHERE id = ?").get(imageId);
  return r ? getProduction(r.production_id)?.images.find((i) => i.id === imageId) ?? null : null;
}

export function spentThisMonthUsd(): number {
  const rows = getDb().prepare("SELECT job FROM images WHERE updated_at >= date('now', 'start of month')").all() as any[];
  return rows.reduce((s, r) => s + (JSON.parse(r.job).costUsd ?? 0), 0);
}

export function budgetRemaining(): number {
  return Math.max(0, MONTHLY_BUDGET_USD - spentThisMonthUsd());
}

/** Soft delete. Refused while any image is still being worked on. */
export function deleteProduction(id: string): { ok: true } | { error: string } {
  const db = getDb();
  const active: any = db.prepare("SELECT COUNT(*) AS n FROM images WHERE production_id = ? AND state IN ('submitting', 'provider_running', 'validating')").get(id);
  if (active.n > 0) return { error: "Production has images in progress; wait until they finish." };
  db.prepare("UPDATE images SET state = 'cancelled' WHERE production_id = ? AND state = 'queued'").run(id);
  db.prepare("UPDATE productions SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return { ok: true };
}

export function overview() {
  const db = getDb();
  const counts: any = db.prepare(`SELECT
      SUM(state IN ('queued','submitting','provider_running','validating')) AS active,
      SUM(state IN ('failed','needs_review','awaiting_approval')) AS attention,
      SUM(state = 'succeeded') AS done
    FROM images i JOIN productions p ON p.id = i.production_id WHERE p.deleted_at IS NULL`).get();
  const recent = listProductions();
  return {
    active: counts.active ?? 0, attention: counts.attention ?? 0, done: counts.done ?? 0,
    toReview: recent.reduce((n, p) => n + (p.to_review ?? 0), 0),
    approved: recent.reduce((n, p) => n + (p.approved ?? 0), 0),
    spentUsd: spentThisMonthUsd(), budgetUsd: MONTHLY_BUDGET_USD,
    recent: recent.slice(0, 6),
    models: listModels().filter((m) => m.status === "active").length,
  };
}

// ---------- Session anchor ----------

/**
 * Freezes the session anchor into a dependent image's request, once, before its first submission.
 * The request is recompiled from the production's frozen spec with the anchor's final image; the new compileHash
 * is written to both the row and the job, and the change is recorded in the job history.
 * Returns false when the image is not ready (anchor not finished) or the request is already frozen.
 */
export function freezeAnchor(imageId: string): boolean {
  const db = getDb();
  const img: any = db.prepare("SELECT * FROM images WHERE id = ?").get(imageId);
  if (!img?.depends_on) return false;
  const req = JSON.parse(img.request) as CompiledRequest;
  if (req.refs.some((r) => r.role === "session_anchor")) return false;
  const job = JSON.parse(img.job) as JobRecord;
  if (job.attempt !== 1 || job.providerJobId || job.state !== "queued") return false; // never re-freeze a started job
  const anchor: any = db.prepare("SELECT state, final_asset FROM images WHERE id = ?").get(img.depends_on);
  if (!anchor || anchor.state !== "succeeded" || !anchor.final_asset) return false;
  const p: any = db.prepare("SELECT spec, provider FROM productions WHERE id = ?").get(img.production_id);
  const profile = PROFILES[p.provider] ?? DEFAULT_PROFILE;
  // Never mix compiler versions inside one production: the anchor was compiled when the production was created.
  const anchorReq = JSON.parse((db.prepare("SELECT request FROM images WHERE id = ?").get(img.depends_on) as any).request) as CompiledRequest;
  if (anchorReq.compilerVersion !== DEFAULT_CONTEXT.compilerVersion || anchorReq.templateVersion !== DEFAULT_CONTEXT.templateVersion) {
    const failed: JobRecord = {
      ...job, state: "failed",
      lastError: { kind: "invalid_request", message: `Compiler changed since this production was created (${anchorReq.templateVersion} → ${DEFAULT_CONTEXT.templateVersion}). Re-create the production so all shots use one version.` },
      events: [...job.events, { seq: job.events.length + 1, state: "failed", note: "compiler version mismatch with session anchor" }],
    };
    db.prepare("UPDATE images SET job = ?, state = 'failed', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(failed), imageId);
    return false;
  }
  const compiled = compileProduction(JSON.parse(p.spec), profile, undefined, { anchors: { [img.sku]: anchor.final_asset } });
  const next = compiled.images.find((i) => i.imageSpecId === imageId);
  if (!next) throw new Error(`Recompile lost image ${imageId}`);
  const frozenJob: JobRecord = {
    ...job,
    compileHash: next.compileHash,
    events: [...job.events.slice(0, -1), { ...job.events[job.events.length - 1]!, note: `session anchor frozen: ${anchor.final_asset.slice(7, 19)}` }],
  };
  db.prepare("UPDATE images SET request = ?, compile_hash = ?, job = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(next), next.compileHash, JSON.stringify(frozenJob), imageId);
  return true;
}

// ---------- Attempts and review ----------

/**
 * Records a finished provider attempt with its own files. Called by the worker after every run, so a retry never
 * replaces an earlier image: both stay available for comparison. Returns false when nothing was attempted (budget hold).
 */
export function recordAttempt(imageId: string, a: { job: JobRecord; costBeforeUsd: number; raw?: string; final?: string; checks?: Attempt["checks"] }): boolean {
  const outcome = attemptOutcome(a.job.state, a.job);
  if (!outcome) return false;
  const error = a.job.validation && !a.job.validation.ok ? a.job.validation.reasons.join("; ") : a.job.lastError ? `${a.job.lastError.kind}: ${a.job.lastError.message}` : null;
  getDb().prepare(`INSERT INTO attempts (image_id, attempt, outcome, raw_asset, final_asset, cost_usd, error, checks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (image_id, attempt) DO UPDATE SET outcome = excluded.outcome, raw_asset = COALESCE(excluded.raw_asset, raw_asset),
      final_asset = COALESCE(excluded.final_asset, final_asset), cost_usd = excluded.cost_usd, error = excluded.error, checks = COALESCE(excluded.checks, checks)`)
    .run(imageId, a.job.attempt, outcome, a.raw ?? null, a.final ?? null, Math.max(0, a.job.costUsd - a.costBeforeUsd), error, a.checks ? JSON.stringify(a.checks) : null);
  return true;
}

/**
 * Approve or reject one attempt. Approving an attempt un-approves any other attempt of the same image, so the export
 * always has exactly one version per image. Only attempts with an image can be approved.
 */
export function setReview(imageId: string, attempt: number, decision: "approved" | "rejected" | null): { ok: true } | { error: string } {
  const db = getDb();
  const a: any = db.prepare("SELECT final_asset FROM attempts WHERE image_id = ? AND attempt = ?").get(imageId, attempt);
  if (!a) return { error: `Attempt ${attempt} of ${imageId} not found` };
  if (decision === "approved" && !a.final_asset) return { error: "This attempt has no image to approve" };
  db.exec("BEGIN");
  try {
    if (decision === "approved") db.prepare("UPDATE attempts SET review = NULL WHERE image_id = ? AND review = 'approved'").run(imageId);
    db.prepare("UPDATE attempts SET review = ? WHERE image_id = ? AND attempt = ?").run(decision, imageId, attempt);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}

/**
 * A new paid attempt, always on explicit user action. Allowed after a failure, an unknown outcome or a size check, and
 * after a finished image only once its latest attempt has been rejected (a deliberate decision, not a stray click).
 */
export async function retryImage(imageId: string): Promise<{ state: string } | { error: string }> {
  const db = getDb();
  const row: any = db.prepare("SELECT state, job FROM images WHERE id = ?").get(imageId);
  if (!row) return { error: "Image not found" };
  const store = new (await import("./jobstore")).SqliteJobStore();
  if (row.state === "succeeded") {
    const job = JSON.parse(row.job) as JobRecord;
    const latest: any = db.prepare("SELECT review FROM attempts WHERE image_id = ? AND attempt = ?").get(imageId, job.attempt);
    if (latest?.review !== "rejected") return { error: "Reject the current image before asking for a new one" };
    const next: JobRecord = {
      ...job, state: "queued", attempt: job.attempt + 1, providerJobId: undefined, validation: undefined, outputs: undefined,
      events: [...job.events, { seq: job.events.length + 1, state: "queued", note: "new attempt after rejection" }],
    };
    await store.save(next);
    return { state: next.state };
  }
  try {
    return { state: (await approveRetry(store, imageId)).state };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Export file name: SKU/SKU_NN_preset.jpg in gallery order. */
export function exportName(sku: string, preset: PresetId, slotIndex: number) {
  const order = OW_SET.indexOf(preset);
  const n = String((order >= 0 ? order : slotIndex) + 1).padStart(2, "0");
  return `${sku}/${sku}_${n}_${preset}.jpg`;
}

export type ZipEntry = { name: string; asset: string; sku: string; preset: PresetId; attempt: number; attempts: number; review: string };

/**
 * What goes in the ZIP. Default: only approved images, each the approved attempt. With all, every image that has a
 * finished file, using the approved attempt where there is one and otherwise the latest; the manifest says which.
 */
export function zipEntries(productionId: string, opts: { all?: boolean } = {}): ZipEntry[] {
  const p = getProduction(productionId);
  if (!p) return [];
  const out: ZipEntry[] = [];
  for (const img of p.images) {
    const approved = img.attempts.find((a) => a.review === "approved" && a.finalAsset);
    const latest = [...img.attempts].reverse().find((a) => a.finalAsset);
    const pick = approved ?? (opts.all ? latest : undefined);
    if (!pick?.finalAsset) continue;
    out.push({
      name: exportName(img.sku, img.preset, img.slotIndex), asset: pick.finalAsset, sku: img.sku, preset: img.preset,
      attempt: pick.attempt, attempts: img.attempts.length, review: pick.review ?? "not reviewed",
    });
  }
  return out;
}

export function zipManifest(entries: ZipEntry[]): string {
  const rows = [["file", "sku", "shot", "attempt", "attempts_total", "review"], ...entries.map((e) => [e.name, e.sku, e.preset, String(e.attempt), String(e.attempts), e.review])];
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}

// ---------- Import sessions (drafts) ----------

export type DraftRecord = { id: string; data: unknown; productionId: string | null; updatedAt: string };

const DRAFT_ID = /^draft_[a-z0-9]{6,32}$/;
export const isDraftId = (id: string) => DRAFT_ID.test(id);

export function saveDraft(id: string, data: unknown): DraftRecord {
  if (!isDraftId(id)) throw new Error("Invalid draft id");
  const json = JSON.stringify(data);
  if (json.length > 2_000_000) throw new Error("Draft is too large");
  getDb().prepare(`INSERT INTO drafts (id, data) VALUES (?, ?)
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`).run(id, json);
  return getDraft(id)!;
}

export function getDraft(id: string): DraftRecord | null {
  const r: any = getDb().prepare("SELECT * FROM drafts WHERE id = ?").get(id);
  return r ? { id: r.id, data: JSON.parse(r.data), productionId: r.production_id ?? null, updatedAt: r.updated_at } : null;
}

export function listDrafts(limit = 8) {
  return (getDb().prepare("SELECT id, data, production_id, updated_at FROM drafts ORDER BY updated_at DESC LIMIT ?").all(limit) as any[]).map((r) => {
    const d = JSON.parse(r.data);
    // Unnamed imports are listed by their folders (sets), e.g. "Look-07, Look-08".
    const sets = Array.isArray(d.files) ? [...new Set(d.files.map((f: any) => f?.set).filter(Boolean))].slice(0, 4).join(", ") : "";
    return { id: r.id, name: d.name || sets || null, files: Array.isArray(d.files) ? d.files.length : 0, productionId: r.production_id ?? null, updatedAt: r.updated_at };
  });
}
