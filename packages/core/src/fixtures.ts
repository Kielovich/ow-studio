import { sha256Hex } from "./canonical";
import type { ProductionSpecInput } from "./schemas";

/** Deterministic fake asset hash for fixtures. */
export const asset = (label: string) => `sha256:${sha256Hex(label)}`;

export const MODEL_SABLE = {
  modelId: "M01",
  version: 1,
  displayName: "Sable",
  ageYears: 24,
  heightCm: 178,
  euSize: 36,
  look: {
    hair: "long straight dark-brown hair",
    skinTone: "olive",
    eyes: "dark-brown eyes",
    features: "straight brows, narrow jaw, defined cheekbones",
  },
  refs: {
    primaryPortrait: asset("M01v1/portrait"),
    identityAngles: [asset("M01v1/angle-3q-left")],
    fullBodyFront: asset("M01v1/body-front"),
    fullBodyBack: asset("M01v1/body-back"),
    characterSheet: asset("M01v1/character-sheet"),
    facialDetailSheet: asset("M01v1/facial-detail"),
    expressionSheet: asset("M01v1/expression-sheet"),
  },
};

export const PRODUCT_MESH_MAXI = {
  sku: "TEST-DR-001",
  name: "Sheer mesh maxi dress",
  category: "dress" as const,
  color: "black",
  description: "Long-sleeve sheer mesh maxi dress with a fitted, lined bustier bodice and hidden back zip.",
  flags: ["sheer", "long_sleeve"] as ("sheer" | "long_sleeve")[],
  packshots: { front: asset("TEST-DR-001/front"), back: asset("TEST-DR-001/back") },
};

export const PRODUCT_HALTER_TOP = {
  sku: "TEST-TP-002",
  name: "Satin halter top",
  category: "top" as const,
  color: "black",
  description: "Satin halter top with a deep V neckline, gathered bust, ruched waistband and open back.",
  flags: ["satin", "halter", "open_back"] as ("satin" | "halter" | "open_back")[],
  packshots: { front: asset("TEST-TP-002/front"), back: asset("TEST-TP-002/back"), detail: asset("TEST-TP-002/detail") },
};

export const PRODUCT_SUIT_PANTS = {
  sku: "TEST-PT-003",
  name: "Straight-leg suit trousers",
  category: "trousers" as const,
  color: "black",
  description: "Low-rise straight-leg suit trousers with zip and button closure and front slant pockets.",
  flags: ["has_pockets", "front_closure"] as ("has_pockets" | "front_closure")[],
  packshots: { front: asset("TEST-PT-003/front"), back: asset("TEST-PT-003/back") },
};

export function exampleSpec(overrides: Partial<ProductionSpecInput> = {}): ProductionSpecInput {
  return {
    productionId: "prod_test_0001",
    model: MODEL_SABLE,
    products: [PRODUCT_MESH_MAXI, PRODUCT_HALTER_TOP, PRODUCT_SUIT_PANTS],
    slots: [{ preset: "front_crop" }, { preset: "three_quarter" }, { preset: "back" }, { preset: "full_body" }, { preset: "detail" }],
    styling: {
      hairState: "sleek, tucked behind the ears",
      bottoms: "straight light-blue jeans",
      footwear: "black pointed slingback heels",
      accessories: ["small black leather shoulder bag"],
    },
    style: { background: [241, 241, 241], aspectRatio: "1:1", longEdgePx: 2000 },
    providerProfileId: "mock",
    ...overrides,
  };
}
