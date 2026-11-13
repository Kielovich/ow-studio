/**
 * Builds model reference sets with Nano Banana Pro and registers them as immutable model versions.
 *
 *   npx tsx scripts/model-studio.ts portraits [--confirm]   identity portraits for new models (text only)
 *   npx tsx scripts/model-studio.ts refs [--confirm]        body front/back + three-quarter + profile from each portrait
 *   npx tsx scripts/model-studio.ts register                registers versions (no API calls)
 *
 * Mood references supplied by the user are NEVER sent to the generator: they may show real people.
 * Their attitude, body type and look are described in words only (see LOOK below), so every face is original.
 * State and prompts are kept in <DATA_DIR>/model-gen/state.json for traceability.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { extractImages, GEMINI_API_REVISION, GEMINI_ENDPOINT, GEMINI_PRO_PROFILE, loadLocalSecrets, type ModelVersion } from "@ow-studio/core";
import { DATA_DIR } from "../lib/server/db";
import { assets, insertModelVersion, listModels, setModelStatus } from "../lib/server/repo";

loadLocalSecrets();
const stage = process.argv[2];
const confirm = process.argv.includes("--confirm");
const DIR = join(DATA_DIR, "model-gen");
mkdirSync(DIR, { recursive: true });
const STATE_FILE = join(DIR, "state.json");
type Entry = { portrait?: string; bodyFront?: string; bodyBack?: string; threeQuarter?: string; profile?: string; prompts: Record<string, string> };
const state: Record<string, Entry> = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

/**
 * Look brief, third pass (2026-11-13). User direction: real, young high-street fashion models (the kind booked for large
 * fashion retailers' e-commerce and campaigns). Earlier passes were rejected as too old, too plain or too made-up.
 * Mood references only informed attitude, body and finish in words; no image of them is ever sent.
 */
const LOOK =
  "She looks like a real, professional fashion model booked for high-street fashion e-commerce and campaigns: fresh, youthful and natural, " +
  "effortlessly beautiful, a face with high cheekbones and good bone structure but soft, young skin. " +
  "Healthy luminous skin with real texture and pores; natural groomed brows; minimal clean makeup (light skin tint, a little mascara, balm on the lips). " +
  "Tall, slim, long-limbed model body with a long neck and defined collarbones. " +
  "Calm, cool, approachable confidence: relaxed neutral mouth, not smiling, not pouting, not posing.";

type NewModel = { modelId: string; displayName: string; ageYears: number; heightCm: number; euSize: number; look: ModelVersion["look"]; owStyled?: boolean };

/** Every model in the library, rebuilt in the new direction. M01 gets a new version; productions keep the version they used. */
const NEW_MODELS: NewModel[] = [
  { modelId: "M01", displayName: "Sable", ageYears: 21, heightCm: 178, euSize: 36,
    look: { hair: "long straight dark-brown hair with a centre part", skinTone: "olive", eyes: "dark-brown eyes", features: "high cheekbones, straight natural brows, soft full lips" } },
  { modelId: "M02", displayName: "Freja", ageYears: 20, heightCm: 179, euSize: 36,
    look: { hair: "long warm golden-blonde hair (golden, not red, not platinum), straight with a centre part", skinTone: "fair with light freckles", eyes: "blue-grey eyes", features: "high cheekbones, straight nose, natural full lips" } },
  { modelId: "M03", displayName: "Inès", ageYears: 21, heightCm: 177, euSize: 36,
    look: { hair: "shoulder-length chocolate-brown hair with soft natural waves, centre part", skinTone: "light olive", eyes: "grey-green eyes", features: "high cheekbones, natural straight brows, full lips" } },
  { modelId: "M04", displayName: "Amara", ageYears: 20, heightCm: 180, euSize: 36,
    look: { hair: "short natural tightly coiled black hair, cropped close", skinTone: "deep ebony brown", eyes: "dark-brown eyes", features: "high cheekbones, full lips, long elegant neck" } },
  { modelId: "M05", displayName: "Mei", ageYears: 21, heightCm: 176, euSize: 34,
    look: { hair: "long straight glossy black hair with a centre part", skinTone: "light warm", eyes: "dark-brown monolid eyes", features: "East Asian, high cheekbones, small straight nose, soft full lips" } },
  { modelId: "M06", displayName: "Lucía", ageYears: 20, heightCm: 177, euSize: 36,
    look: { hair: "long dark-brown natural curls", skinTone: "golden tan", eyes: "hazel eyes", features: "Latina, high cheekbones, strong natural brows, full lips" } },
  // Four new models created directly in the brand's style (makeup and hair from the gallery analysis), single pass.
  { modelId: "M07", displayName: "Liv", ageYears: 20, heightCm: 178, euSize: 34, owStyled: true,
    look: { hair: "very light blonde hair", skinTone: "fair, cool undertone", eyes: "light blue eyes", features: "high cheekbones, delicate straight nose, soft full lips, light brushed-up brows" } },
  { modelId: "M08", displayName: "Nadia", ageYears: 21, heightCm: 177, euSize: 36, owStyled: true,
    look: { hair: "jet-black hair", skinTone: "light olive", eyes: "dark-brown almond-shaped eyes", features: "high cheekbones, straight strong brows, full lips, defined jaw" } },
  { modelId: "M09", displayName: "Noa", ageYears: 20, heightCm: 176, euSize: 34, owStyled: true,
    look: { hair: "chestnut-brown hair", skinTone: "fair with a warm undertone", eyes: "hazel eyes", features: "high cheekbones, soft straight nose, full lips, natural brows" } },
  { modelId: "M10", displayName: "Kaia", ageYears: 21, heightCm: 180, euSize: 36, owStyled: true,
    look: { hair: "black hair", skinTone: "medium-deep brown, warm undertone", eyes: "dark-brown eyes", features: "high sculpted cheekbones, full lips, long elegant neck, smooth forehead" } },
];

/**
 * Styling pass, from the brand's own gallery (analysis of ~55 current product images, 2026-11-13):
 * makeup is a polished clean glam (dewy highlight, warm bronze contour, groomed brows, soft brown liner, defined lashes,
 * nude-pink or glossy lips) and hair is styled, mostly sleek. Each model gets her own signature hairstyle for variety.
 * The look is baked into the identity portrait: text alone barely changes the face (phase 3 finding).
 */
const CLEAN_GLAM =
  "polished clean-glam makeup as on a fashion e-commerce set: luminous dewy skin with a soft highlight on the cheekbones and bridge of the nose, " +
  "warm bronze contour under the cheekbones, groomed defined brows, soft brown liner and defined lashes, a light flush of blush, " +
  "nude-pink lips with a soft gloss. Skin texture and pores still visible; not heavy, not theatrical";

const STYLING: Record<string, { hair: string; makeupAccent: string; hairColour?: string }> = {
  M07: { hair: "slicked-back low bun with a clean centre part, sleek, no loose strands", makeupAccent: "light brushed-up brows and a soft pink flush" },
  M08: { hair: "long, glossy, completely straight hair worn down with a centre part, tucked behind the ears", makeupAccent: "soft smoky brown liner" },
  M09: { hair: "blunt chin-length bob with a centre part, sleek and straight", makeupAccent: "warm bronze contour and nude gloss" },
  M10: { hair: "sleek slicked-back high bun, smooth with a crisp hairline", makeupAccent: "luminous highlight and high-shine glossy lips" },
  M01: { hair: "sleek slicked-back low bun with a clean centre part, no loose strands", makeupAccent: "slightly deeper bronze contour" },
  M02: { hair: "shoulder-length soft hair with a light curtain fringe, effortless and airy", hairColour: "light honey blonde (pale golden, clearly blonde, not red or copper)", makeupAccent: "light brushed-up brows and a pink flush on the cheeks" },
  M03: { hair: "long, glossy, completely straight hair with a centre part, tucked behind the ears", hairColour: "chocolate brown", makeupAccent: "soft smoky brown liner" },
  M04: { hair: "short natural coils, neatly shaped and polished with a crisp hairline", makeupAccent: "high-shine glossy lips and luminous highlight" },
  M05: { hair: "high sleek ponytail, hair pulled back tightly with a centre part", makeupAccent: "fine soft brown liner and glossy lips" },
  M06: { hair: "long defined curls with volume, a soft side part", makeupAccent: "warm golden bronze glow" },
};

const styledPrompt = (m: NewModel) => {
  const st = STYLING[m.modelId]!;
  return [
    "Model agency digital of exactly the same original fictional adult woman as in the attached portrait: identical face, bone structure, eye shape, nose, lips, skin tone and freckles. She is not a real or identifiable person.",
    `Change only her hair and makeup. Hair: ${st.hairColour ? st.hairColour + ", " : ""}${st.hair}. Makeup: ${CLEAN_GLAM}; ${st.makeupAccent}.`,
    "No jewellery. Straight-on front view, head and shoulders, camera at eye level, about 85 mm equivalent. Plain fitted black tank top. Neutral, serious expression, lips closed, calm direct gaze into the camera.",
    "Plain light grey seamless studio background, soft flattering frontal light. Real skin texture; no smoothing, no plastic look.",
  ].join("\n\n");
};

/** Single-pass portrait in the brand style: young high-street model, visible clean glam, a gallery hairstyle. */
const STRONG_GLAM =
  "clearly visible polished clean-glam makeup as on a fashion e-commerce set: luminous dewy skin with a distinct highlight on the cheekbones and bridge of the nose, " +
  "a clearly visible warm bronze contour under the cheekbones, groomed defined brows, soft brown liner and defined lashes, a light flush of blush, nude-pink glossy lips. " +
  "Skin texture and pores still visible; polished, not heavy, not theatrical";

const owPortraitPrompt = (m: NewModel) => {
  const st = STYLING[m.modelId]!;
  return [
    `Model agency digital of an original fictional adult woman, ${m.ageYears} years old. She is not a real or identifiable person and must not resemble any real person, model or celebrity.`,
    `${m.look.features}; ${m.look.eyes}; ${m.look.skinTone} skin. Hair: ${m.look.hair}, styled as a ${st.hair}.`,
    LOOK,
    `Makeup: ${STRONG_GLAM}; ${st.makeupAccent}.`,
    "No jewellery. Straight-on front view, head and shoulders, camera at eye level, about 85 mm equivalent. Plain fitted black tank top. Neutral, serious expression, lips closed, calm direct gaze into the camera.",
    "Plain light grey seamless studio background, soft flattering frontal light. Real skin texture; no smoothing, no plastic look.",
  ].join("\n\n");
};

const portraitPrompt = (m: NewModel) => [
  `Model agency digital of an original fictional adult woman, ${m.ageYears} years old. She is not a real or identifiable person and must not resemble any real person, model or celebrity.`,
  `${m.look.features}; ${m.look.eyes}; ${m.look.skinTone} skin; ${m.look.hair}.`,
  LOOK,
  "Straight-on front view, head and shoulders, camera at eye level, about 85 mm equivalent. Plain fitted black tank top. Calm direct gaze into the camera.",
  "Plain light grey seamless studio background, soft flattering frontal light. Real skin texture; no smoothing, no plastic look.",
].join("\n\n");

const fromPortrait = (kind: "bodyFront" | "bodyBack" | "threeQuarter" | "profile", look: ModelVersion["look"], heightCm: number) => {
  const same = "exactly the same original fictional adult woman as in the attached identity portrait: identical face, bone structure, skin tone, hair colour, hair length and makeup. She is not a real or identifiable person.";
  const studio = "Plain light grey seamless studio background, soft even frontal light. Real skin texture, no smoothing.";
  switch (kind) {
    case "bodyFront":
      return `Full-body reference photograph of ${same}\n\n${heightCm} cm tall, slim, long-limbed, toned fashion-model build, EU size 36. Plain fitted black tank top and plain black leggings, barefoot. Standing straight-on facing the camera, weight even, arms relaxed at the sides, neutral expression. Head to toe in frame with margin above and below; camera at waist height, no distortion.\n\n${studio}`;
    case "bodyBack":
      return `Full-body reference photograph of ${same}\n\n${heightCm} cm tall, slim, long-limbed, toned fashion-model build, EU size 36. Plain fitted black tank top and plain black leggings, barefoot. Standing with the back to the camera, weight even, arms relaxed, head straight forward, face not visible. Head to toe in frame; camera at waist height, no distortion.\n\n${studio}`;
    case "threeQuarter":
      return `Identity reference, three-quarter view, of ${same}\n\nHead and shoulders, head and body turned about 40 degrees to the side, eyes following the head direction, neutral expression, lips closed. Plain fitted black tank top. Hair: ${look.hair}.\n\n${studio}`;
    case "profile":
      return `Identity reference, side profile, of ${same}\n\nHead and shoulders in exact side profile (90 degrees), neutral expression, lips closed. Plain fitted black tank top. Hair: ${look.hair}.\n\n${studio}`;
  }
};

let spent = 0;
async function generate(prompt: string, refs: string[], aspect: "1:1" | "2:3"): Promise<string> {
  const images = await Promise.all(refs.map(assets.resolve));
  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "injected-by-proxy", "api-revision": GEMINI_API_REVISION },
    body: JSON.stringify({
      model: GEMINI_PRO_PROFILE.id,
      input: [{ type: "text", text: prompt }, ...images.map((i) => ({ type: "image", mime_type: i.mime, data: Buffer.from(i.bytes).toString("base64") }))],
      response_format: { type: "image", aspect_ratio: aspect, image_size: "2K" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  spent += GEMINI_PRO_PROFILE.estimatedCostUsd;
  const img = extractImages(JSON.parse(text))[0];
  if (!img) throw new Error(`no image returned: ${text.slice(0, 300)}`);
  return assets.putBytes(new Uint8Array(Buffer.from(img.data, "base64")));
}

/** Body references are stored headless: they carry body proportions only. */
async function headless(hash: string) {
  const { bytes } = await assets.resolve(hash);
  const m = await sharp(bytes).metadata();
  const out = await sharp(bytes).composite([{ input: { create: { width: m.width!, height: Math.round(m.height! * 0.19), channels: 3, background: { r: 241, g: 241, b: 241 } } }, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
  return assets.putBytes(new Uint8Array(out));
}

async function main() {
  const jobs: { key: string; kind: keyof Entry; prompt: string; refs: string[]; aspect: "1:1" | "2:3" }[] = [];

  if (stage === "portraits") {
    // --redo M02,M03 regenerates those portraits; the rejected one is kept under rejectedPortraits.
    const redoArg = process.argv.indexOf("--redo");
    const redo = new Set(redoArg > 0 ? process.argv[redoArg + 1]!.split(",") : []);
    for (const id of redo) {
      const s = state[id];
      if (s?.portrait) { (s as any).rejectedPortraits = [...((s as any).rejectedPortraits ?? []), s.portrait]; delete s.portrait; }
    }
    for (const m of NEW_MODELS) if (!state[m.modelId]?.portrait) jobs.push({ key: m.modelId, kind: "portrait", prompt: m.owStyled ? owPortraitPrompt(m) : portraitPrompt(m), refs: [], aspect: "1:1" });
  } else if (stage === "styled") {
    for (const m of NEW_MODELS) {
      const s = state[m.modelId];
      if (!s?.portrait) throw new Error(`${m.modelId} has no approved base portrait`);
      if ((s as any).basePortrait || m.owStyled) continue; // already styled (or styled in a single pass)
      jobs.push({ key: m.modelId, kind: "styledPortrait" as any, prompt: styledPrompt(m), refs: [s.portrait], aspect: "1:1" });
    }
  } else if (stage === "refs") {
    for (const m of NEW_MODELS) {
      const portrait = state[m.modelId]?.portrait;
      if (!portrait) throw new Error(`${m.modelId} has no approved portrait yet`);
      for (const k of ["bodyFront", "bodyBack", "threeQuarter", "profile"] as const) {
        if (!state[m.modelId]![k]) jobs.push({ key: m.modelId, kind: k, prompt: fromPortrait(k, m.look, m.heightCm), refs: [portrait], aspect: k.startsWith("body") ? "2:3" : "1:1" });
      }
    }
  } else if (stage === "register") {
    const rows = listModels();
    for (const m of NEW_MODELS) {
      const s = state[m.modelId];
      if (!s?.portrait || !s.bodyFront || !s.bodyBack || !s.threeQuarter || !s.profile) { console.log(`${m.modelId}: incomplete, skipped`); continue; }
      if ((s as any).registeredFrom === s.portrait) { console.log(`${m.modelId}: already registered`); continue; }
      const mine = rows.filter((r) => r.modelId === m.modelId);
      const version = Math.max(0, ...mine.map((r) => r.version)) + 1;
      const st = STYLING[m.modelId];
      const look = st ? { ...m.look, hair: `${st.hairColour ?? m.look.hair.split(",")[0]}, usually styled as: ${st.hair}` } : m.look;
      insertModelVersion({ ...m, look, version, refs: {
        primaryPortrait: s.portrait, identityAngles: [s.threeQuarter, s.profile],
        fullBodyFront: await headless(s.bodyFront), fullBodyBack: await headless(s.bodyBack),
        characterSheet: s.portrait, facialDetailSheet: s.portrait,
      } }, "active");
      for (const r of mine) if (r.status === "active") setModelStatus(m.modelId, r.version, "archived");
      (s as any).registeredFrom = s.portrait;
      save();
      console.log(`${m.modelId} ${m.displayName} v${version} registered${mine.length ? " (older versions archived; their productions keep them)" : ""}`);
    }
    return;
  } else {
    throw new Error("stage must be portraits | styled | refs | register");
  }

  console.log(`${jobs.length} images planned, est. $${(jobs.length * GEMINI_PRO_PROFILE.estimatedCostUsd).toFixed(2)}`);
  for (const j of jobs) console.log(`  ${j.key} ${j.kind}`);
  if (!confirm) { console.log("Dry run. Add --confirm."); return; }
  for (const j of jobs) {
    const hash = await generate(j.prompt, j.refs, j.aspect);
    state[j.key] ??= { prompts: {} };
    if ((j.kind as string) === "styledPortrait") {
      (state[j.key] as any).basePortrait = state[j.key]!.portrait;
      state[j.key]!.portrait = hash;
    } else {
      (state[j.key] as any)[j.kind] = hash;
    }
    state[j.key]!.prompts[j.kind] = j.prompt;
    save();
    console.log(`  ${j.key} ${j.kind} -> ${hash.slice(7, 19)}`);
  }
  console.log(`spent ~$${spent.toFixed(2)}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
