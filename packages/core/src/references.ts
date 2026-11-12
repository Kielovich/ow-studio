import { getPose } from "./poses.js";
import { PRESETS } from "./presets.js";
import type { Attribute, AssetHash, Conflict, ImageSpec, PoseAssignment, PresetId, ProviderProfile, RefRole, RefSlot } from "./schemas.js";

/**
 * What each reference role is allowed to control. This is the precedence contract:
 * a pose reference controls pose only, never identity or garment.
 */
export const ROLE_CONTROLS: Record<RefRole, Attribute[]> = {
  garment_front: ["garment", "fit"],
  garment_back: ["garment", "fit"],
  garment_side: ["garment", "fit"],
  garment_detail: ["garment"],
  identity_primary: ["identity"],
  identity_angle: ["identity"],
  character_sheet: ["identity", "hair"],
  facial_detail: ["facial_detail"],
  body_front: ["body"],
  body_back: ["body"],
  expression_sheet: ["expression"],
  pose: ["pose"],
};

/** Roles per preset, highest priority first. Trimming to the provider limit removes from the end. */
export const PRESET_ROLES: Record<PresetId, RefRole[]> = {
  front_crop: ["garment_front", "identity_primary", "body_front", "facial_detail", "expression_sheet"],
  three_quarter: ["garment_front", "garment_side", "identity_primary", "identity_angle", "body_front", "facial_detail"],
  back: ["garment_back", "body_back", "character_sheet"],
  full_body: ["garment_front", "body_front", "identity_primary", "facial_detail"],
  detail: ["garment_detail", "garment_front"],
};

/** Roles that depict the person (count against a provider's character/person limit). */
const PERSON_ROLES: readonly RefRole[] = ["identity_primary", "identity_angle", "character_sheet", "facial_detail", "body_front", "body_back", "expression_sheet"];

/** Human-readable role descriptions used in the prompt's reference legend. */
export const ROLE_LABELS: Record<RefRole, string> = {
  garment_front: "garment packshot, front (authority for garment and fit)",
  garment_back: "garment packshot, back (authority for garment and fit)",
  garment_side: "garment packshot, side (authority for garment and fit)",
  garment_detail: "garment detail packshot (authority for fabric and finish)",
  identity_primary: "identity portrait of the model (authority for face and hair)",
  identity_angle: "additional angle of the same model (identity only)",
  character_sheet: "character sheet of the same model (identity and hair only)",
  facial_detail: "facial detail sheet of the same model (skin and facial detail only)",
  body_front: "full-body reference of the same model, front (body proportions only, ignore clothing)",
  body_back: "full-body reference of the same model, back (body proportions only, ignore clothing)",
  expression_sheet: "expression sheet of the same model (expression only)",
  pose: "pose reference (pose only; ignore its person, face and clothing)",
};

/** Roles that only make sense when a face is in frame. */
const FACE_ROLES: readonly RefRole[] = ["identity_primary", "identity_angle", "facial_detail", "expression_sheet"];

const REQUIRED_GARMENT: Record<PresetId, RefRole> = {
  front_crop: "garment_front",
  three_quarter: "garment_front",
  back: "garment_back",
  full_body: "garment_front",
  detail: "garment_front",
};

function assetFor(role: RefRole, spec: ImageSpec): AssetHash | undefined {
  const p = spec.product.packshots;
  const r = spec.model.refs;
  switch (role) {
    case "garment_front": return p.front;
    case "garment_back": return p.back;
    case "garment_side": return p.side;
    case "garment_detail": return p.detail;
    case "identity_primary": return r.primaryPortrait;
    case "identity_angle": return r.identityAngles[0];
    case "character_sheet": return r.characterSheet;
    case "facial_detail": return r.facialDetailSheet;
    case "body_front": return r.fullBodyFront;
    case "body_back": return r.fullBodyBack;
    case "expression_sheet": return r.expressionSheet;
    case "pose": return undefined;
  }
}

export type RefSelection = { refs: RefSlot[]; conflicts: Conflict[] };

export function selectReferences(spec: ImageSpec, assignment: PoseAssignment, profile: ProviderProfile): RefSelection {
  const conflicts: Conflict[] = [];
  const base = { sku: spec.product.sku, imageSpecId: spec.imageSpecId };

  const required = REQUIRED_GARMENT[spec.preset];
  const hasGarment = spec.preset === "detail"
    ? Boolean(spec.product.packshots.front || spec.product.packshots.detail)
    : Boolean(assetFor(required, spec));
  if (!hasGarment) {
    conflicts.push({ ...base, code: "MISSING_PACKSHOT", severity: "error", message: `Preset ${spec.preset} needs the ${required.replace("garment_", "")} packshot` });
  }

  const wanted: RefSlot[] = [];
  const seen = new Set<string>();
  const faceInFrame = PRESETS[spec.preset].faceVisible(spec.product.category);
  for (const role of PRESET_ROLES[spec.preset]) {
    if (!faceInFrame && FACE_ROLES.includes(role)) continue;
    if (role === "expression_sheet" && assignment.expressionId === "none") continue;
    const asset = assetFor(role, spec);
    if (!asset || seen.has(asset)) continue;
    seen.add(asset);
    wanted.push({ role, asset, controls: ROLE_CONTROLS[role] });
  }
  const poseAsset = getPose(assignment.poseId)?.referenceAsset;
  if (poseAsset && !seen.has(poseAsset)) wanted.push({ role: "pose", asset: poseAsset, controls: ROLE_CONTROLS.pose });

  if (profile.maxRefs < 1 && wanted.length > 0) {
    conflicts.push({ ...base, code: "PROVIDER_NO_REFERENCES", severity: "error", message: `Provider ${profile.id} accepts no reference images; garment fidelity cannot be guaranteed` });
  }
  // Apply the person-reference sub-limit first, then the overall limit. Both drop from the low-priority end.
  const kept: RefSlot[] = [];
  const dropped: RefSlot[] = [];
  let personRefs = 0;
  for (const ref of wanted) {
    const isPerson = PERSON_ROLES.includes(ref.role);
    if (isPerson && profile.maxIdentityRefs !== undefined && personRefs >= profile.maxIdentityRefs) { dropped.push(ref); continue; }
    if (kept.length >= profile.maxRefs) { dropped.push(ref); continue; }
    if (isPerson) personRefs++;
    kept.push(ref);
  }
  const refs = kept;
  if (dropped.length > 0 && profile.maxRefs > 0) {
    conflicts.push({ ...base, code: "REFS_TRIMMED", severity: "warning", message: `Provider limit ${profile.maxRefs}: dropped ${dropped.map((d) => d.role).join(", ")}` });
  }
  return { refs, conflicts };
}
