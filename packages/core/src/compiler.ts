import { hashOf } from "./canonical";
import { planPoses } from "./poses";
import { ROLE_LABELS, selectReferences } from "./references";
import {
  OUTERWEAR_CATEGORIES,
  ProductionSpec,
  type CompiledRequest,
  type Conflict,
  type ImageSpec,
  type PhotoStyle,
  type PoseAssignment,
  type ProviderProfile,
} from "./schemas";
import { buildBlocks, buildExclusions, TEMPLATE_VERSION } from "./templates";

/** Bump on any change to compiler logic that can alter output. Part of every compileHash. */
export const COMPILER_VERSION = "1.1.0";

export type CompileContext = { compilerVersion: string; templateVersion: string };
export const DEFAULT_CONTEXT: CompileContext = { compilerVersion: COMPILER_VERSION, templateVersion: TEMPLATE_VERSION };

/** Presets that can serve as a SKU's session anchor, in order of preference. */
export const ANCHOR_PRESETS = ["full_body", "front_crop"] as const;

export type CompileOptions = {
  /** Final image of each SKU's session anchor, once it has succeeded. Keyed by SKU. */
  anchors?: Record<string, string>;
};

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
  const hasBack = spec.slots.some((s) => s.preset === "back" || s.preset === "back_full");
  for (const p of spec.products) {
    if (p.flags.includes("open_back") && !hasBack) {
      c.push({ code: "OPEN_BACK_NO_BACK_PRESET", severity: "warning", sku: p.sku, message: `${p.sku} has an open back but the set has no back image` });
    }
    if (p.flags.includes("asymmetric_hem") && !p.asymmetry) {
      c.push({ code: "ASYMMETRY_UNMEASURED", severity: "warning", sku: p.sku, message: `${p.sku}: the long side of the hem could not be measured from the front packshot, so mirroring is not prevented` });
    }
    if (p.asymmetry?.backAgrees === false) {
      c.push({ code: "PACKSHOTS_DISAGREE", severity: "warning", sku: p.sku, message: `${p.sku}: the front and back packshots show the long side of the hem on the same image side; one of them may be mirrored` });
    }
  }
  return c;
}

export function compileImage(spec: ImageSpec, assignment: PoseAssignment, profile: ProviderProfile, ctx: CompileContext = DEFAULT_CONTEXT): { request: CompiledRequest; conflicts: Conflict[] } {
  const { refs, conflicts } = selectReferences(spec, assignment, profile);
  const instructionBlocks = buildBlocks(spec, assignment);
  const exclusions = buildExclusions(spec);
  const legend = refs.length
    ? `Reference images, in the order attached:\n${refs.map((r, i) => `${i + 1}. ${ROLE_LABELS[r.role]}`).join("\n")}`
    : "";
  const [first, ...rest] = instructionBlocks.map((b) => b.text);
  const prompt = [first, legend, ...rest, `Avoid: ${exclusions.join("; ")}.`].filter(Boolean).join("\n\n");
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
    ...(spec.dependsOn ? { dependsOn: spec.dependsOn } : {}),
  };
  // The hash covers every input that can influence the request, not just the output text.
  const compileHash = "cmp_" + hashOf({ body, imageSpec: spec });
  return { request: { ...body, compileHash }, conflicts: [...conflicts, ...imageConflicts(spec)] };
}

/**
 * Production-wide consistency: per SKU, the first front shot is the session anchor. Every other shot of that SKU
 * depends on it and, once its final image exists, receives it as a low-priority session reference.
 * Anchors never depend on anything, so their requests do not change when anchors are supplied.
 */
export function linkSessionAnchors(specs: ImageSpec[], enabled: boolean, anchors: Record<string, string>): ImageSpec[] {
  if (!enabled) return specs;
  const anchorBySku = new Map<string, string>();
  for (const preset of ANCHOR_PRESETS) {
    for (const s of specs) if (s.preset === preset && !anchorBySku.has(s.product.sku)) anchorBySku.set(s.product.sku, s.imageSpecId);
  }
  return specs.map((s) => {
    const anchorId = anchorBySku.get(s.product.sku);
    if (!anchorId || anchorId === s.imageSpecId) return s;
    const asset = anchors[s.product.sku];
    return { ...s, dependsOn: anchorId, ...(asset ? { anchorAsset: asset } : {}) };
  });
}

/** Pure and deterministic: no clock, no randomness, no environment access. */
export function compileProduction(rawSpec: unknown, profile: ProviderProfile, ctx: CompileContext = DEFAULT_CONTEXT, opts: CompileOptions = {}): ProductionCompileResult {
  const spec = ProductionSpec.parse(rawSpec);
  const specHash = "spec_" + hashOf(spec);
  const imageSpecs = linkSessionAnchors(expandSpec(spec), spec.sessionAnchor, opts.anchors ?? {});
  const plan = planPoses(imageSpecs, spec.seed ?? spec.productionId);
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
