/**
 * A new model from an AI-generated photograph (the owner's own, of an original fictional woman): a new identity
 * portrait of the same woman in the brand's look (realism, clean glam, cool attitude), then her reference set with the
 * model builder's prompts, then a new model. Never for photographs of real people (mood references stay references).
 * The source photograph stays in the local asset store; only the generated portrait and references become the model.
 *
 *   npx tsx scripts/model-from-image.ts <key> init <photo.png>          free: stores the photograph and a face crop
 *   npx tsx scripts/model-from-image.ts <key> portrait [--confirm] [--note "..."]   1 image
 *   npx tsx scripts/model-from-image.ts <key> refs [--confirm] [--redo bodyBack]   5 images (the builder's reference set)
 *   npx tsx scripts/model-from-image.ts <key> register <Name>          a new model, version 1, active
 *
 * Without --confirm nothing is sent: the script prints the exact prompts and the images it would attach.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  BUILDER_OPTIONS, BUILDER_REAL, BuilderSpec, builderHair, builderLook, builderReferencePrompt, extractImages, GEMINI_API_REVISION, GEMINI_ENDPOINT, GEMINI_PRO_PROFILE,
  loadLocalSecrets, MODEL_NAME_RULE, REFERENCE_ASPECT, REFERENCE_KINDS, type ReferenceKind,
} from "@ow-studio/core";
import { headless, nextModelId } from "../lib/server/builder";
import { DATA_DIR } from "../lib/server/db";
import { assets, insertModelVersion, listModels } from "../lib/server/repo";

/**
 * The two models from the owner's photographs (2026-11-15). The spec feeds the builder's reference prompts and the look
 * production prompts read; `hair` replaces the builder's hair wording and `eyes` its eye colour where her own is more exact.
 */
const MODELS: Record<string, { spec: BuilderSpec; hair?: string; lookHair?: string; eyes?: string; faceCrop: [number, number, number] }> = {
  blonde: {
    spec: BuilderSpec.parse({ heritage: "northern-european", skin: "fair", freckles: true, hairColour: "dark-blonde", hairTexture: "wavy", hairLength: "long", hairStyle: "low-bun", eyes: "blue", ageYears: 25, heightCm: 178, euSize: 36 }),
    hair: "long dark blonde hair with lighter golden face-framing strands, pulled back into a soft low bun with a centre part, a few loose strands falling by the temples",
    lookHair: "long dark blonde hair with lighter golden face-framing strands, usually pulled back into a soft low bun with a centre part",
    eyes: "light blue-grey eyes",
    faceCrop: [760, 0, 520],
  },
  dark: {
    spec: BuilderSpec.parse({ heritage: "mixed", skin: "light-olive", freckles: false, hairColour: "dark-brown", hairTexture: "straight", hairLength: "long", hairStyle: "low-bun", eyes: "brown", ageYears: 24, heightCm: 178, euSize: 36 }),
    faceCrop: [760, 0, 520],
  },
};

loadLocalSecrets();
const [key, stage, arg] = process.argv.slice(2) as [string, string, string | undefined];
const m = MODELS[key];
if (!m) throw new Error(`key must be one of ${Object.keys(MODELS).join(", ")}`);
const confirm = process.argv.includes("--confirm");
const STATE = join(DATA_DIR, "model-gen", `from-image-${key}.json`);
mkdirSync(join(DATA_DIR, "model-gen"), { recursive: true });
const state: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const COST = GEMINI_PRO_PROFILE.estimatedCostUsd;

/** The builder's wording with her own hair and eye description; fails loudly if the wording it replaces is not there. */
function own(prompt: string): string {
  let out = prompt;
  const swap = (from: string, to?: string) => {
    if (!to) return;
    if (!out.includes(from)) throw new Error(`prompt does not contain "${from}"`);
    out = out.replaceAll(from, to);
  };
  swap(builderHair(m.spec), m.hair);
  return out;
}

const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);
const opt = (k: keyof typeof BUILDER_OPTIONS, v: string) => BUILDER_OPTIONS[k].find((o) => o[0] === v)![2];

/** The new identity portrait: the same woman, the brand's look. Her face from the photograph, the finish from the builder. */
function portraitPrompt(): string {
  const R = BUILDER_REAL;
  return own([
    "Model agency digital (identity portrait) of exactly the same original fictional adult woman as in the attached photographs: " +
      "the first is a full-length photograph of her, the second a crop of her face from it. She is not a real or identifiable person and must not resemble any real person, model or celebrity.",
    `${cap(opt("heritage", m.spec.heritage))}; ${m.eyes ?? opt("eyes", m.spec.eyes)}; ${opt("skin", m.spec.skin)} skin${m.spec.freckles ? " with light natural freckles" : ""}.`,
    "Keep her identity exactly: face shape, bone structure, eye shape and colour, brows, nose, lips, skin tone, freckles, hair colour and hairline. She must be immediately recognisable as the same woman.",
    `${m.spec.ageYears} years old: a young face that matches her age, smooth youthful skin and a soft fullness in the cheeks under the cheekbones; never gaunt, hollow-cheeked or older-looking.`,
    "Photograph her the way a top agency would: she has the presence of an in-demand fashion model who fronts international campaigns. " +
      "Attitude: cool, self-assured and a little aloof, with the quiet intensity of a campaign model: a strong, direct gaze straight into the lens, chin level or very slightly lowered, a relaxed but firm mouth with the lips closed. Not smiling, not sweet, not shy, not a pose.",
    `Hair: ${builderHair(m.spec)}, exactly as in the photograph; styled and expensive-looking; ${R.hair}.`,
    `Makeup: ${R.makeup}.`,
    `Skin: ${R.skin}.`,
    "No jewellery. Straight-on front view: face and shoulders square to the camera, no head turn; head and shoulders with space above the head and the shoulders and tank top fully visible, camera at eye level. Plain fitted black tank top.",
    `Light: ${R.light}. Camera: ${R.camera}.`,
  ].join("\n\n"));
}

async function generate(prompt: string, refs: string[], aspect: "1:1" | "2:3" | "16:9"): Promise<string> {
  const images = await Promise.all(refs.map((h) => assets.resolve(h)));
  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "", "api-revision": GEMINI_API_REVISION },
    body: JSON.stringify({
      model: GEMINI_PRO_PROFILE.id,
      input: [{ type: "text", text: prompt }, ...images.map((i) => ({ type: "image", mime_type: i.mime, data: Buffer.from(i.bytes).toString("base64") }))],
      response_format: { type: "image", aspect_ratio: aspect, image_size: "2K" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const img = extractImages(JSON.parse(text))[0];
  if (!img) throw new Error(`no image returned: ${text.slice(0, 300)}`);
  // Stored before anything else, so a paid image is never lost.
  return assets.putBytes(new Uint8Array(Buffer.from(img.data, "base64")));
}

async function describe(refs: string[]) {
  for (const h of refs) {
    const { bytes } = await assets.resolve(h);
    const meta = await sharp(bytes).metadata();
    console.log(`  attach ${h.slice(0, 19)}… ${meta.width}x${meta.height} ${meta.format} ${(bytes.length / 1024).toFixed(0)} KB`);
  }
}

async function main() {
  if (stage === "init") {
    if (!arg || !existsSync(arg)) throw new Error("give the photograph's path");
    const bytes = new Uint8Array(readFileSync(arg));
    const [left, top, size] = m.faceCrop;
    const face = await sharp(bytes).extract({ left, top, width: size, height: size }).resize(1024, 1024, { kernel: "lanczos3" }).png().toBuffer();
    state.source = await assets.putBytes(bytes);
    state.face = await assets.putBytes(new Uint8Array(face));
    save();
    console.log(`stored: source ${state.source}, face crop ${state.face}`);
  } else if (stage === "portrait") {
    if (!state.source || !state.face) throw new Error("run init first");
    const note = process.argv.includes("--note") ? `\n\nCorrection: ${process.argv[process.argv.indexOf("--note") + 1]}` : "";
    const prompt = portraitPrompt() + note;
    console.log(`1 image (identity portrait, ${key}), 1:1 2K, est. $${COST.toFixed(2)}`);
    await describe([state.source, state.face]);
    if (!confirm) return console.log("\nDry run. Add --confirm.\n\n" + prompt);
    if (state.portrait) state[`rejected_portrait_${Date.now()}`] = state.portrait;
    state.portrait = await generate(prompt, [state.source, state.face], "1:1");
    save();
    console.log("portrait ->", state.portrait);
  } else if (stage === "refs") {
    if (!state.portrait && confirm) throw new Error("make and approve the portrait first");
    const redo = process.argv.includes("--redo") ? process.argv[process.argv.indexOf("--redo") + 1]!.split(",") : [];
    for (const k of redo) if (state[k]) { state[`rejected_${k}_${Date.now()}`] = state[k]!; delete state[k]; }
    const kinds = REFERENCE_KINDS.filter((k) => !state[k]);
    console.log(`${kinds.length} images (${kinds.join(", ")}), 2K, est. $${(kinds.length * COST).toFixed(2)}`);
    if (state.portrait) await describe([state.portrait]);
    else console.log("  attach: the approved portrait (not made yet)");
    if (!confirm) {
      for (const k of kinds) console.log(`\n--- ${k} (${REFERENCE_ASPECT[k]}) ---\n${own(builderReferencePrompt(k, m.spec))}`);
      return console.log("\nDry run. Add --confirm.");
    }
    for (const k of kinds) {
      state[k] = await generate(own(builderReferencePrompt(k, m.spec)), [state.portrait], REFERENCE_ASPECT[k] as "1:1" | "2:3" | "16:9");
      save();
      console.log(k, "->", state[k]);
    }
  } else if (stage === "register") {
    const name = (arg ?? "").trim();
    if (!MODEL_NAME_RULE.test(name)) throw new Error("give her a name: 2 to 24 letters");
    if (listModels().some((x) => x.status === "active" && x.data.displayName.toLowerCase() === name.toLowerCase())) throw new Error(`${name} exists`);
    if (state.modelId) throw new Error(`already registered as ${state.modelId}`);
    const ref = (k: ReferenceKind) => { if (!state[k]) throw new Error(`missing ${k}`); return state[k]!; };
    const look = builderLook(m.spec);
    const modelId = nextModelId();
    insertModelVersion({
      modelId, version: 1, displayName: name, ageYears: m.spec.ageYears, heightCm: m.spec.heightCm, euSize: m.spec.euSize,
      look: { ...look, ...(m.lookHair ? { hair: m.lookHair } : {}), ...(m.eyes ? { eyes: m.eyes } : {}) },
      refs: {
        primaryPortrait: ref("portrait" as ReferenceKind), identityAngles: [ref("threeQuarter"), ref("profile")],
        fullBodyFront: await headless(ref("bodyFront")), fullBodyBack: await headless(ref("bodyBack")),
        characterSheet: ref("characterSheet"), facialDetailSheet: ref("portrait" as ReferenceKind),
      },
    }, "active");
    state.modelId = modelId;
    save();
    console.log(`${name} registered as ${modelId} v1, active.`);
  } else {
    throw new Error("stage must be init | portrait | refs | register");
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
