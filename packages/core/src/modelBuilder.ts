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

/** Realism language from the realism refresh (docs/realism-audit.md, lever 2). */
const REAL = {
  hair: "real hair, not a solid helmet: the same cut, with a few fine flyaways crossing the outline of the hair against the background, a few short baby hairs at the temples and along the parting, and individual strands separating at the ends",
  makeup: "polished clean-glam makeup as on a fashion e-commerce set, finished as on a real set: contour softly blended with no bronze stripe, groomed defined brows and lashes, highlight only as a faint natural sheen on the cheekbones; lips in a matte nude with visible natural lip texture, no gloss and no shine",
  skin: "real skin: visible pores, slight natural unevenness and colour variation, a few tiny marks, no airbrushing, no oily or dewy shine",
  // The first paid test drew the softbox itself into the frame: the light is described, the equipment is excluded.
  light: "one large soft key light slightly to one side of the camera with gentle fall-off across the face, plus soft fill; bright studio, plain light grey seamless background filling the whole frame; no lights, softboxes, stands or other studio equipment visible anywhere in the picture",
  camera: "full-frame camera, 85 mm lens at f/5.6, ISO 100: natural micro-contrast, crisp individual lashes and hairs, very subtle grain",
};

const LOOK =
  "She looks like a real, professional fashion model booked for high-street fashion e-commerce and campaigns: fresh, youthful and natural, " +
  "effortlessly beautiful, high cheekbones and good bone structure with soft, young skin. Tall, slim, long-limbed model body with a long neck and defined collarbones. " +
  "Calm, cool, approachable confidence: relaxed neutral mouth, not smiling, not pouting, not posing.";

/** The identity portrait: head and shoulders, the same set-up as the library's portraits. One prompt, several candidates. */
export function builderPortraitPrompt(spec: BuilderSpec): string {
  return [
    `Model agency digital of an original fictional adult woman, ${spec.ageYears} years old. She is not a real or identifiable person and must not resemble any real person, model or celebrity.`,
    `${text("heritage", spec.heritage)}; ${text("eyes", spec.eyes)}; ${text("skin", spec.skin)} skin${spec.freckles ? ` with ${FRECKLES}` : ""}. Hair: ${builderHair(spec)}.`,
    LOOK,
    `Hair finish: ${REAL.hair}.`,
    `Makeup: ${REAL.makeup}.`,
    `Skin: ${REAL.skin}.`,
    "No jewellery. Straight-on front view, head and shoulders with space above the head and the shoulders and tank top fully visible, camera at eye level. " +
      "Plain fitted black tank top. Calm expression, lips closed, direct gaze into the camera.",
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
      return `Identity reference, three-quarter view, of ${same}\n\nHead and shoulders, head and body turned about 40 degrees to the side, eyes following the head, calm expression, lips closed. Plain fitted black tank top.\n\n${finish} Light: ${REAL.light}. Camera: ${REAL.camera}.`;
    case "profile":
      return `Identity reference, side profile, of ${same}\n\nHead and shoulders in exact side profile (90 degrees), calm expression, lips closed. Plain fitted black tank top.\n\n${finish} Light: ${REAL.light}. Camera: ${REAL.camera}.`;
    case "bodyFront":
      return `Full-body reference photograph of ${same}\n\n${body} Standing straight-on facing the camera, weight even, arms relaxed at the sides, calm expression. Head to toe in frame with margin above and below; camera at waist height.\n\n${finish} ${even}`;
    case "bodyBack":
      return `Full-body reference photograph of ${same}\n\n${body} Standing with the back to the camera, weight even, arms relaxed, head straight forward, face not visible. Head to toe in frame; camera at waist height.\n\n${finish} ${even}`;
    case "characterSheet":
      // Simple beats overloaded: exactly five large panels, one neutral pose, even light, no text.
      return `Character reference sheet of ${same}\n\nOne wide image with exactly five large panels side by side, evenly spaced, nothing else: ` +
        `1) face close-up, front, 2) full body front, 3) full body back, 4) full body left profile, 5) full body right profile. ` +
        `The full-body panels share one scale and the same neutral standing pose: arms relaxed at the sides, legs straight; ${body} ` +
        `Identical face, hair, makeup and skin in every panel; calm expression, lips closed. ${even} No text, labels, numbers, rulers or extra panels.\n\n${finish} Camera: ${REAL.camera}.`;
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
