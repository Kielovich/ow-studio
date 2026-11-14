import { garmentConstraintLines } from "./garmentConstraints";
import { silhouetteText } from "./silhouette";
import { getExpression, getPose } from "./poses";
import { brandFraming, PRESETS } from "./presets";
import { BOTTOM_CATEGORIES, OUTERWEAR_CATEGORIES, type ImageSpec, type InstructionBlock, type PoseAssignment } from "./schemas";

/** Bump when any wording below changes. Part of every compileHash. */
export const TEMPLATE_VERSION = "tpl-2026.11.14e";

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

/** Measured hem orientation, stated per view so the model cannot mirror it. */
export function asymmetryText(side: "wearer_right" | "wearer_left", view: "front" | "angle" | "back" | "detail"): string {
  const wearer = side === "wearer_right" ? "right" : "left";
  const frontImage = side === "wearer_right" ? "left" : "right";
  const backImage = frontImage === "left" ? "right" : "left";
  const where = view === "back"
    ? `in this back view it appears on the image ${backImage}`
    : view === "angle"
      ? `in a front or three-quarter view it is on the side that would appear on the image ${frontImage} when facing the camera`
      : `in this front view it appears on the image ${frontImage}`;
  return `Measured hem orientation: the hem is longest on the wearer's ${wearer} side; ${where}. Never mirror the garment.`;
}

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
    `Priority when anything conflicts: 1 garment fidelity to the packshots, 2 identity of the model, 3 body proportions, ` +
    `4 framing and camera, 5 light and photographic style, 6 pose, 7 expression, 8 styling.`);

  add("garment", [
    `Garment: ${p.name} (${p.category}, ${p.color}).${p.description ? " " + p.description : ""}`,
    `Reproduce the garment exactly as shown in the garment reference images: construction, seams, neckline, closures, length, colour, print, texture and transparency. Do not add, remove or redesign any element.`,
    `Silhouette and fit exactly as in the packshot: leg and sleeve width, length and volume. Do not slim, taper, shorten or enlarge the garment to flatter the body.`,
    ...(p.colorHex ? [`Colour lock: the garment's dominant colour measured from the packshot is ${p.colorHex}; reproduce exactly this colour and value under the studio light, no shift in hue or brightness.`] : []),
    ...(p.silhouette && preset !== "detail" ? [silhouetteText(p.silhouette)] : []),
    ...(p.asymmetry ? [asymmetryText(p.asymmetry.hemLowSide, def.view)] : []),
    ...(def.view === "back" && p.packshots.front ? ["The front packshot is attached only to show which side of the garment is which; this photograph shows the back."] : []),
    ...garmentConstraintLines(p.asymmetry ? p.flags.filter((f) => f !== "asymmetric_hem") : p.flags, preset),
  ].join(" "));

  if (face) {
    add("identity",
      `Identity: the same woman as in the identity reference images. ${capitalize(m.look.features)}; ${m.look.eyes}; ${m.look.skinTone} skin; ${hairForPrompt(m.look.hair)}. ` +
      `Keep bone structure, face shape, nose, lip shape, eye shape, skin tone, skin texture, freckles and hair colour identical to the identity portrait in every shot of this session; ` +
      `pose, head angle and expression may change only gaze, eyelids and mouth, never the facial structure. ` +
      `Keep her exactly as she is, with her natural facial asymmetry and real proportions; do not beautify, idealise, slim or correct symmetry. ` +
      (st.hairState ? `Hair styled for this production: ${st.hairState}.` : `Hair: her own hairstyle as in the identity portrait.`) +
      ` ${REAL_HAIR}` +
      (st.makeup ? ` Makeup for this production: ${st.makeup}` : ` Makeup: as in the identity portrait, with the lips in a satin or matte finish showing natural lip lines, never glossy or wet-looking.`) +
      ` ${REAL_FACE}`);
  } else if (def.view === "back" && brandFraming(p.category) === "lower") {
    // Bottoms are framed from below the chest: describing hair here pulled the head into the frame (realism round 1-2).
    add("identity", `Back view of the lower body; the head and hair are outside the frame. Skin tone: ${m.look.skinTone}.`);
  } else if (def.view === "back") {
    add("identity",
      `Back view: hair as in the character sheet (${hairForPrompt(m.look.hair)})${st.hairState ? `, styled for this production: ${st.hairState}` : ""}. ` +
      `${REAL_HAIR} The face is not visible. Hair must not cover the back of the garment or any closure.`);
  } else if (def.view === "detail") {
    add("identity", `Skin, where visible: ${m.look.skinTone}, with natural texture. No face in frame.`);
  } else {
    add("identity", `Skin tone: ${m.look.skinTone}. Body as in the full-body reference; the head is outside the frame.`);
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
    `Lighting: a large soft key light high and slightly to one side of the camera, bright and even enough for e-commerce, with gentle fall-off across the body ` +
    // The style block stays byte-identical across a session's shots and names no face features: describing hair or face
    // features pulled the head into crops that must not show it (rounds 1-2). Facial detail lives in the identity block.
    `so the body keeps soft natural modelling; the light never adds folds, gathers or creases that the garment does not have; ` +
    `fill ratio about 1:4, soft contact shadows where the garment meets the body, neutral daylight around 5200 K; ` +
    `the light sources themselves are never in the picture (no softboxes, lamps, stands or studio equipment in frame); soft natural shadows` +
    (def.feetVisible(p.category) ? `, a soft contact shadow under the feet` : ``) + `. ` +
    `Colour: neutral, true to the garment; blacks keep detail. ` +
    `Skin and retouching: true photographic skin as from a full-frame camera, natural micro-contrast and very subtle grain; skin luminance comes from the light alone, with no beauty-filter effect; raw, unretouched-looking skin of a real person. ` +
    `Body skin is real too: knees, elbows and knuckles with natural creases and slightly different tone, faint veins where skin is thin, subtle unevenness, no airbrushed or evenly tanned limbs. ` +
    `${REAL_HANDS} ${REAL_BODY}` +
    (spec.anchorAsset
      ? ` This photograph belongs to the same studio session as the attached session reference: keep lighting, colour, hair, makeup and the way the garment sits on the body consistent with it.`
      : ``));

  const pose = getPose(a.poseId);
  if (pose) add("pose", `Pose: ${pose.text}${def.feetVisible(p.category) ? "" : " The legs continue naturally below the frame; the feet are not in the picture."}`);

  const expr = getExpression(a.expressionId);
  if (expr && face && def.expressionApplies) add("expression", `Expression: ${expr.text}`);

  const styling: string[] = [];
  if (OUTERWEAR_CATEGORIES.includes(p.category) && st.innerTop) styling.push(`worn over: ${st.innerTop}`);
  if (BOTTOM_CATEGORIES.includes(p.category) && st.top) styling.push(`top: ${st.top}`);
  if (!BOTTOM_CATEGORIES.includes(p.category) && p.category !== "dress" && st.bottoms) styling.push(`bottoms: ${st.bottoms}`);
  if (def.feetVisible(p.category) && st.footwear) styling.push(`footwear: ${st.footwear}`);
  if (def.feetVisible(p.category) && st.legwear) styling.push(`legwear: ${st.legwear}`);
  if (preset === "styled_full" && st.accessories.length) styling.push(`accessories: ${st.accessories.join(", ")}`);
  if (styling.length) add("styling", `Styling (secondary, must not draw attention from the garment): ${styling.join("; ")}.`);

  return blocks.sort((x, y) => x.priority - y.priority);
}

/**
 * Model hair descriptions from the first model library ask for "no loose strands" or "a crisp hairline", which contradicts
 * REAL_HAIR in every prompt. Those phrases are removed when the description is used; the style itself is kept.
 */
export function hairForPrompt(hair: string): string {
  return hair
    .replace(/,?\s*no loose strands/gi, "")
    .replace(/\s*with a crisp hairline/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/, "")
    .trim();
}

/** Realism language from the realism audit (docs/realism-audit.md): the defects AI models fall into by default. */
export const REAL_HAIR = "Real hair, not a helmet: keep the style, but with a few fine flyaways and baby hairs along the hairline and crown, individual strands visible at the edges, and natural variation in shine.";
export const REAL_FACE = "Facial skin: pores visible on the nose, cheeks and forehead, fine peach fuzz, small natural asymmetries, natural sheen only on the high points of the face; a soft natural shadow under the chin.";
// Worded so it never contradicts a pose: a hand holding a bag or touching the hem keeps doing that.
export const REAL_HANDS = "Any hand that is not holding or touching something hangs loosely: fingers relaxed and slightly apart with a gentle natural curve, the thumb resting alongside the index finger, each hand slightly different, natural short nails.";
export const REAL_BODY = "The body carries real weight: shoulders relaxed, the posture natural rather than mannequin-straight.";

export function buildExclusions(spec: ImageSpec): string[] {
  const def = PRESETS[spec.preset];
  const ex = [
    "text, logos, watermarks or brand marks not present on the garment",
    "any change to garment colour, length, neckline, closures or transparency",
    "extra garments or layers covering the product",
    "smoothed, waxy or plastic-looking skin, airbrushed legs or arms",
    "CGI or 3D-render look, beauty-filter skin",
    "extra, missing or fused fingers; distorted hands or limbs",
    "props, furniture or background texture",
    "softboxes, lamps, light stands or any studio equipment in frame",
  ];
  const face = def.faceVisible(spec.product.category);
  // Hair and lip exclusions only where hair or lips can be in frame, so they never invite a head into a crop without one.
  const hairInFrame = face || (def.view === "back" && brandFraming(spec.product.category) !== "lower");
  if (hairInFrame) ex.splice(4, 0, "helmet-like hair without a single loose strand");
  if (face) ex.splice(5, 0, "glossy or wet-looking lips");
  if (!face) ex.push("a face visible to the camera");
  return ex;
}
