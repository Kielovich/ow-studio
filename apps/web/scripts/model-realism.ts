/**
 * Realism refresh of one model's references (docs/realism-audit.md, lever 2): a new model version with the same face,
 * hairstyle and framing, but real hair edges, non-glossy lips, less contour and glow, soft directional light.
 * Body references are reused from the current version. Old versions are never changed.
 *
 *   npx tsx scripts/model-realism.ts <modelId> portrait [--confirm]   1 image: the new identity portrait
 *   npx tsx scripts/model-realism.ts <modelId> refs [--confirm] [--redo characterSheet]   three-quarter, profile, 5-panel character sheet
 *   npx tsx scripts/model-realism.ts <modelId> register               new active version (older active one archived)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractImages, GEMINI_API_REVISION, GEMINI_ENDPOINT, GEMINI_PRO_PROFILE, loadLocalSecrets } from "@ow-studio/core";
import { DATA_DIR } from "../lib/server/db";
import { assets, insertModelVersion, listModels, setModelStatus } from "../lib/server/repo";

loadLocalSecrets();
const [modelId, stage] = process.argv.slice(2) as [string, string];
const confirm = process.argv.includes("--confirm");
const STATE = join(DATA_DIR, "model-gen", `realism-${modelId}.json`);
mkdirSync(join(DATA_DIR, "model-gen"), { recursive: true });
const state: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

const REAL = {
  hair: "real hair, not a solid helmet: the same cut, but with clearly visible flyaways: ten to twenty fine stray hairs crossing the outline of the hair against the background, a few short baby hairs at the temples and along the parting, a little frizz on the surface, and individual strands separating at the ends",
  makeup: "her polished clean-glam makeup kept, but finished as on a real set: contour softly blended with no bronze stripe, defined brows and lashes, highlight only as a faint natural sheen on the cheekbones; lips in a completely matte nude with visible natural lip lines and texture: no gloss, no shine and no reflection on the lips at all",
  skin: "real skin: visible pores, slight natural unevenness and colour variation, a few tiny marks, no airbrushing, no oily or dewy shine",
  light: "one large soft key light slightly to one side of the camera with gentle fall-off across the face, plus soft fill; bright studio, light grey seamless background",
  camera: "full-frame camera, 85 mm lens at f/5.6, ISO 100: natural micro-contrast, crisp individual lashes and hairs, very subtle grain",
};

const portraitPrompt = (hair: string) => [
  "Re-photograph this exact original fictional adult woman in the same studio set-up. She is not a real or identifiable person.",
  `Keep identical: face, bone structure, eye shape and colour, nose, lip shape, skin tone, freckles, hair colour and length, the hairstyle (${hair}), the plain black tank top, ` +
  "and the framing exactly as in the attached photograph: the same distance and crop, with space above the head and the shoulders and tank top fully visible. Do not zoom in.",
  "Change only what makes the photograph look retouched or generated:",
  `- Hair: ${REAL.hair}.`,
  `- Makeup: ${REAL.makeup}.`,
  `- Skin: ${REAL.skin}.`,
  "- Face and expression: her own features, relaxed and calm, lips closed, a barely perceptible natural head tilt; real catchlights from one large softbox.",
  `- Light: ${REAL.light}.`,
  `Camera: ${REAL.camera}.`,
].join("\n");

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
  const hair = current.data.look.hair;
  if (stage === "portrait") {
    console.log(`1 image (portrait of ${current.data.displayName} v${current.version}), est. $${GEMINI_PRO_PROFILE.estimatedCostUsd.toFixed(2)}`);
    if (!confirm) return console.log("Dry run. Add --confirm.\n\n" + portraitPrompt(hair));
    state.portrait = await generate(portraitPrompt(hair), [current.data.refs.primaryPortrait], "1:1");
    state.portraitPrompt = portraitPrompt(hair);
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
    insertModelVersion({ ...current.data, version, refs: {
      ...current.data.refs, primaryPortrait: state.portrait!, identityAngles: [state.threeQuarter!, state.profile!],
      characterSheet: state.characterSheet!, facialDetailSheet: state.portrait!,
    } }, "active");
    setModelStatus(modelId, current.version, "archived");
    console.log(`${current.data.displayName} v${version} registered and active; v${current.version} archived (its productions keep it).`);
  } else {
    throw new Error("stage must be portrait | refs | register");
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
