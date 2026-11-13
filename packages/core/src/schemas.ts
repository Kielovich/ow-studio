import { z } from "zod";

/** Content-addressed asset reference. Files are never referenced by path. */
export const AssetHash = z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<64 hex>");
export type AssetHash = z.infer<typeof AssetHash>;

export const Category = z.enum([
  "dress", "top", "bodysuit", "trousers", "skirt", "shorts", "jacket", "coat", "knit",
]);
export type Category = z.infer<typeof Category>;

export const BOTTOM_CATEGORIES: readonly Category[] = ["trousers", "skirt", "shorts"];
export const OUTERWEAR_CATEGORIES: readonly Category[] = ["jacket", "coat"];

export const GarmentFlag = z.enum([
  "sheer", "lace", "sequin", "fur", "leather", "coated", "satin", "denim",
  "open_back", "asymmetric_hem", "one_shoulder", "halter", "long_sleeve",
  "has_pockets", "front_closure", "slit", "cutout",
]);
export type GarmentFlag = z.infer<typeof GarmentFlag>;

export const PackshotSlot = z.enum(["front", "back", "detail", "side"]);
export type PackshotSlot = z.infer<typeof PackshotSlot>;

export const PresetId = z.enum(["front_crop", "three_quarter", "back", "full_body", "three_quarter_full", "back_full", "styled_full", "detail"]);
export type PresetId = z.infer<typeof PresetId>;

/** Arrays that are semantically sets: deduplicated and sorted so order never affects hashes. */
const setOf = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).transform((a) => [...new Set(a)].sort());

export const Product = z.object({
  sku: z.string().regex(/^[A-Za-z0-9._-]+$/, "SKU may only contain letters, digits, . _ -"),
  name: z.string().min(1),
  category: Category,
  color: z.string().min(1),
  description: z.string().default(""),
  flags: setOf(GarmentFlag).default([]),
  /** Measured from the packshots at ingest (see silhouette.ts): which side of the wearer the hem is longest on. */
  asymmetry: z.object({
    hemLowSide: z.enum(["wearer_right", "wearer_left"]),
    /** false when the back packshot points the other way (one of the packshots is probably mirrored). */
    backAgrees: z.boolean().optional(),
  }).optional(),
  /** Measured from the front packshot at ingest (see silhouette.ts). */
  silhouette: z.object({ kind: z.literal("bottoms"), hemToThigh: z.number().min(0.2).max(2), hemSpanToHip: z.number().min(0.2).max(2) }).optional(),
  packshots: z
    .object({
      front: AssetHash.optional(),
      back: AssetHash.optional(),
      detail: AssetHash.optional(),
      side: AssetHash.optional(),
    })
    .strict(),
});
export type Product = z.infer<typeof Product>;

export const ModelRefs = z
  .object({
    primaryPortrait: AssetHash,
    identityAngles: z.array(AssetHash).max(3).default([]),
    fullBodyFront: AssetHash,
    fullBodyBack: AssetHash,
    characterSheet: AssetHash,
    facialDetailSheet: AssetHash,
    expressionSheet: AssetHash.optional(),
  })
  .strict();

export const ModelVersion = z.object({
  modelId: z.string().min(1),
  version: z.number().int().positive(),
  displayName: z.string().min(1),
  /** Fictional adults only. Hard floor of 18; the casting policy uses 21+. */
  ageYears: z.number().int().min(18).max(60),
  heightCm: z.number().int().min(150).max(200),
  euSize: z.number().int().min(30).max(50),
  look: z.object({
    hair: z.string().min(1),
    skinTone: z.string().min(1),
    eyes: z.string().min(1),
    features: z.string().min(1),
  }),
  refs: ModelRefs,
});
export type ModelVersion = z.infer<typeof ModelVersion>;

export const Styling = z.object({
  /** Optional override. Empty means: the model's own hairstyle, exactly as in her identity portrait. */
  hairState: z.string().optional(),
  /** Hair and makeup brief for the production. The identity references stay makeup-free. */
  makeup: z.string().optional(),
  bottoms: z.string().optional(),
  /** Top worn with bottoms products (trousers, skirts, shorts). */
  top: z.string().optional(),
  /** Worn under outerwear products (e.g. a plain top under an open jacket). */
  innerTop: z.string().optional(),
  footwear: z.string().optional(),
  legwear: z.string().optional(),
  /** Only rendered in the styled full-body shot. */
  accessories: setOf(z.string().min(1)).default([]),
  /** A layer worn over the product. Not allowed unless the product itself is outerwear. */
  outerLayer: z.string().optional(),
});
export type Styling = z.infer<typeof Styling>;

export const AspectRatio = z.enum(["1:1", "4:5", "2:3"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

export const PhotoStyle = z.object({
  background: z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]).default([241, 241, 241]),
  aspectRatio: AspectRatio.default("1:1"),
  longEdgePx: z.number().int().min(512).max(8192).default(2000),
});
export type PhotoStyle = z.infer<typeof PhotoStyle>;

export const SlotRequest = z.object({
  preset: PresetId,
  /** Manual pose id. A manual choice is locked: Auto never overrides it. */
  pose: z.string().optional(),
  /** Manual expression id. Locked like pose. */
  expression: z.string().optional(),
});
export type SlotRequest = z.infer<typeof SlotRequest>;

export const ProductionSpec = z
  .object({
    productionId: z.string().min(1),
    model: ModelVersion,
    products: z.array(Product).min(1).transform((ps) => [...ps].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))),
    /** Ordered: the order of slots is part of the set design (first front shot is the calm main shot). */
    slots: z.array(SlotRequest).min(1),
    styling: Styling,
    style: PhotoStyle.default({}),
    providerProfileId: z.string().min(1),
    /** Seed for pose and expression planning. Set from the draft content so preview and run plan identically. Defaults to productionId. */
    seed: z.string().min(1).optional(),
    /** Generate the front shot first and use it as the shared session reference for the other shots of the same SKU. */
    sessionAnchor: z.boolean().default(true),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const p of spec.products) {
      if (seen.has(p.sku)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate SKU ${p.sku}`, path: ["products"] });
      seen.add(p.sku);
    }
  });
export type ProductionSpecInput = z.input<typeof ProductionSpec>;
export type ProductionSpec = z.infer<typeof ProductionSpec>;

export const ProviderProfile = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  /** Only true after a capability test against the real provider. */
  verified: z.boolean(),
  maxRefs: z.number().int().min(0).max(32),
  /** Optional sub-limit for person references (identity, body, face, expression). */
  maxIdentityRefs: z.number().int().min(0).max(32).optional(),
  supportsSeed: z.boolean(),
  supportsIdempotencyKey: z.boolean(),
  aspectRatios: z.array(AspectRatio).min(1),
  maxLongEdgePx: z.number().int().positive(),
  concurrency: z.number().int().positive(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type ProviderProfile = z.infer<typeof ProviderProfile>;

export type ImageSpec = {
  imageSpecId: string;
  productionId: string;
  slotIndex: number;
  preset: PresetId;
  product: Product;
  model: ModelVersion;
  styling: Styling;
  style: PhotoStyle;
  manualPose?: string;
  manualExpression?: string;
  /** imageSpecId of this SKU's session anchor (the front shot) when this image depends on it. */
  dependsOn?: string;
  /** Final image of the anchor, frozen into this request once the anchor has succeeded. */
  anchorAsset?: AssetHash;
};

export type Severity = "error" | "warning";
export type Conflict = {
  code: string;
  severity: Severity;
  message: string;
  sku?: string;
  imageSpecId?: string;
};

export const Attribute = z.enum(["garment", "fit", "identity", "facial_detail", "hair", "body", "expression", "pose", "session", "orientation"]);
export type Attribute = z.infer<typeof Attribute>;

export const RefRole = z.enum([
  "garment_front", "garment_back", "garment_detail", "garment_side",
  "identity_primary", "identity_angle", "character_sheet", "facial_detail",
  "body_front", "body_back", "expression_sheet", "pose",
  "session_anchor", "garment_orientation",
]);
export type RefRole = z.infer<typeof RefRole>;

export type RefSlot = { role: RefRole; asset: AssetHash; controls: Attribute[] };

export type PoseAssignment = {
  poseId: string;
  expressionId: string;
  poseLocked: boolean;
  expressionLocked: boolean;
};

export type InstructionBlock = { priority: number; key: string; text: string };

export type CompiledRequest = {
  compilerVersion: string;
  templateVersion: string;
  providerProfile: { id: string; version: number };
  imageSpecId: string;
  sku: string;
  preset: PresetId;
  assignment: PoseAssignment;
  instructionBlocks: InstructionBlock[];
  exclusions: string[];
  prompt: string;
  refs: RefSlot[];
  params: { aspectRatio: AspectRatio; width: number; height: number; seed?: number };
  /** Set on shots that wait for the session anchor; the request is recompiled with the anchor before first submission. */
  dependsOn?: string;
  compileHash: string;
};
