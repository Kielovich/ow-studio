import { randomBytes } from "node:crypto";
import {
  BOTTOM_CATEGORIES, compileProduction, DEFAULT_CONTEXT, GEMINI_PRO_PROFILE, hashOf, LocalAssetStore, measureBottomsSilhouette, measureGarmentColour, measureHemAsymmetry, ModelVersion, newJob,
  type Category, type CompiledRequest, type Conflict, type GarmentFlag, type JobRecord, type PresetId, type ProductionSpecInput,
  type ProviderProfile, type Styling,
} from "@ow-studio/core";
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
    products.push({ ...p, packshots, ...(silhouette ? { silhouette } : {}), ...(asymmetry ? { asymmetry } : {}), ...(colorHex ? { colorHex } : {}) });
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

export async function createProduction(draft: ProductionDraft): Promise<{ id: string } | { error: string; conflicts: Conflict[] }> {
  const id = "prod_" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "_" + randomBytes(3).toString("hex");
  const { spec, profile } = await buildSpec(draft, id);
  const r = compileProduction(spec, profile);
  if (!r.canRun) return { error: "Production has blocking conflicts", conflicts: r.conflicts };
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO productions (id, name, spec, spec_hash, provider, est_cost) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, draft.name || id, JSON.stringify(r.spec), r.specHash, profile.id, r.images.length * profile.estimatedCostUsd);
    const ins = db.prepare("INSERT INTO images (id, production_id, sku, preset, slot_index, request, compile_hash, job, state, depends_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)");
    for (const img of r.images) {
      const slotIndex = r.spec.slots.findIndex((s) => s.preset === img.preset);
      ins.run(img.imageSpecId, id, img.sku, img.preset, slotIndex, JSON.stringify(img), img.compileHash, JSON.stringify(newJob(img.imageSpecId, img)), img.dependsOn ?? null);
    }
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
};

const toImage = (r: any): ImageRow => {
  const req = JSON.parse(r.request) as CompiledRequest;
  return {
    id: r.id, sku: r.sku, preset: r.preset, slotIndex: r.slot_index, state: r.state, job: JSON.parse(r.job), dependsOn: r.depends_on ?? null,
    rawAsset: r.raw_asset, finalAsset: r.final_asset, prompt: req.prompt, refs: req.refs, updatedAt: r.updated_at,
  };
};

export function listProductions() {
  return getDb().prepare(`
    SELECT p.id, p.name, p.provider, p.est_cost, p.created_at,
      COUNT(i.id) AS total,
      SUM(i.state = 'succeeded') AS done,
      SUM(i.state IN ('failed', 'needs_review', 'awaiting_approval')) AS attention,
      SUM(i.state IN ('queued', 'submitting', 'provider_running', 'validating')) AS active,
      (SELECT final_asset FROM images WHERE production_id = p.id AND final_asset IS NOT NULL ORDER BY slot_index LIMIT 1) AS cover
    FROM productions p LEFT JOIN images i ON i.production_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id ORDER BY p.created_at DESC`).all() as any[];
}

export function getProduction(id: string) {
  const db = getDb();
  const p: any = db.prepare("SELECT * FROM productions WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!p) return null;
  const images = (db.prepare("SELECT * FROM images WHERE production_id = ? ORDER BY sku, slot_index").all(id) as any[]).map(toImage);
  return { id: p.id, name: p.name, provider: p.provider, estCost: p.est_cost, createdAt: p.created_at, spec: JSON.parse(p.spec), images };
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
  return {
    active: counts.active ?? 0, attention: counts.attention ?? 0, done: counts.done ?? 0,
    spentUsd: spentThisMonthUsd(), budgetUsd: MONTHLY_BUDGET_USD,
    recent: listProductions().slice(0, 6),
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
