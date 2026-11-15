/**
 * Realism refresh of one model's references: a new model version with the same face, hairstyle and framing, finished
 * as a real photograph. Body references are reused from the current version. Old versions are never changed.
 *
 * Round 1 (2026-11-13, docs/realism-audit.md, lever 2): real hair edges, matte lips, less contour and glow.
 * Round 2 (2026-11-15, owner: "not realistic enough"): the model builder's finish (BUILDER_REAL in modelBuilder.ts),
 * which made Freja and Inés: real unretouched skin, light with fall-off, natural colour, focus fall-off, grain. The new
 * portrait is made from her portrait and three-quarter view scaled down to 640 px: from the sharp 2K portrait in the
 * same framing the generator only edited (near copies, still glowing; first attempt, $0.96).
 *
 *   npx tsx scripts/model-realism.ts <modelId> portrait [--confirm]   1 image: the new identity portrait
 *   npx tsx scripts/model-realism.ts <modelId> refs [--confirm] [--redo characterSheet]   three-quarter, profile, 5-panel character sheet
 *   npx tsx scripts/model-realism.ts <modelId> register               new active version (older active one archived)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { BUILDER_REAL, extractImages, GEMINI_API_REVISION, GEMINI_ENDPOINT, GEMINI_PRO_PROFILE, hairForPrompt, loadLocalSecrets, realPortraitPrompt } from "@ow-studio/core";
import { DATA_DIR } from "../lib/server/db";
import { assets, insertModelVersion, listModels, setModelStatus } from "../lib/server/repo";

loadLocalSecrets();
const [modelId, stage] = process.argv.slice(2) as [string, string];
const confirm = process.argv.includes("--confirm");
// Round 2 has its own state: round 1's references must not be reused.
const STATE = join(DATA_DIR, "model-gen", `finish-${modelId}.json`);
mkdirSync(join(DATA_DIR, "model-gen"), { recursive: true });
const state: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

const REAL = BUILDER_REAL;

/** Inputs this small make the generator photograph her anew instead of editing the sharp 2K portrait (see realPortraitPrompt). */
const SOFT_PX = 640;
async function soft(hash: string): Promise<string> {
  const { bytes } = await assets.resolve(hash);
  return assets.putBytes(new Uint8Array(await sharp(bytes).resize(SOFT_PX, SOFT_PX, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer()));
}
const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);

const portraitPrompt = (m: { ageYears: number; look: { hair: string; skinTone: string; eyes: string; features: string } }, hair: string) => realPortraitPrompt({
  sources: "a front portrait and a three-quarter view of her",
  description: `${cap(m.look.features)}; ${m.look.eyes}. Skin tone: ${m.look.skinTone}.`,
  sourceFlaw: "they are retouched, over-smoothed and glowing, like a beauty advert",
  ageYears: m.ageYears,
  hair,
});

const fromPortrait = (kind: "threeQuarter" | "profile" | "characterSheet", hair: string) => {
  const same = "exactly the same original fictional adult woman as in the attached identity portrait: identical face, bone structure, skin, hair colour, hairstyle and makeup. She is not a real or identifiable person.";
  const finish = `Hair: ${hair}; ${REAL.hair}. Makeup: ${REAL.makeup}. Skin: ${REAL.skin}.` +
    // A reference sheet wants even light (no directional modelling that differs per panel).
    (kind === "characterSheet" ? ` Camera: ${REAL.camera}.` : ` Light: ${REAL.light}. Camera: ${REAL.camera}.`);
  if (kind === "threeQuarter") return `Identity reference, three-quarter view, of ${same}\n\nHead and shoulders, head and body turned about 40 degrees to the side, eyes following the head, calm expression, lips closed. Plain fitted black tank top.\n\n${finish}`;
  if (kind === "profile") return `Identity reference, side profile, of ${same}\n\nHead and shoulders in exact side profile (90 degrees), calm expression, lips closed. Plain fitted black tank top.\n\n${finish}`;
  // Simple beats overloaded: exactly five large panels, one neutral pose, even light, no text (each extra panel steals
  // pixels from the others once the model downsizes the reference).
  return `Character reference sheet of ${same}\n\nOne wide image with exactly five large panels side by side, evenly spaced, nothing else: ` +
    `1) face close-up, front, 2) full body front, 3) full body back, 4) full body left profile, 5) full body right profile. ` +
    `The full-body panels share one scale and the same neutral standing pose: arms relaxed at the sides, legs straight, no dynamic pose; plain fitted black tank top and black leggings, barefoot. ` +
    `Identical face, hair, makeup and skin in every panel; calm expression, lips closed. Soft even studio light, plain light grey background. No text, labels, numbers, rulers or extra panels.\n\n${finish}`;
};

async function generate(prompt: string, refs: string[], aspect: "1:1" | "16:9"): Promise<string> {
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
  return assets.putBytes(new Uint8Array(Buffer.from(img.data, "base64")));
}

async function main() {
  const current = listModels().find((m) => m.modelId === modelId && m.status === "active");
  if (!current) throw new Error(`${modelId} has no active version`);
  // "no loose strands" / "crisp hairline" in older look texts contradict real hair: dropped here and in the new version.
  const hair = hairForPrompt(current.data.look.hair);
  if (stage === "portrait") {
    console.log(`1 image (portrait of ${current.data.displayName} v${current.version}), est. $${GEMINI_PRO_PROFILE.estimatedCostUsd.toFixed(2)}`);
    // --note "..." adds one correction after a rejected attempt (the rejected hash is kept).
    const note = process.argv.includes("--note") ? `\nCorrection: ${process.argv[process.argv.indexOf("--note") + 1]}` : "";
    // Her current front portrait and three-quarter view, scaled down (free; stored once).
    state.softPortrait ??= await soft(current.data.refs.primaryPortrait);
    state.softAngle ??= await soft(current.data.refs.identityAngles[0] ?? current.data.refs.primaryPortrait);
    save();
    const prompt = portraitPrompt(current.data, hair) + note;
    for (const h of [state.softPortrait, state.softAngle]) {
      const meta = await sharp((await assets.resolve(h)).bytes).metadata();
      console.log(`  attach ${h.slice(0, 19)}… ${meta.width}x${meta.height} ${meta.format}`);
    }
    if (!confirm) return console.log("Dry run. Add --confirm.\n\n" + prompt);
    if (state.portrait) state[`rejected_portrait_${Date.now()}`] = state.portrait;
    state.portrait = await generate(prompt, [state.softPortrait, state.softAngle], "1:1");
    state.portraitPrompt = prompt;
    save();
    console.log("portrait ->", state.portrait);
  } else if (stage === "refs") {
    if (!state.portrait) throw new Error("make and approve the portrait first");
    // --redo characterSheet regenerates one reference (the old hash is kept under rejected).
    const redo = process.argv.includes("--redo") ? process.argv[process.argv.indexOf("--redo") + 1]!.split(",") : [];
    for (const k of redo) if (state[k]) { state[`rejected_${k}`] = state[k]!; delete state[k]; }
    const kinds = (["threeQuarter", "profile", "characterSheet"] as const).filter((k) => !state[k]);
    console.log(`${kinds.length} images, est. $${(kinds.length * GEMINI_PRO_PROFILE.estimatedCostUsd).toFixed(2)}`);
    if (!confirm) return console.log("Dry run. Add --confirm.");
    for (const k of kinds) {
      state[k] = await generate(fromPortrait(k, hair), [state.portrait], k === "characterSheet" ? "16:9" : "1:1");
      save();
      console.log(k, "->", state[k]);
    }
  } else if (stage === "register") {
    for (const k of ["portrait", "threeQuarter", "profile", "characterSheet"]) if (!state[k]) throw new Error(`missing ${k}`);
    const version = Math.max(...listModels().filter((m) => m.modelId === modelId).map((m) => m.version)) + 1;
    insertModelVersion({ ...current.data, look: { ...current.data.look, hair }, version, refs: {
      ...current.data.refs, primaryPortrait: state.portrait!, identityAngles: [state.threeQuarter!, state.profile!],
      characterSheet: state.characterSheet!, facialDetailSheet: state.portrait!,
    } }, "active");
    setModelStatus(modelId, current.version, "archived");
    console.log(`${current.data.displayName} v${version} registered and active; v${current.version} archived (its productions keep it).`);
  } else {
    throw new Error("stage must be portrait | refs | register");
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
