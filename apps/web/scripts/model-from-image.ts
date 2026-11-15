/**
 * A new model from an AI-generated photograph (the owner's own, of an original fictional woman): a new identity
 * portrait of the same woman in the brand's look (realism, clean glam, cool attitude), then her reference set with the
 * model builder's prompts, then a new model. Never for photographs of real people (mood references stay references).
 * The source photograph stays in the local asset store; only the generated portrait and references become the model.
 *
 *   npx tsx scripts/model-from-image.ts <key> init <photo.png>          free: stores the photograph and a face crop
 *   npx tsx scripts/model-from-image.ts <key> candidates [--n 2] [--confirm]   words-only keys (like-*): portrait candidates
 *   npx tsx scripts/model-from-image.ts <key> crop <n> <left> <top> <size>   free: square crop of candidate n (candidate_<n>c)
 *   npx tsx scripts/model-from-image.ts <key> choose <n>                 words-only keys: candidate n becomes her portrait
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
  BUILDER_OPTIONS, BuilderSpec, builderHair, builderLook, builderPortraitPrompt, builderReferencePrompt, extractImages, GEMINI_API_REVISION, GEMINI_ENDPOINT, GEMINI_PRO_PROFILE,
  loadLocalSecrets, MODEL_NAME_RULE, realPortraitPrompt, REFERENCE_ASPECT, REFERENCE_KINDS, type ReferenceKind,
} from "@ow-studio/core";
import { headless, nextModelId } from "../lib/server/builder";
import { DATA_DIR } from "../lib/server/db";
import { assets, insertModelVersion, listModels } from "../lib/server/repo";

/**
 * The two models from the owner's photographs (2026-11-15). The spec feeds the builder's reference prompts and the look
 * production prompts read; `hair` replaces the builder's hair wording and `eyes` its eye colour where her own is more exact.
 */
type Entry = { spec: BuilderSpec; hair?: string; lookHair?: string; eyes?: string; faceCrop?: [number, number, number]; like?: string };
const S = (o: Omit<BuilderSpec, "freckles"> & { freckles?: boolean }) => BuilderSpec.parse(o);
const MODELS: Record<string, Entry> = {
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
  /**
   * New models from words only, each of the same type as one of the six library models (owner, 2026-11-15: "new models
   * that resemble the others, so they are not exactly them"): the library's portraits could not be refreshed without the
   * generator copying them. No image goes in; the builder's portrait prompt with the realism finish makes a new face.
   */
  "like-sable": { like: "Sable", spec: S({ heritage: "mixed", skin: "olive", hairColour: "dark-brown", hairTexture: "straight", hairLength: "long", hairStyle: "low-bun", eyes: "dark-brown", ageYears: 21, heightCm: 178, euSize: 36 }) },
  "like-lucia": { like: "Lucía", spec: S({ heritage: "latina", skin: "golden", freckles: true, hairColour: "dark-brown", hairTexture: "curly", hairLength: "long", hairStyle: "down", eyes: "hazel", ageYears: 20, heightCm: 176, euSize: 36 }) },
  "like-liv": { like: "Liv", spec: S({ heritage: "northern-european", skin: "fair", freckles: true, hairColour: "platinum", hairTexture: "straight", hairLength: "long", hairStyle: "low-bun", eyes: "blue", ageYears: 20, heightCm: 178, euSize: 34 }) },
  "like-nadia": { like: "Nadia", spec: S({ heritage: "east-asian", skin: "light-olive", freckles: true, hairColour: "black", hairTexture: "straight", hairLength: "long", hairStyle: "tucked", eyes: "dark-brown", ageYears: 21, heightCm: 176, euSize: 36 }) },
  "like-noa": { like: "Noa", spec: S({ heritage: "southern-european", skin: "light", freckles: true, hairColour: "chestnut", hairTexture: "straight", hairLength: "bob", hairStyle: "down", eyes: "hazel", ageYears: 20, heightCm: 176, euSize: 34 }) },
  "like-kaia": { like: "Kaia", spec: S({ heritage: "black", skin: "medium-brown", hairColour: "black", hairTexture: "coily", hairLength: "shoulder", hairStyle: "high-bun", eyes: "dark-brown", ageYears: 21, heightCm: 180, euSize: 36 }) },
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

/** The new identity portrait: the same woman, the brand's look, photographed for real. */
function portraitPrompt(): string {
  return realPortraitPrompt({
    sources: "the first is a full-length photograph of her, the second a crop of her face from it",
    description: `${cap(opt("heritage", m.spec.heritage))}; ${m.eyes ?? opt("eyes", m.spec.eyes)}; ${opt("skin", m.spec.skin)} skin${m.spec.freckles ? " with light natural freckles" : ""}.`,
    sourceFlaw: "they are over-smoothed and flatly lit",
    ageYears: m.spec.ageYears,
    hair: m.hair ?? builderHair(m.spec),
  });
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
  if (stage === "candidates") {
    // Words only: n candidates from the builder's portrait prompt (one prompt, the generator varies the face).
    if (m.faceCrop) throw new Error(`${key} is made from a photograph: use init and portrait`);
    const n = process.argv.includes("--n") ? Number(process.argv[process.argv.indexOf("--n") + 1]) : 2;
    const prompt = own(builderPortraitPrompt(m.spec));
    console.log(`${n} images (portrait candidates, ${key}, like ${m.like}), 1:1 2K, no image attached, est. $${(n * COST).toFixed(2)}`);
    if (!confirm) return console.log("\nDry run. Add --confirm.\n\n" + prompt);
    for (let i = 0; i < n; i++) {
      const k = `candidate_${Object.keys(state).filter((x) => x.startsWith("candidate_")).length + 1}`;
      state[k] = await generate(prompt, [], "1:1");
      save();
      console.log(k, "->", state[k]);
    }
  } else if (stage === "crop") {
    // Free: a square crop of a candidate that shows something at an edge (a window, a softbox), resized back to 2048.
    const [n, left, top, size] = process.argv.slice(4, 8).map(Number) as [number, number, number, number];
    const src = state[`candidate_${n}`];
    if (!src || !size) throw new Error("crop <n> <left> <top> <size>");
    const { bytes } = await assets.resolve(src);
    const out = await sharp(bytes).extract({ left, top, width: size, height: size }).resize(2048, 2048, { kernel: "lanczos3" }).jpeg({ quality: 94 }).toBuffer();
    state[`candidate_${n}c`] = await assets.putBytes(new Uint8Array(out));
    save();
    console.log(`candidate_${n}c ->`, state[`candidate_${n}c`]);
  } else if (stage === "choose") {
    const k = `candidate_${arg}`;
    if (!state[k]) throw new Error(`no ${k}`);
    if (state.portrait && state.portrait !== state[k]) throw new Error("a portrait is already chosen and its references may exist");
    state.portrait = state[k]!;
    save();
    console.log(`${key}: portrait = ${k} (${state.portrait})`);
  } else if (stage === "init") {
    if (!arg || !existsSync(arg)) throw new Error("give the photograph's path");
    if (!m.faceCrop) throw new Error(`${key} is made from words: use candidates and choose`);
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
