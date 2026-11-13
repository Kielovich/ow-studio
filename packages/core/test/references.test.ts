import { describe, expect, it } from "vitest";
import { compileProduction, MOCK_PROFILE, ROLE_CONTROLS, type RefRole } from "../src/index";
import { exampleSpec, MODEL_SABLE } from "../src/fixtures";

const identityRoles: RefRole[] = ["identity_primary", "identity_angle", "facial_detail", "character_sheet", "expression_sheet"];

describe("reference selection", () => {
  const r = compileProduction(exampleSpec(), MOCK_PROFILE);

  it("puts the garment reference first in every image", () => {
    for (const i of r.images) expect(i.refs[0]!.controls).toContain("garment");
  });

  it("never sends a face portrait for back views", () => {
    for (const i of r.images.filter((x) => x.preset === "back")) {
      expect(i.refs.map((x) => x.role)).not.toContain("identity_primary");
      expect(i.refs.map((x) => x.role)).not.toContain("facial_detail");
      expect(i.refs[0]!.role).toBe("garment_back");
    }
  });

  it("sends no identity references for detail shots", () => {
    for (const i of r.images.filter((x) => x.preset === "detail")) {
      for (const ref of i.refs) expect(identityRoles).not.toContain(ref.role);
    }
  });

  it("sends no face references when the crop excludes the face (trousers front crop)", () => {
    for (const i of r.images.filter((x) => x.sku === "TEST-PT-003" && (x.preset === "front_crop" || x.preset === "three_quarter"))) {
      for (const ref of i.refs) expect(["identity_primary", "identity_angle", "facial_detail", "expression_sheet"]).not.toContain(ref.role);
      expect(i.refs.map((x) => x.role)).toContain("body_front");
    }
  });

  it("uses the detail packshot when present, front otherwise", () => {
    const top = r.images.find((i) => i.sku === "TEST-TP-002" && i.preset === "detail")!;
    const dress = r.images.find((i) => i.sku === "TEST-DR-001" && i.preset === "detail")!;
    // The close-up also gets the headless body reference for skin tone and proportions.
    expect(top.refs.map((x) => x.role)).toEqual(["garment_detail", "garment_front", "body_front"]);
    expect(dress.refs.map((x) => x.role)).toEqual(["garment_front", "body_front"]);
  });

  it("trims lowest-priority references to the provider limit and says so", () => {
    const t = compileProduction(exampleSpec(), { ...MOCK_PROFILE, maxRefs: 2 });
    for (const i of t.images) expect(i.refs.length).toBeLessThanOrEqual(2);
    const front = t.images.find((i) => i.sku === "TEST-DR-001" && i.preset === "front_crop")!;
    expect(front.refs.map((x) => x.role)).toEqual(["garment_front", "identity_primary"]);
    expect(t.conflicts.some((c) => c.code === "REFS_TRIMMED" && c.imageSpecId === front.imageSpecId)).toBe(true);
  });

  it("skips the expression sheet when the model has none", () => {
    const { expressionSheet, ...refs } = MODEL_SABLE.refs;
    const s = compileProduction(exampleSpec({ model: { ...MODEL_SABLE, refs } }), MOCK_PROFILE);
    for (const i of s.images) expect(i.refs.map((x) => x.role)).not.toContain("expression_sheet");
    expect(expressionSheet).toBeDefined();
  });

  it("restricts pose references to controlling pose only", () => {
    expect(ROLE_CONTROLS.pose).toEqual(["pose"]);
    for (const [role, controls] of Object.entries(ROLE_CONTROLS)) {
      if (role !== "pose") expect(controls).not.toContain("pose");
    }
  });
});
