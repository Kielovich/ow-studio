import { BOTTOM_CATEGORIES, type Category, type PresetId } from "./schemas";

export type PresetDef = {
  id: PresetId;
  view: "front" | "angle" | "back" | "detail";
  camera: string;
  crop: (category: Category) => string;
  visibility: string;
  /** Is a recognisable face expected in frame? */
  faceVisible: (category: Category) => boolean;
  /** Allowed torso yaw in degrees (0 = facing camera, 180 = back to camera). Absolute value is checked for angle shots. */
  torsoYaw: { min: number; max: number; absolute?: boolean };
  maxHeadYaw: number;
  expressionApplies: boolean;
  feetVisible: (category: Category) => boolean;
};

const isBottom = (c: Category) => BOTTOM_CATEGORIES.includes(c);

const upperCrop = (c: Category) =>
  isBottom(c)
    ? "Crop from mid-chest down to and including the feet; the face may be outside the frame."
    : "Crop from just above the head to mid-thigh.";

/** Full-body framing measured from the brand's reference shots (5 images, 2026-11-13): head top ~3% from the
 * top edge, soles ~4% from the bottom edge, figure ~93% of the frame height, centred. */
const FULL_FRAME =
  "Full body head to toe in a square frame. The top of the head sits about 3% below the top edge and the soles about 4% above the bottom edge, " +
  "so the figure fills about 93% of the frame height. Figure horizontally centred with even space on both sides.";
const FULL_CAMERA = "Camera at hip height, level, normal lens look (about 50 mm equivalent), no wide-angle distortion.";

/**
 * Brand framing per garment type (gallery analysis of 23 products, 2026-11-13): dresses and coats are shown head to toe;
 * tops, bodysuits, knits and jackets head to mid-thigh; trousers, skirts and shorts from below the chest to the feet,
 * face out of frame. The styled shot is always head to toe.
 */
type Framing = "full" | "upper" | "lower";
export const brandFraming = (c: Category): Framing =>
  c === "dress" || c === "coat" ? "full" : BOTTOM_CATEGORIES.includes(c) ? "lower" : "upper";
const BRAND_CROP: Record<Framing, string> = {
  full: `${FULL_FRAME} ${FULL_CAMERA}`,
  upper: "Head to mid-thigh in a square frame: the top of the head about 3% below the top edge, the frame ends at mid-thigh, figure centred. " +
    "Camera at chest height, about 70 mm equivalent, no distortion.",
  lower: "From just below the chest down to and including the feet in a square frame, figure centred; the face is outside the frame. " +
    "Camera at hip height, about 50 mm equivalent, no distortion.",
};

/** The brand's standard gallery: front, three-quarter, back, styled, close-up. */
export const OW_SET: readonly PresetId[] = ["full_body", "three_quarter_full", "back_full", "styled_full", "detail"];

export const PRESETS: Record<PresetId, PresetDef> = {
  front_crop: {
    id: "front_crop",
    view: "front",
    camera: "Straight-on front view, camera at chest height, short telephoto look (about 85 mm full-frame equivalent), no perspective distortion.",
    crop: upperCrop,
    visibility: "The entire front of the garment is visible and unobstructed.",
    faceVisible: (c) => !isBottom(c),
    torsoYaw: { min: -10, max: 10 },
    maxHeadYaw: 15,
    expressionApplies: true,
    feetVisible: (c) => isBottom(c),
  },
  three_quarter: {
    id: "three_quarter",
    view: "angle",
    camera: "Three-quarter view, body turned 30 to 45 degrees from camera, camera at chest height, about 85 mm equivalent.",
    crop: upperCrop,
    visibility: "Side seam, silhouette and the front of the garment are visible.",
    faceVisible: (c) => !isBottom(c),
    torsoYaw: { min: 30, max: 45, absolute: true },
    maxHeadYaw: 60,
    expressionApplies: true,
    feetVisible: (c) => isBottom(c),
  },
  back: {
    id: "back",
    view: "back",
    camera: "Straight-on back view, camera at chest height, about 85 mm equivalent.",
    crop: upperCrop,
    visibility: "The entire back construction is visible: closures, straps, open back and back hem. Hair does not cover it.",
    faceVisible: () => false,
    torsoYaw: { min: 170, max: 190 },
    maxHeadYaw: 45,
    expressionApplies: false,
    feetVisible: (c) => isBottom(c),
  },
  full_body: {
    id: "full_body",
    view: "front",
    camera: `Straight-on front view.`,
    crop: (c) => BRAND_CROP[brandFraming(c)],
    visibility: "The full garment, its length and hem are visible and unobstructed.",
    faceVisible: (c) => brandFraming(c) !== "lower",
    torsoYaw: { min: -10, max: 10 },
    maxHeadYaw: 15,
    expressionApplies: true,
    feetVisible: (c) => brandFraming(c) !== "upper",
  },
  three_quarter_full: {
    id: "three_quarter_full",
    view: "angle",
    camera: `Three-quarter view: body turned 25 to 40 degrees from the camera, head turned a little further in the same direction.`,
    crop: (c) => BRAND_CROP[brandFraming(c)],
    visibility: "Front and side silhouette of the garment are visible; hem and side seam unobstructed.",
    faceVisible: (c) => brandFraming(c) !== "lower",
    torsoYaw: { min: 25, max: 45, absolute: true },
    maxHeadYaw: 60,
    expressionApplies: true,
    feetVisible: (c) => brandFraming(c) !== "upper",
  },
  back_full: {
    id: "back_full",
    view: "back",
    camera: `Straight-on back view.`,
    crop: (c) => BRAND_CROP[brandFraming(c)],
    visibility: "The entire back construction is visible: closures, straps, open back and back hem. Hair does not cover it.",
    faceVisible: () => false,
    torsoYaw: { min: 170, max: 190 },
    maxHeadYaw: 45,
    expressionApplies: false,
    feetVisible: (c) => brandFraming(c) !== "upper",
  },
  styled_full: {
    id: "styled_full",
    view: "front",
    camera: `Front view, the body may angle up to 25 degrees. ${FULL_CAMERA}`,
    crop: () => FULL_FRAME,
    visibility: "The garment stays fully visible; accessories and hands never cover it.",
    faceVisible: () => true,
    torsoYaw: { min: 0, max: 25, absolute: true },
    maxHeadYaw: 45,
    expressionApplies: true,
    feetVisible: () => true,
  },
  detail: {
    id: "detail",
    view: "detail",
    camera: "On-model close-up, straight-on, camera at chest height, short telephoto look (about 100 mm equivalent), fabric in sharp focus.",
    crop: () => "Square close-up from just below the lips down to the upper hips; only the jawline and neck may show, no eyes in frame. Garment centred.",
    visibility: "Neckline, fabric texture, stitching and edge finish are clearly readable.",
    faceVisible: () => false,
    torsoYaw: { min: -20, max: 20 },
    maxHeadYaw: 90,
    expressionApplies: false,
    feetVisible: () => false,
  },
};

export function yawAllowed(preset: PresetDef, yaw: number): boolean {
  const v = preset.torsoYaw.absolute ? Math.abs(yaw) : yaw;
  return v >= preset.torsoYaw.min && v <= preset.torsoYaw.max;
}
