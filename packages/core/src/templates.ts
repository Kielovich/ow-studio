import { garmentConstraintLines } from "./garmentConstraints.js";
import { silhouetteText } from "./silhouette.js";
import { getExpression, getPose } from "./poses.js";
import { PRESETS } from "./presets.js";
import { BOTTOM_CATEGORIES, OUTERWEAR_CATEGORIES, type ImageSpec, type InstructionBlock, type PoseAssignment } from "./schemas.js";

/** Bump when any wording below changes. Part of every compileHash. */
export const TEMPLATE_VERSION = "tpl-2026.11.4";

/** Instruction priorities. Lower number wins when instructions conflict. */
export const PRIORITY = {
  safety: 1,
  garment: 2,
  identity: 3,
  body: 4,
  framing: 5,
  style: 6,
  pose: 7,
  expression: 8,
  styling: 9,
} as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildBlocks(spec: ImageSpec, a: PoseAssignment): InstructionBlock[] {
  const { product: p, model: m, styling: st, style, preset } = spec;
  const def = PRESETS[preset];
  const face = def.faceVisible(p.category);
  const blocks: InstructionBlock[] = [];
  const add = (key: keyof typeof PRIORITY, text: string) => {
    if (text.trim()) blocks.push({ priority: PRIORITY[key], key, text });
  };

  add("safety",
    `Professional e-commerce fashion photograph of an original fictional adult woman, ${m.ageYears} years old. ` +
    `She is not a real or identifiable person and must not resemble one. ` +
    `If any instruction below conflicts, follow the earlier section.`);

  add("garment", [
    `Garment: ${p.name} (${p.category}, ${p.color}).${p.description ? " " + p.description : ""}`,
    `Reproduce the garment exactly as shown in the garment reference images: construction, seams, neckline, closures, length, colour, print, texture and transparency. Do not add, remove or redesign any element.`,
    `Silhouette and fit exactly as in the packshot: leg and sleeve width, length and volume. Do not slim, taper, shorten or enlarge the garment to flatter the body.`,
    ...(p.silhouette && preset !== "detail" ? [silhouetteText(p.silhouette)] : []),
    ...garmentConstraintLines(p.flags, preset),
  ].join(" "));

  if (face) {
    add("identity",
      `Identity: the same woman as in the identity reference images. ${capitalize(m.look.features)};${m.look.eyes}; ${m.look.skinTone} skin; ${m.look.hair}. ` +
      `Keep bone structure, facial features, skin tone and hair colour identical to the references; makeup and hair styling follow this brief, not the references. Hair styled: ${st.hairState}.` +
      (st.makeup ? ` Makeup: ${st.makeup}` : ""));
  } else if (def.view === "back") {
    add("identity",
      `Back view: hair colour and length as in the character sheet (${m.look.hair}), styled: ${st.hairState}. ` +
      `The face is not visible. Hair must not cover the back of the garment or any closure.`);
  } else if (def.view === "detail") {
    add("identity", `Skin, where visible: ${m.look.skinTone}, with natural texture. No face in frame.`);
  } else {
    add("identity", `Skin tone: ${m.look.skinTone}. Body as in the full-body reference; the face may be outside the frame.`);
  }

  if (preset !== "detail") {
    add("body",
      `Body: ${m.heightCm} cm tall, EU size ${m.euSize}, proportions exactly as in the full-body reference. ` +
      `The garment fits as it would on EU size ${m.euSize}: natural tension and folds where it meets the body.`);
  }

  add("framing", `${def.camera} ${def.crop(p.category)} ${def.visibility}`);

  const [r, g, b] = style.background;
  add("style",
    `Background: seamless flat neutral grey, RGB ${r},${g},${b}, no gradient, no vignette, no props. ` +
    `Lighting: soft, high frontal key light with low contrast and soft natural shadows` +
    (def.feetVisible(p.category) ? `, soft contact shadow under the feet` : ``) + `. ` +
    `Colour: neutral, true to the garment; blacks keep detail. ` +
    `Retouching: clean but natural, real skin texture, pores and small asymmetries kept; no smoothing or plastic look.`);

  const pose = getPose(a.poseId);
  if (pose) add("pose", `Pose: ${pose.text}`);

  const expr = getExpression(a.expressionId);
  if (expr && face && def.expressionApplies) add("expression", `Expression: ${expr.text}`);

  const styling: string[] = [];
  if (OUTERWEAR_CATEGORIES.includes(p.category) && st.innerTop) styling.push(`worn over: ${st.innerTop}`);
  if (BOTTOM_CATEGORIES.includes(p.category) && st.top) styling.push(`top: ${st.top}`);
  if (!BOTTOM_CATEGORIES.includes(p.category) && p.category !== "dress" && st.bottoms) styling.push(`bottoms: ${st.bottoms}`);
  if (def.feetVisible(p.category) && st.footwear) styling.push(`footwear: ${st.footwear}`);
  if (def.feetVisible(p.category) && st.legwear) styling.push(`legwear: ${st.legwear}`);
  if (preset === "full_body" && st.accessories.length) styling.push(`accessories: ${st.accessories.join(", ")}`);
  if (styling.length) add("styling", `Styling (secondary, must not draw attention from the garment): ${styling.join("; ")}.`);

  return blocks.sort((x, y) => x.priority - y.priority);
}

export function buildExclusions(spec: ImageSpec): string[] {
  const def = PRESETS[spec.preset];
  const ex = [
    "text, logos, watermarks or brand marks not present on the garment",
    "any change to garment colour, length, neckline, closures or transparency",
    "extra garments or layers covering the product",
    "smoothed, waxy or plastic-looking skin",
    "extra, missing or fused fingers; distorted hands or limbs",
    "props, furniture or background texture",
  ];
  if (!def.faceVisible(spec.product.category)) ex.push("a face visible to the camera");
  return ex;
}
