import { hashOf } from "./canonical";
import { PRESETS, yawAllowed } from "./presets";
import { OUTERWEAR_CATEGORIES, type Conflict, type GarmentFlag, type ImageSpec, type PoseAssignment, type PresetId, type Product, type Styling } from "./schemas";

export type ArmState = "relaxed" | "hip" | "hem" | "pocket" | "crossed" | "bag";

export type Pose = {
  id: string;
  presets: PresetId[];
  torsoYaw: number;
  headYaw: number;
  weight: "even" | "left" | "right";
  arms: { left: ArmState; right: ArmState };
  /** 0..1, how natural/restrained the pose reads. Dominates scoring. */
  naturalness: number;
  /** Calm main-shot pose: allowed as the first shot of a preset in a set. */
  calm: boolean;
  text: string;
  /** Optional pose reference (skeleton or photo). Controls pose only. */
  referenceAsset?: string;
};

export type Expression = {
  id: string;
  presets: PresetId[];
  gaze: "camera" | "away" | "none";
  naturalness: number;
  text: string;
};

export const POSES: readonly Pose[] = [
  { id: "front_neutral", presets: ["front_crop", "full_body"], torsoYaw: 0, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 1, calm: true,
    text: "Standing square to the camera, weight evenly on both feet, feet close together a few centimetres apart, arms hanging straight down close to the body with relaxed, softly curved fingers, shoulders relaxed and level, head straight." },
  { id: "front_soft_knee", presets: ["front_crop", "full_body"], torsoYaw: 0, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 0.98, calm: true,
    text: "Standing facing the camera, weight almost even with one knee softly relaxed, feet close together a few centimetres apart, arms hanging straight down close to the body with loose fingers, shoulders down and level, chin neutral." },
  { id: "front_weight_shift", presets: ["front_crop", "full_body", "styled_full"], torsoYaw: 0, headYaw: 0, weight: "left", arms: { left: "relaxed", right: "relaxed" }, naturalness: 0.95, calm: false,
    text: "Standing facing the camera with weight shifted onto one leg, the other knee slightly bent, hips subtly angled, arms relaxed at the sides, head straight." },
  { id: "front_hand_hem", presets: ["front_crop", "full_body"], torsoYaw: 0, headYaw: 0, weight: "right", arms: { left: "relaxed", right: "hem" }, naturalness: 0.85, calm: false,
    text: "Facing the camera, one hand lightly touching the side of the garment at the hem without pulling or covering it, the other arm relaxed, weight slightly on one leg." },
  { id: "front_hand_pocket", presets: ["front_crop", "full_body"], torsoYaw: 0, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "pocket" }, naturalness: 0.85, calm: false,
    text: "Facing the camera, one hand casually in the garment's pocket with the thumb outside, the other arm relaxed at the side." },
  { id: "front_hand_hip", presets: ["styled_full"], torsoYaw: 0, headYaw: 0, weight: "left", arms: { left: "hip", right: "relaxed" }, naturalness: 0.9, calm: false,
    text: "Facing the camera, one hand resting lightly on the hip with the elbow out, the other arm relaxed, weight on one leg." },
  { id: "front_arms_crossed", presets: ["styled_full"], torsoYaw: 0, headYaw: 0, weight: "even", arms: { left: "crossed", right: "crossed" }, naturalness: 0.7, calm: false,
    text: "Facing the camera, arms loosely crossed at the lower chest, shoulders relaxed." },
  { id: "front_bag_shoulder", presets: ["styled_full"], torsoYaw: 0, headYaw: 0, weight: "right", arms: { left: "bag", right: "relaxed" }, naturalness: 0.8, calm: false,
    text: "Facing the camera, a bag carried on one shoulder with the hand resting on the strap, the other arm relaxed." },
  // The brand's three-quarter always turns the same way (towards the image left), so this is the default.
  { id: "tq_away_left", presets: ["three_quarter", "three_quarter_full"], torsoYaw: 35, headYaw: 45, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 1, calm: true,
    text: "Body turned about 35 degrees towards the image left (her right), arms hanging relaxed close to the body, head turned a little further the same way, gaze off-camera and slightly down." },
  { id: "tq_away_right", presets: ["three_quarter", "three_quarter_full"], torsoYaw: -35, headYaw: -45, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 0.88, calm: true,
    text: "Body turned about 35 degrees the other way from the camera, arms relaxed, head turned further in the same direction, gaze off-camera." },
  { id: "tq_hand_hip", presets: ["three_quarter", "three_quarter_full"], torsoYaw: 40, headYaw: 30, weight: "left", arms: { left: "relaxed", right: "hip" }, naturalness: 0.85, calm: false,
    text: "Body turned about 40 degrees from the camera, the far hand lightly on the hip, weight on the back leg, head slightly toward the camera, gaze off-camera." },
  { id: "back_neutral", presets: ["back", "back_full"], torsoYaw: 180, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 1, calm: true,
    text: "Standing with the back to the camera, weight even, arms relaxed at the sides, head straight forward." },
  { id: "back_soft_knee", presets: ["back", "back_full"], torsoYaw: 180, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 0.98, calm: true,
    text: "Back to the camera, weight almost even with one knee softly relaxed, arms hanging naturally a little away from the body so the side seams stay visible, head straight." },
  { id: "back_head_turn", presets: ["back", "back_full"], torsoYaw: 180, headYaw: 30, weight: "left", arms: { left: "relaxed", right: "relaxed" }, naturalness: 0.9, calm: false,
    text: "Back to the camera, weight on one leg, head turned slightly to the side so only the cheek line is visible, arms relaxed." },
  { id: "styled_bag_low", presets: ["styled_full"], torsoYaw: 15, headYaw: 20, weight: "left", arms: { left: "bag", right: "relaxed" }, naturalness: 0.9, calm: false,
    text: "Facing the camera with the weight on one leg and the other knee softly relaxed, feet close together, one hand holding a small bag low by its handle beside the thigh, the other arm relaxed close to the body, head straight or very slightly tilted." },
  { id: "styled_step", presets: ["styled_full"], torsoYaw: 10, headYaw: 15, weight: "right", arms: { left: "relaxed", right: "relaxed" }, naturalness: 0.85, calm: false,
    text: "Relaxed fashion stance: weight on one leg, the other foot stepped forward with the knee softly bent, shoulders loose, arms hanging naturally, head tilted slightly, gaze just past the camera." },
  { id: "detail_still", presets: ["detail"], torsoYaw: 0, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "relaxed" }, naturalness: 1, calm: true,
    text: "Body still and upright; the garment section is presented flat and undistorted." },
  { id: "detail_hand_at_fabric", presets: ["detail"], torsoYaw: 10, headYaw: 0, weight: "even", arms: { left: "relaxed", right: "hem" }, naturalness: 0.9, calm: false,
    text: "One hand lightly touches the edge of the fabric near the detail, showing its weight and texture without covering it." },
];

export const EXPRESSIONS: readonly Expression[] = [
  // The brand's expressions: neutral and serious, lips closed, direct gaze (front and styled); never a smile.
  { id: "neutral_camera", presets: ["front_crop", "full_body", "styled_full"], gaze: "camera", naturalness: 1,
    text: "Neutral, relaxed expression, lips closed, calm direct gaze into the camera." },
  { id: "calm_camera", presets: ["front_crop", "full_body", "styled_full"], gaze: "camera", naturalness: 0.98,
    text: "Calm, composed expression, lips closed, relaxed brow, steady gaze into the camera." },
  { id: "soft_neutral_camera", presets: ["front_crop", "full_body", "styled_full"], gaze: "camera", naturalness: 0.9,
    text: "Soft neutral expression, lips very slightly parted, relaxed eyes looking into the camera." },
  { id: "neutral_away", presets: ["three_quarter", "three_quarter_full"], gaze: "away", naturalness: 1,
    text: "Neutral, relaxed expression, lips closed, gaze off-camera in the direction of the head turn and slightly down." },
  { id: "soft_away", presets: ["styled_full"], gaze: "away", naturalness: 0.85,
    text: "Relaxed, natural expression, lips gently closed or barely parted, gaze off-camera. The same face as in the identity portrait: no added glamour or pout." },
  { id: "none", presets: ["back", "back_full", "detail"], gaze: "none", naturalness: 1,
    text: "" },
];

const poseById = new Map(POSES.map((p) => [p.id, p]));
const exprById = new Map(EXPRESSIONS.map((e) => [e.id, e]));
export const getPose = (id: string) => poseById.get(id);
export const getExpression = (id: string) => exprById.get(id);

/** Presets whose first shot in a set must be the calm main pose. */
const CALM_FIRST: readonly PresetId[] = ["front_crop", "back", "full_body", "three_quarter_full", "back_full"];

const HEM_SENSITIVE: GarmentFlag[] = ["asymmetric_hem", "slit"];
const COVERS_FRONT_CATEGORIES = ["dress", "top", "bodysuit", "knit", ...OUTERWEAR_CATEGORIES];

/** Returns null when compatible, otherwise a human-readable reason. */
export function poseIncompatibility(pose: Pose, preset: PresetId, product: Product, styling: Styling): string | null {
  const def = PRESETS[preset];
  if (!pose.presets.includes(preset)) return `pose is not defined for preset ${preset}`;
  if (!yawAllowed(def, pose.torsoYaw)) return `torso yaw ${pose.torsoYaw} is outside the ${preset} range`;
  if (Math.abs(pose.headYaw) > def.maxHeadYaw) return `head yaw ${pose.headYaw} exceeds ${def.maxHeadYaw} for ${preset}`;
  const arms = [pose.arms.left, pose.arms.right];
  if (arms.includes("pocket") && !product.flags.includes("has_pockets")) return "hand in pocket, but the garment has no pockets";
  if (arms.includes("hem") && product.flags.some((f) => HEM_SENSITIVE.includes(f))) return "hand at hem would hide the asymmetric hem or slit";
  if (arms.includes("hip") && product.flags.includes("cutout")) return "hand on hip could cover a cut-out";
  if (arms.includes("crossed") && COVERS_FRONT_CATEGORIES.includes(product.category)) return "crossed arms cover the front of the product";
  if (arms.includes("bag") && !styling.accessories.some((a) => /bag/i.test(a))) return "pose needs a bag, but styling has none";
  return null;
}

export function expressionIncompatibility(expr: Expression, preset: PresetId): string | null {
  return expr.presets.includes(preset) ? null : `expression is not applicable to preset ${preset}`;
}

const ARM_VISIBILITY: Record<ArmState, number> = { relaxed: 1, hem: 0.85, hip: 0.85, pocket: 0.8, bag: 0.8, crossed: 0.5 };
const visibilityScore = (p: Pose) => (ARM_VISIBILITY[p.arms.left] + ARM_VISIBILITY[p.arms.right]) / 2;

const tieBreak = (seed: string, id: string) => hashOf([seed, id]);

function rank<T extends { id: string }>(items: T[], score: (t: T) => number, seed: string): T[] {
  return [...items].sort((a, b) => {
    const d = score(b) - score(a);
    if (Math.abs(d) > 1e-9) return d;
    const ta = tieBreak(seed, a.id), tb = tieBreak(seed, b.id);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

/** Score band within which choices count as equally good; the seed picks among them. */
const VARIATION_BAND = 0.05;

/**
 * Controlled variation: rank by score, keep everything within VARIATION_BAND of the best,
 * then pick deterministically by seed. Same seed, same choice; different productions vary.
 */
function pickInBand<T extends { id: string }>(items: T[], score: (t: T) => number, seed: string): T | undefined {
  const ranked = rank(items, score, seed);
  if (!ranked.length) return undefined;
  const top = score(ranked[0]!);
  const band = ranked.filter((t) => score(t) >= top - VARIATION_BAND);
  return [...band].sort((a, b) => (tieBreak(seed, a.id) < tieBreak(seed, b.id) ? -1 : 1))[0];
}

export type PosePlan = { assignments: Map<string, PoseAssignment>; conflicts: Conflict[] };

/**
 * Deterministic pose and expression planning per SKU set.
 * Priority: manual locks > compatibility (view + garment) > naturalness > product visibility > variation.
 */
export function planPoses(specs: readonly ImageSpec[], seed: string): PosePlan {
  const assignments = new Map<string, PoseAssignment>();
  const conflicts: Conflict[] = [];
  const bySku = new Map<string, ImageSpec[]>();
  for (const s of specs) bySku.set(s.product.sku, [...(bySku.get(s.product.sku) ?? []), s]);

  for (const [sku, set] of bySku) {
    const usedPoses = new Set<string>();
    const usedExpr = new Set<string>();
    const seenPreset = new Set<PresetId>();

    // Pass 1: validate locked manual choices and reserve them so Auto avoids repeating them.
    const manual = new Map<string, { pose?: string; expr?: string }>();
    for (const s of set) {
      const m: { pose?: string; expr?: string } = {};
      if (s.manualPose !== undefined) {
        const pose = getPose(s.manualPose);
        if (!pose) conflicts.push({ code: "UNKNOWN_POSE", severity: "error", message: `Unknown pose "${s.manualPose}"`, sku, imageSpecId: s.imageSpecId });
        else {
          const why = poseIncompatibility(pose, s.preset, s.product, s.styling);
          if (why) conflicts.push({ code: "MANUAL_POSE_INCOMPATIBLE", severity: "error", message: `Manual pose "${pose.id}": ${why}`, sku, imageSpecId: s.imageSpecId });
          m.pose = pose.id;
          usedPoses.add(pose.id);
        }
      }
      if (s.manualExpression !== undefined) {
        const expr = getExpression(s.manualExpression);
        if (!expr) conflicts.push({ code: "UNKNOWN_EXPRESSION", severity: "error", message: `Unknown expression "${s.manualExpression}"`, sku, imageSpecId: s.imageSpecId });
        else {
          const why = expressionIncompatibility(expr, s.preset);
          if (why) conflicts.push({ code: "MANUAL_EXPRESSION_INCOMPATIBLE", severity: "error", message: `Manual expression "${expr.id}": ${why}`, sku, imageSpecId: s.imageSpecId });
          m.expr = expr.id;
          usedExpr.add(expr.id);
        }
      }
      manual.set(s.imageSpecId, m);
    }

    // Pass 2: plan the unlocked slots in set order.
    for (const s of set) {
      const m = manual.get(s.imageSpecId) ?? {};
      const isFirstOfPreset = !seenPreset.has(s.preset);
      seenPreset.add(s.preset);
      // Main shots (calm-first presets) share one choice across all SKUs of a production, so the gallery stays uniform;
      // other shots vary per SKU.
      const sharedMain = isFirstOfPreset && CALM_FIRST.includes(s.preset);
      const slotSeed = sharedMain ? `${seed}|main|${s.preset}` : `${seed}|${sku}|${s.slotIndex}`;

      let poseId = m.pose;
      if (poseId === undefined && s.manualPose === undefined) {
        let candidates = POSES.filter((p) => poseIncompatibility(p, s.preset, s.product, s.styling) === null);
        if (isFirstOfPreset && CALM_FIRST.includes(s.preset)) {
          // Calm main shot, but never at the cost of repeating a pose already used (e.g. a locked manual one).
          const calm = candidates.filter((p) => p.calm && !usedPoses.has(p.id));
          if (calm.length) candidates = calm;
        }
        if (s.preset === "styled_full") {
          const expressive = candidates.filter((p) => !p.calm);
          if (expressive.length) candidates = expressive;
        }
        // In the styled shot, a pose that uses a styled accessory (it is only offered when the styling has one) wins.
        const accessoryBonus = (p: Pose) => (s.preset === "styled_full" && [p.arms.left, p.arms.right].includes("bag") ? 0.15 : 0);
        const best = pickInBand(candidates, (p) => 0.7 * p.naturalness + 0.3 * visibilityScore(p) + accessoryBonus(p) - (usedPoses.has(p.id) ? 0.5 : 0), slotSeed);
        if (!best) {
          conflicts.push({ code: "NO_COMPATIBLE_POSE", severity: "error", message: `No pose fits ${s.preset} for this garment`, sku, imageSpecId: s.imageSpecId });
          continue;
        }
        poseId = best.id;
        usedPoses.add(best.id);
      }

      let exprId = m.expr;
      if (exprId === undefined && s.manualExpression === undefined) {
        let candidates = EXPRESSIONS.filter((e) => expressionIncompatibility(e, s.preset) === null);
        // The brand's styled shot mostly looks into the camera (gallery analysis); the off-camera variant stays available manually.
        // Main shots stay at the most neutral expression; variation is only allowed in full_body.
        const variation = s.preset === "full_body" || s.preset === "styled_full" ? 0.15 : 0;
        const best = pickInBand(candidates, (e) => e.naturalness - (usedExpr.has(e.id) ? variation : 0), slotSeed);
        exprId = best?.id ?? "none";
        usedExpr.add(exprId);
      }

      if (poseId === undefined || exprId === undefined) continue; // invalid manual input, already reported
      assignments.set(s.imageSpecId, {
        poseId,
        expressionId: exprId,
        poseLocked: s.manualPose !== undefined,
        expressionLocked: s.manualExpression !== undefined,
      });
    }
  }
  return { assignments, conflicts };
}
