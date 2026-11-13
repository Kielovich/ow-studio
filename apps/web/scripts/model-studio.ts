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
import { assets, getModel, insertModelVersion, listModels, setModelStatus } from "../lib/server/repo";

loadLocalSecrets();
const stage = process.argv[2];
const confirm = process.argv.includes("--confirm");
const DIR = join(DATA_DIR, "model-gen");
mkdirSync(DIR, { recursive: true });
const STATE_FILE = join(DIR, "state.json");
type Entry = { portrait?: string; bodyFront?: string; bodyBack?: string; threeQuarter?: string; profile?: string; prompts: Record<string, string> };
const state: Record<string, Entry> = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

/** Shared look, distilled in words from the mood references: attitude, body and finish, never a specific face or hairstyle. */
const LOOK =
  "High-fashion model look: quiet confidence, composed and self-possessed, a strong but relaxed direct gaze. " +
  "High, sculpted cheekbones and a clearly defined jawline. Glowing, healthy skin with real texture, pores and a few natural freckles; " +
  "softly brushed-up brows; warm bronze sculpting, a touch of soft brown liner and a nude glossy lip. " +
  "Body: tall, slim, long-limbed and toned, elegant long neck and defined collarbones.";

type NewModel = { modelId: string; displayName: string; ageYears: number; heightCm: number; euSize: number; look: ModelVersion["look"] };

const NEW_MODELS: NewModel[] = [
  {
    modelId: "M02", displayName: "Freja", ageYears: 23, heightCm: 179, euSize: 36,
    look: { hair: "long warm golden-blonde hair (clearly golden, not red, not strawberry, not platinum), straight with a soft centre part, past the shoulders", skinTone: "fair with a warm undertone and light freckles", eyes: "pale blue-grey eyes", features: "high sculpted cheekbones, straight nose, full lips, defined jaw, light brushed-up brows" },
  },
  {
    modelId: "M03", displayName: "Inès", ageYears: 23, heightCm: 177, euSize: 36,
    look: { hair: "shoulder-length chocolate-brown hair with soft natural waves, centre part", skinTone: "light olive", eyes: "grey-green eyes", features: "young, striking angular face, high pronounced cheekbones, straight dark brows, sharply defined jaw, full lips" },
  },
  {
    modelId: "M04", displayName: "Amara", ageYears: 24, heightCm: 180, euSize: 36,
    look: { hair: "short natural tightly coiled black hair, cropped close to the head", skinTone: "deep ebony brown with a warm undertone", eyes: "dark brown eyes", features: "high cheekbones, full lips, smooth rounded forehead, defined jaw, long elegant neck" },
  },
];

/** Second pass (2026-11-13): the first Freja and Inès portraits came out bare-faced and plain; the makeup is made explicit. */
const EDITORIAL_FINISH =
  "Clearly visible editorial makeup, as on a fashion campaign set: dewy glowing highlight on the cheekbones and bridge of the nose, " +
  "warm bronzed contour under the cheekbones, defined lashes with a soft smoky brown liner, groomed brushed-up brows, nude glossy lips. " +
  "The face reads young, striking and editorial, not plain and not a passport photo.";

const portraitPrompt = (m: NewModel) => [
  `Identity portrait of an original fictional adult woman, ${m.ageYears} years old. She is not a real or identifiable person and must not resemble any real person, model or celebrity.`,
  `${m.look.features}; ${m.look.eyes}; ${m.look.skinTone} skin; ${m.look.hair}.`,
  LOOK,
  EDITORIAL_FINISH,
  "Straight-on front view, head and shoulders, camera at eye level, about 85 mm equivalent. Plain fitted black tank top. Neutral, relaxed expression, lips closed, calm direct gaze into the camera.",
  "Plain light grey seamless studio background, soft high frontal key light, low contrast. Real skin texture; no smoothing, no plastic look.",
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
  const sable = getModel("M01", 2);
  if (!sable) throw new Error("Sable v2 missing");
  const jobs: { key: string; kind: keyof Entry; prompt: string; refs: string[]; aspect: "1:1" | "2:3" }[] = [];

  if (stage === "portraits") {
    // --redo M02,M03 regenerates those portraits; the rejected one is kept under rejectedPortraits.
    const redoArg = process.argv.indexOf("--redo");
    const redo = new Set(redoArg > 0 ? process.argv[redoArg + 1]!.split(",") : []);
    for (const id of redo) {
      const s = state[id];
      if (s?.portrait) { (s as any).rejectedPortraits = [...((s as any).rejectedPortraits ?? []), s.portrait]; delete s.portrait; }
    }
    for (const m of NEW_MODELS) if (!state[m.modelId]?.portrait) jobs.push({ key: m.modelId, kind: "portrait", prompt: portraitPrompt(m), refs: [], aspect: "1:1" });
  } else if (stage === "refs") {
    const all = [...NEW_MODELS.map((m) => ({ id: m.modelId, look: m.look, heightCm: m.heightCm, portrait: state[m.modelId]?.portrait })), { id: "M01", look: sable.look, heightCm: sable.heightCm, portrait: sable.refs.primaryPortrait }];
    for (const m of all) {
      if (!m.portrait) throw new Error(`${m.id} has no portrait yet`);
      state[m.id] ??= { prompts: {} };
      state[m.id]!.portrait ??= m.portrait;
      const kinds: ("bodyFront" | "bodyBack" | "threeQuarter" | "profile")[] = m.id === "M01" ? ["threeQuarter", "profile"] : ["bodyFront", "bodyBack", "threeQuarter", "profile"];
      for (const k of kinds) if (!state[m.id]![k]) jobs.push({ key: m.id, kind: k, prompt: fromPortrait(k, m.look, m.heightCm), refs: [m.portrait], aspect: k.startsWith("body") ? "2:3" : "1:1" });
    }
  } else if (stage === "register") {
    const existing = new Set(listModels().map((m) => `${m.modelId}@${m.version}`));
    for (const m of NEW_MODELS) {
      const s = state[m.modelId];
      if (!s?.portrait || !s.bodyFront || !s.bodyBack || !s.threeQuarter || !s.profile) { console.log(`${m.modelId}: incomplete, skipped`); continue; }
      if (existing.has(`${m.modelId}@1`)) { console.log(`${m.modelId} v1 exists`); continue; }
      insertModelVersion({ ...m, version: 1, refs: {
        primaryPortrait: s.portrait, identityAngles: [s.threeQuarter, s.profile],
        fullBodyFront: await headless(s.bodyFront), fullBodyBack: await headless(s.bodyBack),
        characterSheet: s.portrait, facialDetailSheet: s.portrait,
      } }, "active");
      console.log(`${m.modelId} ${m.displayName} v1 registered`);
    }
    const s = state.M01;
    if (s?.threeQuarter && s.profile && !existing.has("M01@3")) {
      insertModelVersion({ ...sable, version: 3, refs: { ...sable.refs, identityAngles: [s.threeQuarter, s.profile] } }, "active");
      setModelStatus("M01", 2, "archived");
      console.log("M01 Sable v3 registered (v2 archived, still used by its productions)");
    }
    return;
  } else {
    throw new Error("stage must be portraits | refs | register");
  }

  console.log(`${jobs.length} images planned, est. $${(jobs.length * GEMINI_PRO_PROFILE.estimatedCostUsd).toFixed(2)}`);
  for (const j of jobs) console.log(`  ${j.key} ${j.kind}`);
  if (!confirm) { console.log("Dry run. Add --confirm."); return; }
  for (const j of jobs) {
    const hash = await generate(j.prompt, j.refs, j.aspect);
    state[j.key] ??= { prompts: {} };
    (state[j.key] as any)[j.kind] = hash;
    state[j.key]!.prompts[j.kind] = j.prompt;
    save();
    console.log(`  ${j.key} ${j.kind} -> ${hash.slice(7, 19)}`);
  }
  console.log(`spent ~$${spent.toFixed(2)}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
