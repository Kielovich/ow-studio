import { BOTTOM_CATEGORIES, type Category, type PresetId } from "./schemas.js";

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
    camera: "Front view, camera at waist height, normal lens look (about 50 to 70 mm equivalent).",
    crop: () => "Head to toe, 5 to 8 percent margin above the head and below the feet, figure centred.",
    visibility: "Full garment length and hem are visible.",
    faceVisible: () => true,
    torsoYaw: { min: -15, max: 15 },
    maxHeadYaw: 30,
    expressionApplies: true,
    feetVisible: () => true,
  },
  detail: {
    id: "detail",
    view: "detail",
    camera: "Close-up, frontal or slight angle, macro-like detail, shallow but sufficient depth of field to keep the fabric sharp.",
    crop: () => "Tight crop on one garment section (texture, closure, neckline or edge). Skin occupies at most 40 percent of the frame. No face in frame.",
    visibility: "Fabric texture, stitching and edge finish are in sharp focus.",
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
