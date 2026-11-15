import { describe, expect, it } from "vitest";
import {
  BUILDER_OPTIONS, BuilderSpec, builderHair, builderLook, builderPortraitPrompt, builderReferencePrompt, builderSummary,
  DEFAULT_BUILDER_SPEC, GEMINI_PRO_PROFILE, GeminiProvider, hairForPrompt, hairStyleAllowed, ModelVersion, REFERENCE_ASPECT,
  REFERENCE_KINDS, type FetchLike,
} from "../src/index";

const spec = (over: Partial<BuilderSpec> = {}): BuilderSpec => BuilderSpec.parse({ ...DEFAULT_BUILDER_SPEC, ...over });

describe("model builder choices", () => {
  it("accepts the defaults and every listed option", () => {
    expect(() => spec()).not.toThrow();
    for (const [v] of BUILDER_OPTIONS.heritage) expect(() => spec({ heritage: v })).not.toThrow();
    for (const [v] of BUILDER_OPTIONS.hairColour) expect(() => spec({ hairColour: v })).not.toThrow();
  });

  it("only makes adults of 20 to 25, with the listed heights and sizes", () => {
    expect(() => spec({ ageYears: 19 })).toThrow();
    expect(() => spec({ ageYears: 26 })).toThrow();
    expect(() => spec({ heightCm: 190 })).toThrow();
    expect(() => spec({ euSize: 40 })).toThrow();
  });

  it("refuses free text and unknown fields: nothing typed reaches the prompt", () => {
    expect(() => BuilderSpec.parse({ ...DEFAULT_BUILDER_SPEC, heritage: "looks like a famous actress" })).toThrow();
    expect(() => BuilderSpec.parse({ ...DEFAULT_BUILDER_SPEC, extra: "a real person" })).toThrow();
  });

  it("short hair is worn as cut: no bun or ponytail", () => {
    expect(hairStyleAllowed({ hairLength: "short" }, "high-bun")).toBe(false);
    expect(hairStyleAllowed({ hairLength: "long" }, "high-bun")).toBe(true);
    const h = builderHair(spec({ hairLength: "short", hairStyle: "high-bun" }));
    expect(h).toContain("neatly shaped");
    expect(h).not.toContain("bun");
  });
});

describe("model builder prompts", () => {
  const s = spec({ heritage: "east-asian", hairColour: "black", hairStyle: "low-bun", eyes: "dark-brown", freckles: true, ageYears: 22 });

  it("the portrait is an original fictional adult made from the chosen words only", () => {
    const p = builderPortraitPrompt(s);
    expect(p).toContain("original fictional adult woman, 22 years old");
    expect(p).toContain("not a real or identifiable person");
    expect(p).toContain("East Asian heritage");
    expect(p).toContain("jet-black");
    expect(p).toContain("a sleek low bun");
    expect(p).toContain("dark-brown eyes");
    expect(p).toContain("light olive skin with light natural freckles");
    expect(p).toContain("long straight jet-black hair, styled in a sleek low bun");
    expect(p).toContain("head and shoulders");
    expect(p).toContain("black tank top");
    // The brand's look: a top model with attitude and polished clean glam, on real skin with real hair edges.
    expect(p).toContain("top fashion model");
    expect(p).toContain("cool, self-assured");
    expect(p).toContain("Not smiling");
    expect(p).toContain("bronze contour");
    expect(p).toContain("pores visible");
    expect(p).toContain("flyaways");
    expect(p).not.toMatch(/approachable|tiny marks|unevenness|high-street/);
    // Round 2 of the paid test: young (not gaunt), visibly made up, square to the camera.
    expect(p).toContain("never gaunt");
    expect(p).toContain("clearly visible polished clean glam");
    expect(p).toContain("square to the camera");
    // No studio equipment in the picture (the first paid test showed a softbox in frame).
    expect(p).toContain("no lights, softboxes, stands or other studio equipment visible");
  });

  it("every reference is made from the attached portrait and keeps her identity", () => {
    for (const k of REFERENCE_KINDS) {
      const p = builderReferencePrompt(k, s);
      expect(p, k).toContain("attached identity portrait");
      expect(p, k).toContain("not a real or identifiable person");
      expect(p, k).toContain("exactly as in the portrait");
      if (k !== "bodyBack") expect(p, k).toContain("cool");
      expect(p, k).toMatch(/no (lights, softboxes, stands or other )?studio equipment visible/);
    }
  });

  it("body references carry the chosen height and size; the back view hides the face", () => {
    const tall = spec({ heightCm: 182, euSize: 38 });
    expect(builderReferencePrompt("bodyFront", tall)).toContain("182 cm tall");
    expect(builderReferencePrompt("bodyFront", tall)).toContain("EU size 38");
    expect(builderReferencePrompt("bodyBack", tall)).toContain("face not visible");
  });

  it("the character sheet has exactly five panels and no text", () => {
    const p = builderReferencePrompt("characterSheet", s);
    expect(p).toContain("exactly five large panels");
    expect(p).toContain("No text");
    expect(REFERENCE_ASPECT.characterSheet).toBe("16:9");
    expect(REFERENCE_ASPECT.bodyFront).toBe("2:3");
  });

  it("the registered look reads like the library's models and fits the model schema", () => {
    const look = builderLook(s);
    expect(look.features).toBe("East Asian heritage, light natural freckles");
    expect(look.eyes).toBe("dark-brown eyes");
    expect(look.skinTone).toBe("light olive"); // reads "light olive skin" in production prompts
    expect(look.hair).toBe("long straight jet-black hair, usually styled in a sleek low bun with a centre part");
    expect(hairForPrompt(look.hair)).toBe(look.hair);
    const asset = "sha256:" + "a".repeat(64);
    const refs = { primaryPortrait: asset, identityAngles: [asset, asset], fullBodyFront: asset, fullBodyBack: asset, characterSheet: asset, facialDetailSheet: asset };
    expect(() => ModelVersion.parse({ modelId: "M11", version: 1, displayName: "Test", ageYears: 22, heightCm: 178, euSize: 36, look, refs })).not.toThrow();
  });

  it("every skin tone reads as one phrase before \"skin\"", () => {
    for (const [v] of BUILDER_OPTIONS.skin) {
      const identity = builderPortraitPrompt(spec({ skin: v, freckles: true })).split("\n").find((l) => l.includes("heritage;"))!;
      expect(identity, v).toMatch(/; [a-z -]+ skin with light natural freckles\./);
      expect(identity, v).not.toMatch(/, [a-z ]*skin\b|undertone skin/);
    }
  });

  it("the hair reads as one natural phrase for every texture and length", () => {
    expect(builderHair(spec({ hairColour: "auburn", hairTexture: "wavy", hairLength: "shoulder", hairStyle: "tucked" })))
      .toBe("shoulder-length auburn hair with soft natural waves, worn down with a centre part and tucked behind the ears");
    expect(builderHair(spec({ hairColour: "black", hairTexture: "coily", hairLength: "short" }))).toBe("short cropped tightly coiled natural jet-black hair, neatly shaped");
    expect(builderHair(spec({ hairColour: "chestnut", hairTexture: "straight", hairLength: "bob", hairStyle: "down" })))
      .toBe("chin-length straight chestnut brown hair, cut in a bob, worn down with a centre part");
    for (const [t] of BUILDER_OPTIONS.hairTexture) for (const [l] of BUILDER_OPTIONS.hairLength) {
      const h = builderHair(spec({ hairTexture: t, hairLength: l }));
      expect(h, `${t} ${l}`).not.toMatch(/\bhair hair\b|, ,|waves hair|curls hair|styled as/);
    }
  });

  it("summarises the choices in one readable line", () => {
    expect(builderSummary(s)).toBe("East Asian · light olive with freckles · black long straight hair · dark brown eyes · 22 · 178 cm · EU 36");
  });
});

describe("GeminiProvider.generateImage", () => {
  it("asks for the given aspect ratio at the 2K tier and returns the image with its cost", async () => {
    const bodies: any[] = [];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: png }] }] }) };
    };
    const p = new GeminiProvider(GEMINI_PRO_PROFILE, { resolveAsset: async () => ({ bytes: new Uint8Array(), mime: "image/png" }), fetch, apiKey: "test" });
    const out = await p.generateImage("a prompt", [{ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }], "16:9");
    expect(bodies[0].response_format).toEqual({ type: "image", aspect_ratio: "16:9", image_size: "2K" });
    expect(bodies[0].input[0]).toEqual({ type: "text", text: "a prompt" });
    expect(bodies[0].input[1].mime_type).toBe("image/jpeg");
    expect(out.costUsd).toBe(GEMINI_PRO_PROFILE.estimatedCostUsd);
    expect(out.bytes.length).toBe(4);
  });

  it("an answer without an image is a content-policy outcome that may have cost", async () => {
    const fetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ steps: [] }) });
    const p = new GeminiProvider(GEMINI_PRO_PROFILE, { resolveAsset: async () => ({ bytes: new Uint8Array(), mime: "image/png" }), fetch, apiKey: "test" });
    await expect(p.generateImage("x", [], "1:1")).rejects.toMatchObject({ kind: "content_policy", billable: "unknown" });
  });
});
