import { describe, expect, it } from "vitest";
import {
  compileProduction, GEMINI_PRO_PROFILE, getPose, MOCK_PROFILE, OW_SET, type CompiledRequest, type ProviderProfile,
} from "../src/index";
import { asset, exampleSpec, MODEL_SABLE, PRODUCT_HALTER_TOP, PRODUCT_MESH_MAXI, PRODUCT_SUIT_PANTS } from "../src/fixtures";

/**
 * Production-wide consistency, checked on the actual compiled payloads: reference lists, their order and assets,
 * request hashes and the instruction blocks shared between shots.
 */
const ASYM_DRESS = {
  ...PRODUCT_MESH_MAXI,
  sku: "ASYM-01",
  flags: ["sheer", "long_sleeve", "asymmetric_hem"] as ("sheer" | "long_sleeve" | "asymmetric_hem")[],
  asymmetry: { hemLowSide: "wearer_right" as const, backAgrees: true },
};
const brandSet = (overrides: Record<string, unknown> = {}) =>
  exampleSpec({ slots: OW_SET.map((preset) => ({ preset })), products: [ASYM_DRESS], providerProfileId: GEMINI_PRO_PROFILE.id, ...overrides });
const byPreset = (imgs: CompiledRequest[]) => Object.fromEntries(imgs.map((i) => [i.preset, i])) as Record<string, CompiledRequest>;
const block = (r: CompiledRequest, key: string) => r.instructionBlocks.find((b) => b.key === key)?.text;
const profile: ProviderProfile = GEMINI_PRO_PROFILE;

describe("session anchor", () => {
  const plain = compileProduction(brandSet(), profile);
  const s = byPreset(plain.images);

  it("makes the front shot the anchor and every other shot of the SKU depend on it", () => {
    expect(s.full_body!.dependsOn).toBeUndefined();
    for (const p of ["three_quarter_full", "back_full", "styled_full", "detail"]) expect(s[p]!.dependsOn).toBe(s.full_body!.imageSpecId);
    // Before the anchor exists, no request carries a session reference.
    for (const i of plain.images) expect(i.refs.map((r) => r.role)).not.toContain("session_anchor");
  });

  it("injects the anchor's final image after garment and identity references, and only into dependents", () => {
    const anchorFinal = asset("anchor-final");
    const withAnchor = byPreset(compileProduction(brandSet(), profile, undefined, { anchors: { "ASYM-01": anchorFinal } }).images);
    expect(withAnchor.full_body!.compileHash).toBe(s.full_body!.compileHash); // the anchor itself is unchanged
    for (const p of ["three_quarter_full", "back_full", "styled_full", "detail"]) {
      const r = withAnchor[p]!;
      expect(r.imageSpecId).toBe(s[p]!.imageSpecId); // same image identity, so retries and history line up
      expect(r.compileHash).not.toBe(s[p]!.compileHash); // but a different, traceable request
      const roles = r.refs.map((x) => x.role);
      const at = roles.indexOf("session_anchor");
      expect(r.refs[at]!.asset).toBe(anchorFinal);
      expect(r.refs[at]!.controls).toEqual(["session"]);
      // Everything before it is garment or identity authority; nothing after it is.
      for (const before of roles.slice(0, at)) expect(before).toMatch(/^(garment_|identity_|character_sheet)/);
      for (const after of roles.slice(at + 1)) expect(after).not.toMatch(/^(garment_|identity_primary)/);
      expect(block(r, "style")).toMatch(/same studio session as the attached session reference/);
    }
  });

  it("is deterministic for the same anchor and can be switched off", () => {
    const a = compileProduction(brandSet(), profile, undefined, { anchors: { "ASYM-01": asset("x") } });
    const b = compileProduction(brandSet(), profile, undefined, { anchors: { "ASYM-01": asset("x") } });
    expect(a.images.map((i) => i.compileHash)).toEqual(b.images.map((i) => i.compileHash));
    const off = compileProduction(brandSet({ sessionAnchor: false }), profile, undefined, { anchors: { "ASYM-01": asset("x") } });
    for (const i of off.images) {
      expect(i.dependsOn).toBeUndefined();
      expect(i.refs.map((r) => r.role)).not.toContain("session_anchor");
    }
  });

  it("anchors each SKU to its own front shot", () => {
    const r = compileProduction(brandSet({ products: [ASYM_DRESS, PRODUCT_HALTER_TOP] }), profile);
    for (const img of r.images.filter((i) => i.dependsOn)) {
      const anchor = r.images.find((i) => i.imageSpecId === img.dependsOn)!;
      expect(anchor.sku).toBe(img.sku);
      expect(anchor.preset).toBe("full_body");
    }
  });

  it("stays inside the provider's reference limits with the anchor added", () => {
    const r = compileProduction(brandSet(), profile, undefined, { anchors: { "ASYM-01": asset("a") } });
    const person = new Set(["identity_primary", "identity_angle", "character_sheet", "facial_detail", "body_front", "body_back", "expression_sheet", "session_anchor"]);
    for (const i of r.images) {
      expect(i.refs.length).toBeLessThanOrEqual(profile.maxRefs);
      expect(i.refs.filter((x) => person.has(x.role)).length).toBeLessThanOrEqual(profile.maxIdentityRefs!);
      expect(new Set(i.refs.map((x) => x.asset)).size).toBe(i.refs.length); // no duplicate images sent
    }
  });
});

describe("shared session instructions", () => {
  const r = compileProduction(brandSet(), profile, undefined, { anchors: { "ASYM-01": asset("a") } });
  const s = byPreset(r.images);

  it("sends byte-identical identity instructions to every shot that shows the face", () => {
    const ids = ["full_body", "three_quarter_full", "styled_full"].map((p) => block(s[p]!, "identity"));
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/never the facial structure/);
  });

  it("sends the same garment description, construction and fit rules to every shot", () => {
    const prefix = (t: string) => t.split(" Measured hem orientation")[0];
    const garments = r.images.map((i) => prefix(block(i, "garment")!));
    expect(new Set(garments).size).toBe(1);
  });

  it("sends identical light and photographic style to every dependent full-frame shot", () => {
    const styles = ["three_quarter_full", "back_full", "styled_full"].map((p) => block(s[p]!, "style"));
    expect(new Set(styles).size).toBe(1);
  });

  it("states the priority order explicitly", () => {
    expect(block(s.full_body!, "safety")).toMatch(/1 garment fidelity.*2 identity.*3 body proportions.*6 pose.*7 expression/);
  });
});

describe("locks in the payload", () => {
  const r = byPreset(compileProduction(brandSet({ products: [{ ...ASYM_DRESS, colorHex: "#1b1a1c" }] }), profile, undefined, { anchors: { "ASYM-01": asset("a") } }).images);

  it("identity lock: portrait plus character sheet in every face shot, plus the angle where the head turns", () => {
    const withSheet = { ...MODEL_SABLE, refs: { ...MODEL_SABLE.refs, characterSheet: asset("sheet"), identityAngles: [asset("tq")] } };
    const s = byPreset(compileProduction(brandSet({ model: withSheet }), profile).images);
    for (const p of ["full_body", "three_quarter_full", "styled_full"]) {
      const roles = s[p]!.refs.map((x) => x.role);
      expect(roles.slice(0, 2)).toEqual(["garment_front", "identity_primary"]);
      expect(roles).toContain("character_sheet");
    }
    expect(s.three_quarter_full!.refs.map((x) => x.role)).toContain("identity_angle");
  });

  it("framing lock: upper-body garments keep the feet out of frame except in the styled shot", () => {
    const jacket = { ...PRODUCT_HALTER_TOP, sku: "JKT-1", category: "jacket" as const, flags: ["fur"] as ("fur")[] };
    const s = byPreset(compileProduction(brandSet({ products: [jacket] }), profile).images);
    for (const p of ["full_body", "three_quarter_full", "back_full"]) {
      expect(block(s[p]!, "framing")).toMatch(/Head to mid-thigh/);
      expect(block(s[p]!, "pose")).toMatch(/the feet are not in the picture/);
      expect(block(s[p]!, "styling") ?? "").not.toMatch(/footwear/);
    }
    expect(block(s.styled_full!, "framing")).toMatch(/Full body head to toe/);
    expect(block(s.styled_full!, "styling")).toMatch(/footwear/);
  });

  it("colour lock: the measured colour is stated in every shot", () => {
    for (const i of Object.values(r)) expect(block(i, "garment")).toMatch(/dominant colour measured from the packshot is #1b1a1c/);
  });

  it("skin lock: texture and tone tied to the portrait, photographic skin in the style block", () => {
    expect(block(r.full_body!, "identity")).toMatch(/skin tone, skin texture, freckles and hair colour identical to the identity portrait/);
    for (const i of Object.values(r)) expect(block(i, "style")).toMatch(/pores visible on the nose, cheeks and forehead/);
  });
});

describe("model's own look", () => {
  it("uses the portrait's hair and makeup unless the production overrides them", () => {
    const own = byPreset(compileProduction(brandSet({ styling: { accessories: [] } }), profile).images);
    expect(block(own.full_body!, "identity")).toMatch(/her own hairstyle as in the identity portrait.*Makeup: as in the identity portrait/);
    expect(block(own.full_body!, "identity")).not.toMatch(/styled for this production|Makeup for this production/);
    expect(block(own.back_full!, "identity")).not.toMatch(/styled for this production/);
    const over = byPreset(compileProduction(brandSet({ styling: { hairState: "low bun", makeup: "red lip", accessories: [] } }), profile).images);
    expect(block(over.full_body!, "identity")).toMatch(/Hair styled for this production: low bun.*Makeup for this production: red lip/);
    expect(block(over.back_full!, "identity")).toMatch(/styled for this production: low bun/);
  });
});

describe("realism language (docs/realism-audit.md)", () => {
  const s = byPreset(compileProduction(brandSet(), profile).images);
  it("asks for real hair, real hands, real body skin and non-glossy lips, and excludes the stock defects", () => {
    expect(block(s.full_body!, "identity")).toMatch(/flyaways and baby hairs/);
    expect(block(s.full_body!, "identity")).toMatch(/satin or matte finish/);
    expect(block(s.back_full!, "identity")).toMatch(/flyaways and baby hairs/);
    expect(block(s.full_body!, "style")).toMatch(/thumb resting alongside the index finger/);
    // The stock gesture is no longer named anywhere (naming it may prime it).
    for (const i of Object.values(s)) expect(i!.prompt).not.toMatch(/thumb touching the middle finger/);
    expect(block(s.full_body!, "identity")).toMatch(/do not beautify, idealise, slim or correct symmetry/);
    expect(block(s.full_body!, "style")).toMatch(/luminance comes from the light alone/);
    expect(block(s.full_body!, "style")).toMatch(/Body skin is real too/);
    expect(block(s.full_body!, "style")).toMatch(/gentle fall-off across the body/);
    // Round 1 lesson: asking the light to "show the garment's folds" added gathers to a smooth dress.
    expect(block(s.full_body!, "style")).not.toMatch(/shows its folds/);
    expect(block(s.full_body!, "style")).toMatch(/never adds folds, gathers or creases/);
    for (const i of Object.values(s)) expect(i!.exclusions).toEqual(expect.arrayContaining(["helmet-like hair without a single loose strand", "CGI or 3D-render look, beauty-filter skin"]));
  });
  it("never asks for studio equipment in frame, and keeps the head out of back views of bottoms (rounds 1-2)", () => {
    for (const i of Object.values(s)) {
      expect(i!.exclusions).toContain("softboxes, lamps, light stands or any studio equipment in frame");
      expect(block(i!, "style")).toMatch(/light sources themselves are never in the picture/);
    }
    const t = byPreset(compileProduction(brandSet({ products: [{ ...PRODUCT_SUIT_PANTS }] } as any), profile).images);
    expect(block(t.back_full!, "identity")).toMatch(/head and hair are outside the frame/);
    expect(block(t.back_full!, "identity")).not.toMatch(/flyaways/);
    expect(block(s.back_full!, "identity")).toMatch(/flyaways/); // a dress back view still shows the hair
  });

  it("keeps the production's own hair override when one is set", () => {
    const o = byPreset(compileProduction(brandSet({ styling: { hairState: "low bun", accessories: [] } }), profile).images);
    expect(block(o.full_body!, "identity")).toMatch(/Hair styled for this production: low bun\. Real hair/);
  });
});

describe("garment orientation", () => {
  const s = byPreset(compileProduction(brandSet(), profile).images);

  it("states the measured hem side per view instead of a generic left/right rule", () => {
    expect(block(s.full_body!, "garment")).toMatch(/wearer's right side; in this front view it appears on the image left/);
    expect(block(s.back_full!, "garment")).toMatch(/wearer's right side; in this back view it appears on the image right/);
    for (const i of Object.values(s)) expect(block(i, "garment")).not.toMatch(/garment left\/right, not image left\/right/);
  });

  it("gives the back view the front packshot as an orientation-only reference", () => {
    const roles = s.back_full!.refs.map((x) => x.role);
    expect(roles.slice(0, 2)).toEqual(["garment_back", "garment_orientation"]);
    const orient = s.back_full!.refs.find((x) => x.role === "garment_orientation")!;
    expect(orient.asset).toBe(ASYM_DRESS.packshots.front);
    expect(orient.controls).toEqual(["orientation"]);
    expect(roles).not.toContain("identity_primary");
  });

  it("warns when the hem cannot be measured or the packshots disagree", () => {
    const { asymmetry, ...unmeasured } = ASYM_DRESS;
    expect(asymmetry).toBeDefined();
    const codes = (p: unknown) => compileProduction(brandSet({ products: [p] }), profile).conflicts.map((c) => c.code);
    expect(codes(unmeasured)).toContain("ASYMMETRY_UNMEASURED");
    expect(codes({ ...ASYM_DRESS, asymmetry: { hemLowSide: "wearer_right", backAgrees: false } })).toContain("PACKSHOTS_DISAGREE");
  });

  it("no longer warns about an open back when the set has a back_full shot", () => {
    const r = compileProduction(brandSet({ products: [PRODUCT_HALTER_TOP] }), profile);
    expect(r.conflicts.map((c) => c.code)).not.toContain("OPEN_BACK_NO_BACK_PRESET");
  });
});

describe("pose planning across productions", () => {
  const planFor = (seed: string, products = [PRODUCT_MESH_MAXI, PRODUCT_HALTER_TOP, PRODUCT_SUIT_PANTS]) =>
    compileProduction(exampleSpec({ seed, products, slots: OW_SET.map((preset) => ({ preset })) }), MOCK_PROFILE).images;

  it("plans identically for the same seed, whatever the production id (preview equals run)", () => {
    const a = compileProduction(exampleSpec({ productionId: "draft", seed: "s1", slots: OW_SET.map((preset) => ({ preset })) }), MOCK_PROFILE);
    const b = compileProduction(exampleSpec({ productionId: "prod_real", seed: "s1", slots: OW_SET.map((preset) => ({ preset })) }), MOCK_PROFILE);
    expect(b.images.map((i) => [i.preset, i.assignment.poseId, i.assignment.expressionId])).toEqual(a.images.map((i) => [i.preset, i.assignment.poseId, i.assignment.expressionId]));
  });

  it("shares the main poses across all SKUs of one production", () => {
    const imgs = planFor("one-production");
    for (const preset of ["full_body", "three_quarter_full", "back_full"]) {
      expect(new Set(imgs.filter((i) => i.preset === preset).map((i) => i.assignment.poseId)).size).toBe(1);
    }
  });

  it("varies front and back poses between productions among calm poses; the three-quarter always turns the brand's way", () => {
    const fronts = new Set<string>(), threeQuarter = new Set<string>(), backs = new Set<string>();
    for (let n = 0; n < 60; n++) {
      const s = byPreset(planFor(`p${n}`, [PRODUCT_MESH_MAXI]));
      fronts.add(s.full_body!.assignment.poseId);
      threeQuarter.add(s.three_quarter_full!.assignment.poseId);
      backs.add(s.back_full!.assignment.poseId);
    }
    for (const set of [fronts, backs]) {
      expect(set.size).toBeGreaterThan(1);
      for (const id of set) expect(getPose(id)!.calm).toBe(true);
    }
    expect([...threeQuarter]).toEqual(["tq_away_left"]);
  });

  it("keeps the accessory pose for the styled shot when a bag is styled", () => {
    for (let n = 0; n < 20; n++) expect(byPreset(planFor(`b${n}`, [PRODUCT_MESH_MAXI])).styled_full!.assignment.poseId).toBe("styled_bag_low");
  });

  it("never lets the model version or anchors change the pose plan", () => {
    const a = compileProduction(brandSet({ seed: "z" }), profile);
    const b = compileProduction(brandSet({ seed: "z", model: { ...MODEL_SABLE, version: 9 } }), profile, undefined, { anchors: { "ASYM-01": asset("q") } });
    expect(b.images.map((i) => i.assignment)).toEqual(a.images.map((i) => i.assignment));
  });
});
