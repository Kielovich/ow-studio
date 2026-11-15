import { z } from "zod";
import type { ModelVersion } from "./schemas";

/**
 * Model builder: a new original fictional model from a set of choices.
 *
 * Every choice maps to fixed prompt text, so nothing a user types reaches the generator (the name is never in a prompt).
 * There is no image upload: a model is made from words only, so she can never be a copy of a real person.
 * The prompts are the ones that made the current models (scripts/model-studio.ts and the realism refresh in
 * scripts/model-realism.ts, docs/realism-audit.md): a young high-street e-commerce model, clean-glam makeup finished as
 * on a real set, real hair edges, real skin, soft directional studio light.
 */

/** [value, label shown, text sent to the generator] */
type Option = readonly [string, string, string];

export const BUILDER_OPTIONS = {
  heritage: [
    ["northern-european", "Northern European", "Northern European heritage"],
    ["southern-european", "Southern European", "Southern European heritage"],
    ["east-asian", "East Asian", "East Asian heritage"],
    ["southeast-asian", "Southeast Asian", "Southeast Asian heritage"],
    ["south-asian", "South Asian", "South Asian heritage"],
    ["middle-eastern", "Middle Eastern", "Middle Eastern or North African heritage"],
    ["black", "Black", "Black, of African descent"],
    ["latina", "Latina", "Latin American heritage"],
    ["mixed", "Mixed", "mixed heritage"],
  ],
  skin: [
    ["fair", "Fair", "fair"],
    ["light", "Light", "light warm-toned"],
    ["light-olive", "Light olive", "light olive"],
    ["olive", "Olive", "olive"],
    ["golden", "Golden tan", "golden tan"],
    ["medium-brown", "Medium brown", "warm medium-brown"],
    ["deep-brown", "Deep brown", "deep brown"],
    ["ebony", "Deep ebony", "deep ebony brown"],
  ],
  hairColour: [
    ["black", "Black", "jet-black"],
    ["dark-brown", "Dark brown", "dark brown"],
    ["chestnut", "Chestnut", "chestnut brown"],
    ["light-brown", "Light brown", "light brown"],
    ["dark-blonde", "Dark blonde", "dark blonde"],
    ["golden-blonde", "Golden blonde", "golden blonde (golden, not red)"],
    ["platinum", "Platinum", "very light platinum blonde"],
    ["auburn", "Auburn", "auburn"],
    ["red", "Red", "natural copper red"],
  ],
  hairTexture: [
    ["straight", "Straight", "straight"],
    ["wavy", "Wavy", "with soft natural waves"],
    ["curly", "Curly", "with defined natural curls"],
    ["coily", "Coily", "tightly coiled natural"],
  ],
  hairLength: [
    ["short", "Short", "short cropped"],
    ["bob", "Bob", "chin-length"],
    ["shoulder", "Shoulder", "shoulder-length"],
    ["long", "Long", "long"],
  ],
  hairStyle: [
    ["down", "Worn down", "worn down with a centre part"],
    ["tucked", "Behind the ears", "worn down with a centre part and tucked behind the ears"],
    ["fringe", "Curtain fringe", "worn down with a soft curtain fringe"],
    ["low-bun", "Low bun", "styled in a sleek low bun with a centre part"],
    ["high-bun", "High bun", "styled in a sleek high bun"],
    ["ponytail", "Ponytail", "styled in a high sleek ponytail"],
  ],
  eyes: [
    ["dark-brown", "Dark brown", "dark-brown eyes"],
    ["brown", "Brown", "warm brown eyes"],
    ["hazel", "Hazel", "hazel eyes"],
    ["green", "Green", "green eyes"],
    ["blue", "Blue", "blue eyes"],
    ["grey", "Grey", "grey eyes"],
  ],
} as const satisfies Record<string, readonly Option[]>;

const values = <K extends keyof typeof BUILDER_OPTIONS>(k: K) =>
  BUILDER_OPTIONS[k].map((o) => o[0]) as unknown as [string, ...string[]];
const text = <K extends keyof typeof BUILDER_OPTIONS>(k: K, v: string) => BUILDER_OPTIONS[k].find((o) => o[0] === v)?.[2] ?? "";

/** Adults only: the casting policy is 20 and over (ModelVersion's hard floor is 18). */
export const BUILDER_AGES = [20, 21, 22, 23, 24, 25] as const;
export const BUILDER_HEIGHTS = [172, 174, 176, 178, 180, 182] as const;
export const BUILDER_SIZES = [34, 36, 38] as const;

export const BuilderSpec = z.object({
  heritage: z.enum(values("heritage")),
  skin: z.enum(values("skin")),
  freckles: z.boolean().default(false),
  hairColour: z.enum(values("hairColour")),
  hairTexture: z.enum(values("hairTexture")),
  hairLength: z.enum(values("hairLength")),
  hairStyle: z.enum(values("hairStyle")),
  eyes: z.enum(values("eyes")),
  ageYears: z.number().int().min(20).max(25),
  heightCm: z.number().int().refine((n) => (BUILDER_HEIGHTS as readonly number[]).includes(n), "height"),
  euSize: z.number().int().refine((n) => (BUILDER_SIZES as readonly number[]).includes(n), "size"),
}).strict();
export type BuilderSpec = z.infer<typeof BuilderSpec>;

export const DEFAULT_BUILDER_SPEC: BuilderSpec = {
  heritage: "southern-european", skin: "light-olive", freckles: false, hairColour: "dark-brown", hairTexture: "straight",
  hairLength: "long", hairStyle: "down", eyes: "dark-brown", ageYears: 21, heightCm: 178, euSize: 36,
};

/** Short hair has no bun or ponytail: it is worn as cut. */
export const hairStyleAllowed = (spec: Pick<BuilderSpec, "hairLength">, style: string) =>
  spec.hairLength !== "short" || style === "down";

/** The hair in words, e.g. "dark brown, long, straight hair, styled as a sleek low bun with a centre part". */
/** The hair itself, e.g. "shoulder-length auburn hair with soft natural waves" or "long straight black hair cut in a bob". */
function hairCore(spec: BuilderSpec): string {
  const len = text("hairLength", spec.hairLength);
  const colour = text("hairColour", spec.hairColour);
  const base = spec.hairTexture === "straight" ? `${len} straight ${colour} hair`
    : spec.hairTexture === "coily" ? `${len} tightly coiled natural ${colour} hair`
      : `${len} ${colour} hair ${text("hairTexture", spec.hairTexture)}`;
  return spec.hairLength === "bob" ? `${base}, cut in a bob` : base;
}
const styleOf = (spec: BuilderSpec) => (spec.hairLength === "short" ? "neatly shaped" : text("hairStyle", spec.hairStyle));

export function builderHair(spec: BuilderSpec): string {
  return `${hairCore(spec)}, ${styleOf(spec)}`;
}

const FRECKLES = "light natural freckles";

/**
 * The finish: a top model, photographed for real.
 *
 * Owner's direction 1 (2026-11-15): models who look like top models, with attitude and a cool look. The first paid test
 * used the realism refresh's wording on its own (natural, matte, calm) and made plain, girl-next-door faces: a new face
 * needs the striking part first (LOOK, ATTITUDE).
 * Owner's direction 2 (later the same day): "not realistic enough". The glam wording added after round 2 ("luminous",
 * "flawless-looking", "distinct highlight", "satin shine", "expensive-looking") is beauty-retouch language: it gives the
 * smooth, glowing AI finish the realism audit warned against (docs/realism-audit.md: no "flawless"/"perfect"). Now the
 * makeup is the brand's clean glam as a real make-up artist does it, and everything else describes an unretouched
 * photograph: skin that reads as skin, light with fall-off, natural colour, focus fall-off, grain.
 * After the first words-only round (12 candidates, 2026-11-15): peach fuzz on the cheeks only (it read as stubble on a
 * jaw), nothing but the paper behind her (a window, a backdrop edge and a softbox edge came into frame), and no text
 * ("Model agency digital" was once written into the picture).
 */
export const BUILDER_REAL = {
  hair: "real hair, not a solid helmet: the same cut, with a few fine flyaways crossing the outline of the hair against the background, a few short baby hairs at the temples and along the parting, and individual strands separating at the ends",
  makeup: "the brand's clean glam as a real make-up artist does it on set, visible but skin-like: a light base that lets the skin's texture show through, softly sculpted cheekbones with no visible contour lines, a natural flush on the cheeks, groomed brushed-up brows, soft brown definition at the lash line and separated lashes, nude lips with their own natural texture and a soft balm finish, not glossy",
  skin: "real, unretouched skin: pores visible on the nose, cheeks and chin, very fine, barely visible peach fuzz on the cheeks only where the light grazes them (never on the jaw or chin, never like stubble), slight natural colour variation with a little warmth around the nose and on the cheeks, a soft natural sheen only on the high points of the face; nothing smoothed, blurred or glowing",
  // The first paid test drew the softbox itself into the frame: the light is described, the equipment is excluded.
  light: "soft directional light from one large source in front of her and to one side, with natural fall-off: one side of the face slightly darker than the other, soft shadows under the cheekbones, the jaw and the nose; plain light grey seamless paper filling the whole background, with a gentle natural fall-off of the light across it; no windows, walls or backdrop edges, and no lights, softboxes, stands or other studio equipment visible anywhere in the picture",
  camera: "a real photograph straight out of the camera, not retouched: full-frame camera, 85 mm lens at f/4, ISO 200, natural colour and contrast, focus on the eyes with a gentle fall-off towards the ears and shoulders, fine natural grain; eyes with one soft catchlight each and natural, slightly off-white whites; the face with its natural slight asymmetry. It must not look like CGI, a 3D render, a beauty filter or a retouched beauty advert: no HDR look, no sharpening halos, no skin smoothing. No text, captions, logos or watermarks anywhere in the picture",
} as const;
const REAL = BUILDER_REAL;

/** A face and presence like the models international brands book for their campaigns. */
const LOOK =
  "She has the face and presence of an in-demand top fashion model who walks international runways and fronts campaigns: striking rather than pretty, " +
  "high sculpted cheekbones, a defined jawline and chin, strong groomed brows, full lips, a long elegant neck and defined collarbones; tall, slim, long-limbed model build. " +
  // Round 2: "striking" without this aged two of three candidates (gaunt, hollow-cheeked, past 30).
  "A young face that matches her age: youthful skin and a soft fullness in the cheeks under the high cheekbones; never gaunt, hollow-cheeked or older-looking.";

/** The attitude: cool and self-assured, never sweet. */
const ATTITUDE =
  "Attitude: cool, self-assured and a little aloof, with the quiet intensity of a campaign model: a strong, direct gaze straight into the lens, " +
  "chin level or very slightly lowered, a relaxed but firm mouth with the lips closed. Not smiling, not sweet, not shy, not a pose.";

/** The identity portrait: head and shoulders, the same set-up as the library's portraits. One prompt, several candidates. */
export function builderPortraitPrompt(spec: BuilderSpec): string {
  return [
    `Model agency digital of an original fictional adult woman, ${spec.ageYears} years old. She is not a real or identifiable person and must not resemble any real person, model or celebrity.`,
    `${text("heritage", spec.heritage)}; ${text("eyes", spec.eyes)}; ${text("skin", spec.skin)} skin${spec.freckles ? ` with ${FRECKLES}` : ""}. Hair: ${builderHair(spec)}.`,
    LOOK,
    ATTITUDE,
    `Hair finish: styled by a hairstylist for the shoot; ${REAL.hair}.`,
    `Makeup: ${REAL.makeup}.`,
    `Skin: ${REAL.skin}.`,
    "No jewellery. Straight-on front view: face and shoulders square to the camera, no head turn; head and shoulders with space above the head and the shoulders and tank top fully visible, camera at eye level. " +
      "Plain fitted black tank top.",
    `Light: ${REAL.light}. Camera: ${REAL.camera}.`,
  ].join("\n\n");
}

/**
 * A new identity portrait of a woman the generator sees in attached photographs: who she is from them, the finish
 * from BUILDER_REAL. Used for the owner's AI models (scripts/model-from-image.ts: Freja, Inés) and the library refresh
 * (scripts/model-realism.ts).
 *
 * The attached photographs must be small or soft. With a sharp 2K portrait in the same framing the generator edits
 * instead of photographing anew: round 2 of the library refresh (2026-11-15) came back as near copies with sharpened,
 * still glowing skin. Freja and Inés, whose faces were small in their source photographs, came back as real photographs.
 */
export function realPortraitPrompt(o: { sources: string; description: string; sourceFlaw: string; ageYears: number; hair: string; one?: boolean }): string {
  const att = o.one ? "the attached photograph" : "the attached photographs";
  return [
    `Model agency digital (identity portrait) of exactly the same original fictional adult woman as in ${att}: ${o.sources}. ` +
      "She is not a real or identifiable person and must not resemble any real person, model or celebrity.",
    o.description,
    "Keep her identity exactly: face shape, bone structure, eye shape and colour, brows, nose, lips, skin tone, freckles, hair colour and hairline. She must be immediately recognisable as the same woman.",
    `Take only who she is from ${att}, not how ${o.one ? "it looks" : "they look"}: ${o.sourceFlaw}. The new picture is a real, unretouched photograph of her (see skin, light and camera below).`,
    `${o.ageYears} years old: a young face that matches her age, youthful skin and a soft fullness in the cheeks under the cheekbones; never gaunt, hollow-cheeked or older-looking.`,
    "Photograph her the way a top agency would: she has the presence of an in-demand fashion model who fronts international campaigns. " + ATTITUDE,
    `Hair: ${o.hair}, exactly as in ${att}; styled by a hairstylist for the shoot; ${REAL.hair}.`,
    `Makeup: ${REAL.makeup}.`,
    `Skin: ${REAL.skin}.`,
    "One single photograph of her alone, filling the frame: not a collage, diptych, split frame or several views side by side. " +
      "No jewellery. Straight-on front view: face and shoulders square to the camera, no head turn; head and shoulders with space above the head and the shoulders and tank top fully visible, camera at eye level. Plain fitted black tank top.",
    `Light: ${REAL.light}. Camera: ${REAL.camera}.`,
  ].join("\n\n");
}

/** The reference set made from the chosen portrait, in the order it is shown. */
export const REFERENCE_KINDS = ["threeQuarter", "profile", "bodyFront", "bodyBack", "characterSheet"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_LABELS: Record<ReferenceKind | "portrait", string> = {
  portrait: "Identity portrait", threeQuarter: "Three-quarter", profile: "Profile", bodyFront: "Body, front", bodyBack: "Body, back", characterSheet: "Character sheet",
};
export const REFERENCE_ASPECT: Record<ReferenceKind | "portrait", "1:1" | "2:3" | "16:9"> = {
  portrait: "1:1", threeQuarter: "1:1", profile: "1:1", bodyFront: "2:3", bodyBack: "2:3", characterSheet: "16:9",
};
/** Candidates per portrait round. */
export const PORTRAITS_PER_ROUND = 3;

/** A model's name: 2 to 24 letters (spaces, hyphens and apostrophes inside). Never part of a prompt. */
export const MODEL_NAME_RULE = /^[\p{L}][\p{L}' -]{0,22}[\p{L}]$/u;

export function builderReferencePrompt(kind: ReferenceKind, spec: BuilderSpec): string {
  const same = "exactly the same original fictional adult woman as in the attached identity portrait: identical face, bone structure, skin tone, freckles, hair colour, hairstyle and makeup. She is not a real or identifiable person.";
  const hair = `${builderHair(spec)} (exactly as in the portrait)`;
  const finish = `Hair: ${hair}; ${REAL.hair}. Makeup: ${REAL.makeup}. Skin: ${REAL.skin}.`;
  const body = `${spec.heightCm} cm tall, slim, long-limbed, toned fashion-model build, EU size ${spec.euSize}. Plain fitted black tank top and plain black leggings, barefoot.`;
  const even = "Soft even studio light, plain light grey seamless background filling the whole frame, no studio equipment visible, no distortion.";
  switch (kind) {
    case "threeQuarter":
      return `Identity reference, three-quarter view, of ${same}\n\nHead and shoulders, head and body turned about 40 degrees to the side, eyes following the head, the same cool, self-assured expression as in the portrait, lips closed. Plain fitted black tank top.\n\n${finish} Light: ${REAL.light}. Camera: ${REAL.camera}.`;
    case "profile":
      return `Identity reference, side profile, of ${same}\n\nHead and shoulders in exact side profile (90 degrees), the same cool, self-assured expression as in the portrait, lips closed. Plain fitted black tank top.\n\n${finish} Light: ${REAL.light}. Camera: ${REAL.camera}.`;
    case "bodyFront":
      return `Full-body reference photograph of ${same}\n\n${body} Standing straight-on facing the camera with a tall, confident model posture, weight even, arms relaxed at the sides, the same cool expression as in the portrait. Head to toe in frame with margin above and below; camera at waist height.\n\n${finish} ${even} Camera: ${REAL.camera}.`;
    case "bodyBack":
      return `Full-body reference photograph of ${same}\n\n${body} Standing with the back to the camera, weight even, arms relaxed, head straight forward, face not visible. Head to toe in frame; camera at waist height.\n\n${finish} ${even} Camera: ${REAL.camera}.`;
    case "characterSheet":
      // Simple beats overloaded: exactly five large panels, one neutral pose, even light, no text.
      return `Character reference sheet of ${same}\n\nOne wide image with exactly five large panels side by side, evenly spaced, nothing else: ` +
        `1) face close-up, front, 2) full body front, 3) full body back, 4) full body left profile, 5) full body right profile. ` +
        `The full-body panels share one scale and the same neutral standing pose: arms relaxed at the sides, legs straight; ${body} ` +
        `Identical face, hair, makeup and skin in every panel; the same cool, self-assured expression as in the portrait, lips closed. ${even} No text, labels, numbers, rulers or extra panels.\n\n${finish} Camera: ${REAL.camera}.`;
  }
}

/** How the model is described to production prompts (templates.ts), like the library's models. */
export function builderLook(spec: BuilderSpec): ModelVersion["look"] {
  // Production prompts read "<features>; <eyes>; <skinTone> skin; <hair>", so freckles belong with the features.
  return {
    hair: `${hairCore(spec)}, usually ${styleOf(spec)}`,
    skinTone: text("skin", spec.skin),
    eyes: text("eyes", spec.eyes),
    features: `${text("heritage", spec.heritage)}${spec.freckles ? `, ${FRECKLES}` : ""}`,
  };
}

/** A readable one-line summary of the choices, e.g. "Southern European · light olive · dark brown long straight hair". */
export function builderSummary(spec: BuilderSpec): string {
  const label = <K extends keyof typeof BUILDER_OPTIONS>(k: K, v: string) => BUILDER_OPTIONS[k].find((o) => o[0] === v)?.[1] ?? v;
  return [
    label("heritage", spec.heritage), label("skin", spec.skin).toLowerCase() + (spec.freckles ? " with freckles" : ""),
    `${label("hairColour", spec.hairColour).toLowerCase()} ${label("hairLength", spec.hairLength).toLowerCase()} ${label("hairTexture", spec.hairTexture).toLowerCase()} hair`,
    `${label("eyes", spec.eyes).toLowerCase()} eyes`, `${spec.ageYears}`, `${spec.heightCm} cm`, `EU ${spec.euSize}`,
  ].join(" · ");
}
