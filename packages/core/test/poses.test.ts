import { describe, expect, it } from "vitest";
import { compileProduction, GarmentFlag, getPose, OW_SET, MOCK_PROFILE, poseIncompatibility, PresetId, Category, type Product, Styling } from "../src/index";
import { asset, exampleSpec, PRODUCT_HALTER_TOP, PRODUCT_SUIT_PANTS } from "../src/fixtures";

/** Tiny deterministic PRNG so the "random" sweep is reproducible. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("pose planning", () => {
  it("is deterministic for the same production", () => {
    const a = compileProduction(exampleSpec(), MOCK_PROFILE).images.map((i) => i.assignment);
    const b = compileProduction(exampleSpec(), MOCK_PROFILE).images.map((i) => i.assignment);
    expect(b).toEqual(a);
  });

  it("uses the calmest pose for the first front and back shot of every set", () => {
    const r = compileProduction(exampleSpec(), MOCK_PROFILE);
    for (const i of r.images.filter((x) => x.preset === "front_crop" || x.preset === "back")) {
      expect(getPose(i.assignment.poseId)!.calm).toBe(true);
    }
  });

  it("does not repeat a pose within a set when alternatives exist", () => {
    const r = compileProduction(exampleSpec({ products: [PRODUCT_SUIT_PANTS], slots: [{ preset: "full_body" }, { preset: "full_body" }, { preset: "full_body" }] }), MOCK_PROFILE);
    const ids = r.images.map((i) => i.assignment.poseId);
    expect(new Set(ids).size).toBe(3);
  });

  it("never overrides a locked manual pose and plans around it", () => {
    const r = compileProduction(exampleSpec({ products: [PRODUCT_SUIT_PANTS], slots: [{ preset: "front_crop" }, { preset: "front_crop", pose: "front_neutral" }] }), MOCK_PROFILE);
    const [auto, manual] = r.images;
    expect(manual!.assignment).toMatchObject({ poseId: "front_neutral", poseLocked: true });
    expect(auto!.assignment.poseLocked).toBe(false);
    expect(auto!.assignment.poseId).not.toBe("front_neutral");
    expect(r.canRun).toBe(true);
  });

  it("plans the brand gallery set: calm front/three-quarter/back, expressive styled shot, close-up without face", () => {
    const r = compileProduction(exampleSpec({ slots: OW_SET.map((preset) => ({ preset })) }), MOCK_PROFILE);
    expect(r.canRun).toBe(true);
    for (const i of r.images) {
      const pose = getPose(i.assignment.poseId)!;
      if (["full_body", "three_quarter_full", "back_full"].includes(i.preset)) expect(pose.calm).toBe(true);
      if (i.preset === "styled_full") {
        expect(pose.calm).toBe(false);
        // The brand's styled shot looks into the camera (gallery analysis).
        expect(["neutral_camera", "calm_camera"]).toContain(i.assignment.expressionId);
        expect(i.assignment.poseId).toBe("styled_bag_low"); // the fixture styling has a shoulder bag
      }
      if (i.preset === "detail") expect(i.exclusions).toContain("a face visible to the camera");
      // Dresses are framed head to toe; tops head to mid-thigh; trousers chest to feet. The styled shot is always full.
      if (i.preset === "styled_full" || (i.preset !== "detail" && i.sku === "TEST-DR-001")) expect(i.prompt).toMatch(/figure fills about 93% of the frame height/);
      if (i.preset !== "styled_full" && i.preset !== "detail" && i.sku === "TEST-TP-002") expect(i.prompt).toMatch(/Head to mid-thigh/);
      if (i.preset !== "styled_full" && i.preset !== "detail" && i.sku === "TEST-PT-003") expect(i.prompt).toMatch(/From just below the chest down to and including the feet/);
    }
  });

  it("only chooses a bag pose when styling contains a bag", () => {
    const noBag = compileProduction(exampleSpec({ products: [PRODUCT_HALTER_TOP], slots: [{ preset: "styled_full" }, { preset: "styled_full" }, { preset: "styled_full" }, { preset: "styled_full" }], styling: { ...exampleSpec().styling!, accessories: [] } }), MOCK_PROFILE);
    expect(noBag.images.map((i) => i.assignment.poseId)).not.toContain("front_bag_shoulder");
  });

  it("never plans an incompatible pose across a sweep of 1000 random garments", () => {
    const rnd = lcg(42);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    for (let n = 0; n < 1000; n++) {
      const flags = GarmentFlag.options.filter(() => rnd() < 0.25);
      const product = {
        sku: `RND-${n}`, name: "random garment", category: pick(Category.options), color: "black", flags,
        packshots: { front: asset(`rnd${n}f`), back: asset(`rnd${n}b`) },
      };
      const accessories = rnd() < 0.5 ? ["black tote bag"] : [];
      const slots = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ preset: pick(PresetId.options) }));
      const r = compileProduction(exampleSpec({ productionId: `p${n}`, products: [product], slots, styling: { ...exampleSpec().styling!, accessories } }), MOCK_PROFILE);
      expect(r.conflicts.filter((c) => c.code === "NO_COMPATIBLE_POSE")).toEqual([]);
      const parsedProduct = r.spec.products[0] as Product;
      const styling = Styling.parse({ ...exampleSpec().styling!, accessories });
      for (const i of r.images) {
        expect(poseIncompatibility(getPose(i.assignment.poseId)!, i.preset, parsedProduct, styling)).toBeNull();
      }
    }
  });
});
