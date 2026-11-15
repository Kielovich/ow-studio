import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  BuilderSpec, builderLook, builderPortraitPrompt, builderReferencePrompt, MODEL_NAME_RULE, PORTRAITS_PER_ROUND, ProviderError,
  REFERENCE_ASPECT, REFERENCE_KINDS, type ReferenceKind,
} from "@ow-studio/core";
import { getDb } from "./db";
import { assets, budgetRemaining, DEFAULT_PROFILE, insertModelVersion, listModels } from "./repo";

/**
 * Model builder (server side). A draft holds the choices, every portrait round and the reference set. Images are made
 * by the worker from a queue, like production images: a paid image is never retried automatically, and an image that
 * may have cost is counted against the monthly budget. Nothing is registered as a model until the user adds it.
 */

export const BUILDER_IMAGE_COST = DEFAULT_PROFILE.estimatedCostUsd;
const LEASE_MINUTES = 10;
const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

export class BuilderError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export type BuilderImage = {
  id: string; kind: "portrait" | ReferenceKind; round: number; state: "queued" | "running" | "succeeded" | "failed";
  asset: string | null; error: string | null; costUsd: number;
};
export type BuilderDraft = {
  id: string; spec: BuilderSpec; status: "open" | "registered" | "discarded"; portrait: string | null; modelId: string | null;
  /** Every portrait, newest round first. */
  portraits: BuilderImage[];
  /** The latest attempt of each reference, in the order shown. */
  references: Partial<Record<ReferenceKind, BuilderImage>>;
  busy: boolean; spentUsd: number; imageCostUsd: number; budgetRemainingUsd: number;
};

const toImage = (r: any): BuilderImage => ({ id: r.id, kind: r.kind, round: r.round, state: r.state, asset: r.asset, error: r.error, costUsd: r.cost_usd });
const rowOf = (id: string): any => getDb().prepare("SELECT * FROM model_drafts WHERE id = ?").get(id);
const imagesOf = (id: string): any[] => getDb().prepare("SELECT * FROM model_draft_images WHERE draft_id = ? ORDER BY round DESC, created_at").all(id) as any[];
const touch = (id: string) => getDb().prepare("UPDATE model_drafts SET updated_at = datetime('now') WHERE id = ?").run(id);

export function getDraft(id: string): BuilderDraft | null {
  const d = rowOf(id);
  if (!d) return null;
  const rows = imagesOf(id);
  const references: BuilderDraft["references"] = {};
  for (const r of rows) if (r.kind !== "portrait" && !references[r.kind as ReferenceKind]) references[r.kind as ReferenceKind] = toImage(r); // newest round first
  return {
    id: d.id, spec: JSON.parse(d.spec), status: d.status, portrait: d.portrait, modelId: d.model_id,
    portraits: rows.filter((r) => r.kind === "portrait").map(toImage),
    references,
    busy: rows.some((r) => r.state === "queued" || r.state === "running"),
    spentUsd: rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    imageCostUsd: BUILDER_IMAGE_COST,
    budgetRemainingUsd: budgetRemaining(),
  };
}

/** Unfinished drafts, newest first, with the portrait to show for each. */
export function listOpenDrafts(): { id: string; summarySpec: BuilderSpec; portrait: string | null; updatedAt: string }[] {
  const rows = getDb().prepare("SELECT * FROM model_drafts WHERE status = 'open' ORDER BY updated_at DESC LIMIT 12").all() as any[];
  return rows.map((d) => {
    const latest: any = getDb().prepare("SELECT asset FROM model_draft_images WHERE draft_id = ? AND kind = 'portrait' AND state = 'succeeded' ORDER BY round DESC LIMIT 1").get(d.id);
    return { id: d.id, summarySpec: JSON.parse(d.spec), portrait: d.portrait ?? latest?.asset ?? null, updatedAt: d.updated_at };
  });
}

export function createDraft(spec: unknown): string {
  const s = BuilderSpec.parse(spec);
  const id = newId("mdl");
  getDb().prepare("INSERT INTO model_drafts (id, spec) VALUES (?, ?)").run(id, JSON.stringify(s));
  return id;
}

function openDraft(id: string): BuilderDraft {
  const d = getDraft(id);
  if (!d) throw new BuilderError("This model draft does not exist.", 404);
  if (d.status !== "open") throw new BuilderError(d.status === "registered" ? "This model has already been added to the models." : "This model draft was discarded.");
  return d;
}
const hasReferences = (d: BuilderDraft) => Object.keys(d.references).length > 0;

function checkBudget(images: number) {
  const cost = images * BUILDER_IMAGE_COST;
  if (cost > budgetRemaining() + 1e-9) throw new BuilderError(`Over the monthly budget: ${images} ${images === 1 ? "image costs" : "images cost"} about $${cost.toFixed(2)}, $${budgetRemaining().toFixed(2)} is left this month.`);
}

function queue(draftId: string, kind: BuilderImage["kind"], round: number, prompt: string, refs: string[]) {
  getDb().prepare("INSERT INTO model_draft_images (id, draft_id, kind, round, prompt, refs, aspect) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(newId("mdi"), draftId, kind, round, prompt, JSON.stringify(refs), REFERENCE_ASPECT[kind]);
}

/** New choices. Only before the reference set: the references are made from a portrait of these choices. */
export function updateSpec(id: string, spec: unknown) {
  const d = openDraft(id);
  if (hasReferences(d)) throw new BuilderError("The reference set is already made from this portrait. Start a new model to change the choices.");
  const s = BuilderSpec.parse(spec);
  // A portrait chosen under the old choices no longer matches them.
  getDb().prepare("UPDATE model_drafts SET spec = ?, portrait = NULL, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(s), id);
}

/** A round of portrait candidates from the current choices (paid: PORTRAITS_PER_ROUND images). */
export function queuePortraits(id: string) {
  const d = openDraft(id);
  if (d.busy) throw new BuilderError("Images for this model are still being made.");
  if (hasReferences(d)) throw new BuilderError("The reference set is already made from the chosen portrait.");
  checkBudget(PORTRAITS_PER_ROUND);
  const round = Math.max(0, ...d.portraits.map((p) => p.round)) + 1;
  const prompt = builderPortraitPrompt(d.spec);
  for (let i = 0; i < PORTRAITS_PER_ROUND; i++) queue(id, "portrait", round, prompt, []);
  touch(id);
}

export function choosePortrait(id: string, imageId: string) {
  const d = openDraft(id);
  if (hasReferences(d)) throw new BuilderError("The reference set is already made from the chosen portrait.");
  const p = d.portraits.find((x) => x.id === imageId);
  if (!p || p.state !== "succeeded" || !p.asset) throw new BuilderError("Choose a finished portrait of this model.", 400);
  getDb().prepare("UPDATE model_drafts SET portrait = ?, updated_at = datetime('now') WHERE id = ?").run(p.asset, id);
}

/** The reference set from the chosen portrait: every reference that is not made yet (paid, one image each). */
export function queueReferences(id: string) {
  const d = openDraft(id);
  if (!d.portrait) throw new BuilderError("Choose a portrait first.", 400);
  if (d.busy) throw new BuilderError("Images for this model are still being made.");
  const missing = REFERENCE_KINDS.filter((k) => d.references[k]?.state !== "succeeded");
  if (!missing.length) throw new BuilderError("The reference set is complete.");
  checkBudget(missing.length);
  for (const k of missing) queue(id, k, (d.references[k]?.round ?? 0) + 1, builderReferencePrompt(k, d.spec), [d.portrait]);
  touch(id);
}

/** One reference made again (paid, one image). The earlier attempt is kept. */
export function redoReference(id: string, kind: string) {
  const d = openDraft(id);
  if (!(REFERENCE_KINDS as readonly string[]).includes(kind)) throw new BuilderError("Unknown reference.", 400);
  const k = kind as ReferenceKind;
  if (!d.portrait) throw new BuilderError("Choose a portrait first.", 400);
  const cur = d.references[k];
  if (cur && (cur.state === "queued" || cur.state === "running")) throw new BuilderError("This reference is still being made.");
  checkBudget(1);
  queue(id, k, (cur?.round ?? 0) + 1, builderReferencePrompt(k, d.spec), [d.portrait]);
  touch(id);
}

/** Stops a draft. Images not started yet are cancelled (never sent); one already running still finishes. */
export function discardDraft(id: string) {
  const d = openDraft(id);
  const db = getDb();
  db.prepare("UPDATE model_draft_images SET state = 'failed', error = 'Cancelled: the draft was discarded. Nothing was sent.', updated_at = datetime('now') WHERE draft_id = ? AND state = 'queued'").run(d.id);
  db.prepare("UPDATE model_drafts SET status = 'discarded', updated_at = datetime('now') WHERE id = ?").run(d.id);
}

/** The next free model id: M01, M02, ... (ids are never reused, also not those of retired models). */
function nextModelId(): string {
  const nums = listModels().map((m) => /^M(\d+)$/.exec(m.modelId)?.[1]).filter(Boolean).map(Number);
  return `M${String(Math.max(0, ...nums) + 1).padStart(2, "0")}`;
}

/** Body references are stored headless, like the library's: they carry body proportions only. */
async function headless(hash: string): Promise<string> {
  const { bytes } = await assets.resolve(hash);
  const m = await sharp(bytes).metadata();
  const out = await sharp(bytes)
    .composite([{ input: { create: { width: m.width!, height: Math.round(m.height! * 0.19), channels: 3, background: { r: 241, g: 241, b: 241 } } }, top: 0, left: 0 }])
    .jpeg({ quality: 92 }).toBuffer();
  return assets.putBytes(new Uint8Array(out));
}

/** Adds the finished model to the models: a new model, version 1, active. Returns her model id. */
export async function registerDraft(id: string, rawName: unknown): Promise<string> {
  const d = openDraft(id);
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (!MODEL_NAME_RULE.test(name)) throw new BuilderError("Give her a name: 2 to 24 letters.", 400);
  if (listModels().some((m) => m.status === "active" && m.data.displayName.toLowerCase() === name.toLowerCase())) {
    throw new BuilderError(`There is already a model called ${name}. Choose another name.`, 400);
  }
  if (!d.portrait) throw new BuilderError("Choose a portrait first.", 400);
  const ref = (k: ReferenceKind) => {
    const r = d.references[k];
    if (r?.state !== "succeeded" || !r.asset) throw new BuilderError("The reference set is not complete yet.", 400);
    return r.asset;
  };
  const modelId = nextModelId();
  insertModelVersion({
    modelId, version: 1, displayName: name, ageYears: d.spec.ageYears, heightCm: d.spec.heightCm, euSize: d.spec.euSize,
    look: builderLook(d.spec),
    refs: {
      primaryPortrait: d.portrait, identityAngles: [ref("threeQuarter"), ref("profile")],
      fullBodyFront: await headless(ref("bodyFront")), fullBodyBack: await headless(ref("bodyBack")),
      characterSheet: ref("characterSheet"), facialDetailSheet: d.portrait,
    },
  }, "active");
  getDb().prepare("UPDATE model_drafts SET status = 'registered', model_id = ?, updated_at = datetime('now') WHERE id = ?").run(modelId, id);
  return modelId;
}

// ---------- Worker ----------

/**
 * Claims the next queued builder image. An image left running past its lease (the worker stopped mid-call) is closed
 * as failed and counted as possibly billed: it is never sent again automatically.
 */
export function claimBuilderImage(workerId: string): any | null {
  const db = getDb();
  db.prepare(`UPDATE model_draft_images SET state = 'failed', cost_usd = ?, claimed_by = NULL, claimed_until = NULL,
      error = 'Interrupted before the result was saved. It may have cost.', updated_at = datetime('now')
    WHERE state = 'running' AND claimed_until < datetime('now')`).run(BUILDER_IMAGE_COST);
  return db.prepare(`
    UPDATE model_draft_images SET state = 'running', claimed_by = ?, claimed_until = datetime('now', '+${LEASE_MINUTES} minutes'), updated_at = datetime('now')
    WHERE id = (
      SELECT i.id FROM model_draft_images i JOIN model_drafts d ON d.id = i.draft_id
      WHERE i.state = 'queued' AND d.status = 'open' ORDER BY i.created_at LIMIT 1)
    RETURNING *`).get(workerId) ?? null;
}

type ImageMaker = { generateImage: (prompt: string, images: { bytes: Uint8Array; mime: string }[], aspect: "1:1" | "2:3" | "16:9") => Promise<{ bytes: Uint8Array; costUsd: number }> };

const FRIENDLY: Partial<Record<string, string>> = {
  network_before_accept: "Could not reach the image service. Nothing was sent.",
  rate_limited: "The image service is busy. Nothing was charged; try again in a minute.",
  server_error_unbilled: "The image service had an error. Nothing was charged; try again.",
  timeout_after_accept: "No answer from the image service in time. It may have cost.",
  content_policy: "No image came back (the image service declined). It may have cost.",
  billed_failure: "The image failed and was charged.",
  invalid_request: "The image service refused the request. Nothing was charged.",
};

/** Makes one claimed builder image. Never throws: the outcome is written to the row. */
export async function processBuilderImage(row: any, maker: ImageMaker): Promise<"succeeded" | "failed"> {
  const db = getDb();
  const done = (fields: { state: "succeeded" | "failed"; asset?: string; cost: number; error?: string }) => {
    db.prepare("UPDATE model_draft_images SET state = ?, asset = ?, cost_usd = ?, error = ?, claimed_by = NULL, claimed_until = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(fields.state, fields.asset ?? null, fields.cost, fields.error ?? null, row.id);
    touch(row.draft_id);
    return fields.state;
  };
  if (budgetRemaining() < BUILDER_IMAGE_COST) return done({ state: "failed", cost: 0, error: "Monthly budget reached. Nothing was sent." });
  let inputs: { bytes: Uint8Array; mime: string }[];
  try {
    inputs = await Promise.all((JSON.parse(row.refs) as string[]).map((h) => assets.resolve(h)));
  } catch (e) {
    return done({ state: "failed", cost: 0, error: `The portrait could not be read: ${(e as Error).message}. Nothing was sent.` });
  }
  try {
    const out = await maker.generateImage(row.prompt, inputs, row.aspect);
    // The image is paid for: store it before anything else can fail.
    const asset = await assets.putBytes(out.bytes);
    return done({ state: "succeeded", asset, cost: out.costUsd });
  } catch (e) {
    if (e instanceof ProviderError) {
      return done({ state: "failed", cost: e.billable === false ? 0 : BUILDER_IMAGE_COST, error: FRIENDLY[e.kind] ?? `${e.message}. It may have cost.` });
    }
    // Unexpected error during or after the call: treat as possibly billed, never retried automatically.
    return done({ state: "failed", cost: BUILDER_IMAGE_COST, error: `Something went wrong while making the image (${(e as Error).message}). It may have cost.` });
  }
}
