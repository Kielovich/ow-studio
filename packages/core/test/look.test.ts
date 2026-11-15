import { describe, expect, it } from "vitest";
import { compileProduction, GEMINI_PRO_PROFILE, Product } from "../src/index";
import { asset, exampleSpec, PRODUCT_HALTER_TOP, PRODUCT_SUIT_PANTS } from "../src/fixtures";

const TROUSERS = { sku: "TEST-PT-003", category: "trousers" as const, front: asset("TEST-PT-003/front"), back: asset("TEST-PT-003/back") };
const TOP = { sku: "TEST-TP-002", category: "top" as const, front: asset("TEST-TP-002/front"), back: asset("TEST-TP-002/back") };
const SHOES = asset("look/shoes");
const BAG = asset("look/bag");
const FIT = asset("look/fit");

/** A top and trousers uploaded as one look, with shoes, a bag and a fit reference. */
function lookSpec(opts: { trousersBack?: boolean; presets?: string[] } = {}) {
  const trousers = opts.trousersBack === false ? { ...TROUSERS, back: undefined } : TROUSERS;
  return exampleSpec({
    products: [
      { ...PRODUCT_HALTER_TOP, look: { garments: [trousers], footwear: SHOES, accessories: [BAG], fit: FIT } },
      { ...PRODUCT_SUIT_PANTS, look: { garments: [TOP], footwear: SHOES, accessories: [BAG], fit: FIT } },
    ],
    slots: (opts.presets ?? ["full_body", "front_crop", "back_full", "styled_full", "detail"]).map((preset) => ({ preset: preset as never })),
    providerProfileId: GEMINI_PRO_PROFILE.id,
  });
}
const image = (r: ReturnType<typeof compileProduction>, sku: string, preset: string) => r.images.find((i) => i.sku === sku && i.preset === preset)!;
const roles = (i: { refs: { role: string }[] }) => i.refs.map((x) => x.role);

describe("a look: the other garment, shoes, accessories and fit as images", () => {
  const r = compileProduction(lookSpec(), GEMINI_PRO_PROFILE);

  it("sends the other garment and the fit reference in the full-body shot, after the product", () => {
    const i = image(r, "TEST-TP-002", "full_body");
    expect(i.refs[0]!.role).toBe("garment_front");
    expect(i.refs[0]!.asset).toBe(PRODUCT_HALTER_TOP.packshots.front);
    expect(roles(i)).toEqual(expect.arrayContaining(["look_garment_front", "fit_reference"]));
    // The brand frames tops above the feet, so no shoes here; the trousers' full-body shot shows them.
    expect(roles(i)).not.toContain("footwear");
    expect(i.refs.find((x) => x.role === "look_garment_front")!.asset).toBe(TROUSERS.front);
    expect(i.prompt).toContain("bottoms: the trousers in the attached look packshot");
    const pants = image(r, "TEST-PT-003", "full_body");
    expect(pants.refs.find((x) => x.role === "footwear")!.asset).toBe(SHOES);
    expect(pants.prompt).toContain("footwear: the shoes in the attached shoe image");
    // A lifestyle shoe photo: only the shoes count.
    expect(pants.prompt).toMatch(/reproduce only the shoes as shown.*ignore everything else in that image/);
    // The garment of the look is styling: it never controls the product's garment or fit.
    expect(i.refs.find((x) => x.role === "look_garment_front")!.controls).toEqual(["styling"]);
    expect(i.prompt).toMatch(/fit reference: .*ignore the person in it entirely/);
  });

  it("keeps the product first and stays within the provider's limits (11 references, 5 of people)", () => {
    for (const i of r.images) {
      expect(i.refs[0]!.controls).toContain("garment");
      expect(i.refs.length).toBeLessThanOrEqual(GEMINI_PRO_PROFILE.maxRefs);
      const people = i.refs.filter((x) => ["identity_primary", "identity_angle", "character_sheet", "facial_detail", "body_front", "body_back", "expression_sheet", "session_anchor", "fit_reference"].includes(x.role));
      expect(people.length).toBeLessThanOrEqual(GEMINI_PRO_PROFILE.maxIdentityRefs!);
    }
  });

  it("sends no shoes where the feet are out of frame, and no look images in the close-up", () => {
    const crop = image(r, "TEST-TP-002", "front_crop");
    expect(roles(crop)).not.toContain("footwear");
    expect(crop.prompt).not.toContain("footwear:");
    const detail = image(r, "TEST-TP-002", "detail");
    for (const role of ["look_garment_front", "look_garment_back", "footwear", "accessory", "fit_reference"]) expect(roles(detail)).not.toContain(role);
    expect(detail.prompt).not.toContain("attached look packshot");
  });

  it("uses the other garment's back packshot in back views, and says nothing is attached when there is none", () => {
    const back = image(r, "TEST-TP-002", "back_full");
    expect(back.refs.find((x) => x.role === "look_garment_back")!.asset).toBe(TROUSERS.back);
    expect(back.prompt).toContain("bottoms: the trousers in the attached look packshot");
    const noBack = image(compileProduction(lookSpec({ trousersBack: false }), GEMINI_PRO_PROFILE), "TEST-TP-002", "back_full");
    expect(roles(noBack)).not.toContain("look_garment_back");
    expect(noBack.prompt).toContain("bottoms: the trousers of this look");
    expect(noBack.prompt).not.toContain("attached look packshot");
  });

  it("puts accessories only in the styled shot", () => {
    const styled = image(r, "TEST-TP-002", "styled_full");
    expect(roles(styled)).toContain("accessory");
    expect(styled.prompt).toContain("accessories: the pieces in the attached accessory images");
    for (const p of ["full_body", "front_crop", "back_full", "detail"]) expect(roles(image(r, "TEST-TP-002", p))).not.toContain("accessory");
  });

  it("dresses the trousers with the top of the look", () => {
    const i = image(r, "TEST-PT-003", "full_body");
    expect(i.refs[0]!.asset).toBe(PRODUCT_SUIT_PANTS.packshots.front);
    expect(i.refs.find((x) => x.role === "look_garment_front")!.asset).toBe(TOP.front);
    expect(i.prompt).toContain("top: the top in the attached look packshot");
  });

  it("puts a jacket of the look over the top of the trousers, never in place of it", () => {
    const JACKET = { sku: "TEST-JK-004", category: "jacket" as const, front: asset("TEST-JK-004/front") };
    const spec = exampleSpec({
      products: [{ ...PRODUCT_SUIT_PANTS, look: { garments: [JACKET], accessories: [] } }],
      slots: [{ preset: "full_body" }],
      styling: { top: "plain black fitted long-sleeve top", accessories: [] },
      providerProfileId: GEMINI_PRO_PROFILE.id,
    });
    const i = compileProduction(spec, GEMINI_PRO_PROFILE).images[0]!;
    expect(i.prompt).toContain("top: plain black fitted long-sleeve top");
    expect(i.prompt).toContain("worn over the top: the jacket in the attached look packshot");
    expect(i.refs.find((x) => x.role === "look_garment_front")!.asset).toBe(JACKET.front);
  });

  it("drops accessories first when references must be trimmed, and the prompt stops calling them attached", () => {
    const t = compileProduction(lookSpec({ presets: ["styled_full"] }), { ...GEMINI_PRO_PROFILE, maxRefs: 6 });
    const styled = image(t, "TEST-TP-002", "styled_full");
    expect(roles(styled)).not.toContain("accessory");
    expect(roles(styled)[0]).toBe("garment_front");
    expect(styled.prompt).not.toContain("attached accessory images");
    expect(t.conflicts.some((c) => c.code === "REFS_TRIMMED")).toBe(true);
  });

  it("limits a look to two other garments and three accessories", () => {
    const base = { ...PRODUCT_HALTER_TOP, look: { garments: [TROUSERS, TROUSERS, TROUSERS], accessories: [] } };
    expect(Product.safeParse(base).success).toBe(false);
    expect(Product.safeParse({ ...PRODUCT_HALTER_TOP, look: { garments: [], accessories: [BAG, BAG, BAG, BAG] } }).success).toBe(false);
    expect(Product.safeParse({ ...PRODUCT_HALTER_TOP, look: { garments: [TROUSERS], accessories: [BAG] } }).success).toBe(true);
  });
});
