import { hashOf } from "./canonical.js";
import { planPoses } from "./poses.js";
import { selectReferences } from "./references.js";
import {
  OUTERWEAR_CATEGORIES,
  ProductionSpec,
  type CompiledRequest,
  type Conflict,
  type ImageSpec,
  type PhotoStyle,
  type PoseAssignment,
  type ProviderProfile,
} from "./schemas.js";
import { buildBlocks, buildExclusions, TEMPLATE_VERSION } from "./templates.js";

/** Bump on any change to compiler logic that can alter output. Part of every compileHash. */
export const COMPILER_VERSION = "1.0.0";

export type CompileContext = { compilerVersion: string; templateVersion: string };
export const DEFAULT_CONTEXT: CompileContext = { compilerVersion: COMPILER_VERSION, templateVersion: TEMPLATE_VERSION };

export type ProductionCompileResult = {
  spec: ProductionSpec;
  specHash: string;
  images: CompiledRequest[];
  conflicts: Conflict[];
  /** False while any error-level conflict exists. The UI disables Run on false. */
  canRun: boolean;
};

export function expandSpec(spec: ProductionSpec): ImageSpec[] {
  const out: ImageSpec[] = [];
  for (const product of spec.products) {
    spec.slots.forEach((slot, slotIndex) => {
      out.push({
        imageSpecId: "img_" + hashOf({ productionId: spec.productionId, sku: product.sku, slotIndex, preset: slot.preset }).slice(0, 24),
        productionId: spec.productionId,
        slotIndex,
        preset: slot.preset,
        product,
        model: spec.model,
        styling: spec.styling,
        style: spec.style,
        ...(slot.pose !== undefined ? { manualPose: slot.pose } : {}),
        ...(slot.expression !== undefined ? { manualExpression: slot.expression } : {}),
      });
    });
  }
  return out;
}

export function outputSize(style: PhotoStyle): { width: number; height: number } {
  const L = style.longEdgePx;
  switch (style.aspectRatio) {
    case "1:1": return { width: L, height: L };
    case "4:5": return { width: Math.round((L * 4) / 5), height: L };
    case "2:3": return { width: Math.round((L * 2) / 3), height: L };
  }
}

function imageConflicts(spec: ImageSpec): Conflict[] {
  const c: Conflict[] = [];
  const base = { sku: spec.product.sku, imageSpecId: spec.imageSpecId };
  if (spec.styling.outerLayer && !OUTERWEAR_CATEGORIES.includes(spec.product.category)) {
    c.push({ ...base, code: "STYLING_COVERS_PRODUCT", severity: "error", message: `Outer layer "${spec.styling.outerLayer}" would cover the ${spec.product.category} being sold` });
  }
  return c;
}

function productionConflicts(spec: ProductionSpec, profile: ProviderProfile): Conflict[] {
  const c: Conflict[] = [];
  if (spec.providerProfileId !== profile.id) {
    c.push({ code: "PROFILE_MISMATCH", severity: "error", message: `Spec targets ${spec.providerProfileId} but profile ${profile.id} was supplied` });
  }
  if (!profile.verified) {
    c.push({ code: "PROFILE_UNVERIFIED", severity: "warning", message: `Provider profile ${profile.id}@${profile.version} has not passed a capability test` });
  }
  if (!profile.aspectRatios.includes(spec.style.aspectRatio)) {
    c.push({ code: "UNSUPPORTED_ASPECT", severity: "error", message: `Provider ${profile.id} does not support ${spec.style.aspectRatio}` });
  }
  if (spec.style.longEdgePx > profile.maxLongEdgePx) {
    c.push({ code: "RESOLUTION_TOO_HIGH", severity: "error", message: `Requested ${spec.style.longEdgePx}px exceeds provider max ${profile.maxLongEdgePx}px` });
  }
  const hasBack = spec.slots.some((s) => s.preset === "back");
  for (const p of spec.products) {
    if (p.flags.includes("open_back") && !hasBack) {
      c.push({ code: "OPEN_BACK_NO_BACK_PRESET", severity: "warning", sku: p.sku, message: `${p.sku} has an open back but the set has no back image` });
    }
  }
  return c;
}

export function compileImage(spec: ImageSpec, assignment: PoseAssignment, profile: ProviderProfile, ctx: CompileContext = DEFAULT_CONTEXT): { request: CompiledRequest; conflicts: Conflict[] } {
  const { refs, conflicts } = selectReferences(spec, assignment, profile);
  const instructionBlocks = buildBlocks(spec, assignment);
  const exclusions = buildExclusions(spec);
  const prompt = [...instructionBlocks.map((b) => b.text), `Avoid: ${exclusions.join("; ")}.`].join("\n\n");
  const size = outputSize(spec.style);
  const params: CompiledRequest["params"] = { aspectRatio: spec.style.aspectRatio, ...size };
  if (profile.supportsSeed) params.seed = parseInt(hashOf(["seed", spec.imageSpecId]).slice(0, 8), 16);

  const body: Omit<CompiledRequest, "compileHash"> = {
    compilerVersion: ctx.compilerVersion,
    templateVersion: ctx.templateVersion,
    providerProfile: { id: profile.id, version: profile.version },
    imageSpecId: spec.imageSpecId,
    sku: spec.product.sku,
    preset: spec.preset,
    assignment,
    instructionBlocks,
    exclusions,
    prompt,
    refs,
    params,
  };
  // The hash covers every input that can influence the request, not just the output text.
  const compileHash = "cmp_" + hashOf({ body, imageSpec: spec });
  return { request: { ...body, compileHash }, conflicts: [...conflicts, ...imageConflicts(spec)] };
}

/** Pure and deterministic: no clock, no randomness, no environment access. */
export function compileProduction(rawSpec: unknown, profile: ProviderProfile, ctx: CompileContext = DEFAULT_CONTEXT): ProductionCompileResult {
  const spec = ProductionSpec.parse(rawSpec);
  const specHash = "spec_" + hashOf(spec);
  const imageSpecs = expandSpec(spec);
  const plan = planPoses(imageSpecs, spec.productionId);
  const conflicts: Conflict[] = [...productionConflicts(spec, profile), ...plan.conflicts];
  const images: CompiledRequest[] = [];
  for (const s of imageSpecs) {
    const a = plan.assignments.get(s.imageSpecId);
    if (!a) continue; // the planner already reported why
    const r = compileImage(s, a, profile, ctx);
    images.push(r.request);
    conflicts.push(...r.conflicts);
  }
  return { spec, specHash, images, conflicts, canRun: !conflicts.some((c) => c.severity === "error") };
}
