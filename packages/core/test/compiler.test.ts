import { describe, expect, it } from "vitest";
import { canonicalJson, compileProduction, MOCK_PROFILE, PRESETS, type ProviderProfile } from "../src/index.js";
import { asset, exampleSpec, PRODUCT_HALTER_TOP, PRODUCT_MESH_MAXI, PRODUCT_SUIT_PANTS } from "../src/fixtures.js";

const hashes = (r: ReturnType<typeof compileProduction>) => r.images.map((i) => [i.imageSpecId, i.compileHash]);

describe("canonical form", () => {
  it("ignores key order, whitespace and Unicode normalisation", () => {
    const a = { b: "Café  au\tlait", a: 1, c: undefined };
    const b = { a: 1, b: " Café au lait " };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("compiler determinism", () => {
  it("produces identical output for identical input", () => {
    const a = compileProduction(exampleSpec(), MOCK_PROFILE);
    const b = compileProduction(exampleSpec(), MOCK_PROFILE);
    expect(JSON.stringify(a.images)).toBe(JSON.stringify(b.images));
    expect(a.specHash).toBe(b.specHash);
  });

  it("is invariant to product order, flag order and accessory order", () => {
    const a = compileProduction(exampleSpec(), MOCK_PROFILE);
    const b = compileProduction(
      exampleSpec({
        products: [
          PRODUCT_SUIT_PANTS,
          { ...PRODUCT_HALTER_TOP, flags: ["open_back", "satin", "halter", "satin"] },
          { ...PRODUCT_MESH_MAXI, flags: ["long_sleeve", "sheer"] },
        ],
        styling: { ...exampleSpec().styling!, accessories: ["small black leather shoulder bag", "small black leather shoulder bag"] },
      }),
      MOCK_PROFILE,
    );
    expect(b.specHash).toBe(a.specHash);
    expect(new Map(hashes(b) as [string, string][])).toEqual(new Map(hashes(a) as [string, string][]));
  });

  it("changes every hash when the compiler or template version changes", () => {
    const a = compileProduction(exampleSpec(), MOCK_PROFILE);
    const b = compileProduction(exampleSpec(), MOCK_PROFILE, { compilerVersion: "9.9.9", templateVersion: a.images[0]!.templateVersion });
    const c = compileProduction(exampleSpec(), MOCK_PROFILE, { compilerVersion: a.images[0]!.compilerVersion, templateVersion: "tpl-x" });
    a.images.forEach((img, i) => {
      expect(b.images[i]!.compileHash).not.toBe(img.compileHash);
      expect(c.images[i]!.compileHash).not.toBe(img.compileHash);
    });
  });

  it("changes the hash when a model reference is replaced (new version)", () => {
    const a = compileProduction(exampleSpec(), MOCK_PROFILE);
    const spec = exampleSpec();
    const model = { ...(spec.model as any), version: 2, refs: { ...(spec.model as any).refs, primaryPortrait: asset("M01v2/portrait") } };
    const b = compileProduction({ ...spec, model }, MOCK_PROFILE);
    const front = (r: typeof a) => r.images.find((i) => i.sku === "TEST-DR-001" && i.preset === "front_crop")!;
    expect(front(b).compileHash).not.toBe(front(a).compileHash);
    expect(front(b).imageSpecId).toBe(front(a).imageSpecId);
  });

  it("matches the golden output", () => {
    const r = compileProduction(exampleSpec(), MOCK_PROFILE);
    expect(r.canRun).toBe(true);
    expect(r.images.map((i) => ({ id: i.imageSpecId, preset: i.preset, sku: i.sku, hash: i.compileHash, pose: i.assignment.poseId, expr: i.assignment.expressionId, refs: i.refs.map((x) => x.role) })))
      .toMatchSnapshot();
    expect(r.images.find((i) => i.sku === "TEST-TP-002" && i.preset === "front_crop")!.prompt).toMatchSnapshot();
  });
});

describe("instruction priorities", () => {
  it("orders blocks safety > garment > identity > body > framing > style > pose > expression > styling", () => {
    const r = compileProduction(exampleSpec(), MOCK_PROFILE);
    const img = r.images.find((i) => i.sku === "TEST-TP-002" && i.preset === "full_body")!;
    expect(img.instructionBlocks.map((b) => b.key)).toEqual(["safety", "garment", "identity", "body", "framing", "style", "pose", "expression", "styling"]);
  });

  it("keeps the identical garment description across all presets of a SKU", () => {
    const r = compileProduction(exampleSpec(), MOCK_PROFILE);
    const firstLine = (s: string) => s.split(". Reproduce")[0];
    const lines = new Set(r.images.filter((i) => i.sku === "TEST-DR-001").map((i) => firstLine(i.instructionBlocks.find((b) => b.key === "garment")!.text)));
    expect(lines.size).toBe(1);
  });

  it("never asks for a face in back or detail views, and drops the face for trousers front crop", () => {
    const r = compileProduction(exampleSpec(), MOCK_PROFILE);
    for (const i of r.images) {
      const noFace = i.preset === "back" || i.preset === "detail" || (i.sku === "TEST-PT-003" && (i.preset === "front_crop" || i.preset === "three_quarter"));
      expect(i.exclusions.includes("a face visible to the camera")).toBe(noFace);
      expect(i.instructionBlocks.some((b) => b.key === "expression")).toBe(!noFace);
    }
    expect(PRESETS.back.faceVisible("dress")).toBe(false);
  });
});

describe("conflicts", () => {
  const codes = (r: ReturnType<typeof compileProduction>) => r.conflicts.map((c) => c.code);

  it("blocks a back image without a back packshot", () => {
    const r = compileProduction(exampleSpec({ products: [{ ...PRODUCT_MESH_MAXI, packshots: { front: PRODUCT_MESH_MAXI.packshots.front } }] }), MOCK_PROFILE);
    expect(codes(r)).toContain("MISSING_PACKSHOT");
    expect(r.canRun).toBe(false);
  });

  it("blocks an outer layer that would cover the product", () => {
    const r = compileProduction(exampleSpec({ styling: { ...exampleSpec().styling!, outerLayer: "black wool coat" } }), MOCK_PROFILE);
    expect(codes(r)).toContain("STYLING_COVERS_PRODUCT");
    expect(r.canRun).toBe(false);
  });

  it("rejects a manual pose that conflicts with the preset instead of overriding it", () => {
    const r = compileProduction(exampleSpec({ slots: [{ preset: "back", pose: "front_neutral" }] }), MOCK_PROFILE);
    expect(codes(r)).toContain("MANUAL_POSE_INCOMPATIBLE");
    expect(r.images.every((i) => i.assignment.poseId === "front_neutral" && i.assignment.poseLocked)).toBe(true);
    expect(r.canRun).toBe(false);
  });

  it("rejects hands in pockets on a garment without pockets", () => {
    const r = compileProduction(exampleSpec({ products: [PRODUCT_MESH_MAXI], slots: [{ preset: "front_crop", pose: "front_hand_pocket" }] }), MOCK_PROFILE);
    expect(r.conflicts.find((c) => c.code === "MANUAL_POSE_INCOMPATIBLE")?.message).toMatch(/no pockets/);
  });

  it("rejects unknown pose and expression ids", () => {
    const r = compileProduction(exampleSpec({ slots: [{ preset: "front_crop", pose: "nope", expression: "nada" }] }), MOCK_PROFILE);
    expect(codes(r)).toEqual(expect.arrayContaining(["UNKNOWN_POSE", "UNKNOWN_EXPRESSION"]));
  });

  it("warns when an open-back garment has no back image", () => {
    const r = compileProduction(exampleSpec({ products: [PRODUCT_HALTER_TOP], slots: [{ preset: "front_crop" }] }), MOCK_PROFILE);
    expect(codes(r)).toContain("OPEN_BACK_NO_BACK_PRESET");
    expect(r.canRun).toBe(true);
  });

  it("flags provider limits: unsupported aspect, resolution and unverified profile", () => {
    const p: ProviderProfile = { ...MOCK_PROFILE, id: "mock", verified: false, aspectRatios: ["1:1"], maxLongEdgePx: 1024 };
    const r = compileProduction(exampleSpec({ style: { aspectRatio: "4:5", longEdgePx: 2000 } }), p);
    expect(codes(r)).toEqual(expect.arrayContaining(["UNSUPPORTED_ASPECT", "RESOLUTION_TOO_HIGH", "PROFILE_UNVERIFIED"]));
  });

  it("rejects duplicate SKUs and under-age models at parse time", () => {
    expect(() => compileProduction(exampleSpec({ products: [PRODUCT_MESH_MAXI, PRODUCT_MESH_MAXI] }), MOCK_PROFILE)).toThrow(/Duplicate SKU/);
    expect(() => compileProduction(exampleSpec({ model: { ...(exampleSpec().model as any), ageYears: 17 } }), MOCK_PROFILE)).toThrow();
  });
});
