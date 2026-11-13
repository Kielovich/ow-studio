/**
 * Phase 3 garment-fidelity test on Nano Banana Pro.
 *   npx tsx scripts/phase3.ts            dry run: compile and show plan + cost, no API calls
 *   npx tsx scripts/phase3.ts --confirm  run (hard budget cap, default $3)
 *
 * Inputs: packshots in <repo>/.assets-inbox, identity portrait from the smoke test.
 * Outputs stay local in out/phase3 (never committed). Already generated body references are reused, not re-paid.
 */
import { existsSync } from "node:fs";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileProduction, DEFAULT_POLICY, extractImages, GEMINI_API_REVISION, GEMINI_ENDPOINT, GEMINI_PRO_PROFILE, GeminiProvider,
  InMemoryJobStore, LocalAssetStore, measureBottomsSilhouette, newJob, runJob, type ProductionSpecInput,
} from "../src/index.js";
import { MODEL_SABLE } from "../src/fixtures.js";
import { loadLocalSecrets } from "../src/secrets.js";

loadLocalSecrets();
const confirm = process.argv.includes("--confirm");
const budgetArg = process.argv.indexOf("--budget");
const BUDGET = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) : 3;
const presetArg = process.argv.indexOf("--preset");
const PRESET = presetArg > 0 ? process.argv[presetArg + 1] : undefined;
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > 0 ? process.argv[onlyArg + 1] : undefined;
const REPO = join(process.cwd(), "..", "..");
const INBOX = join(REPO, ".assets-inbox");
const OUT = "out/phase3";
const store = new LocalAssetStore(join(REPO, ".assets"));
const profile = GEMINI_PRO_PROFILE;
let spent = 0;

async function rawGenerate(prompt: string, imageHashes: string[]): Promise<{ bytes: Uint8Array; usage: unknown }> {
  const images = await Promise.all(imageHashes.map(store.resolve));
  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "injected-by-proxy", "api-revision": GEMINI_API_REVISION },
    body: JSON.stringify({
      model: profile.id,
      input: [{ type: "text", text: prompt }, ...images.map((i) => ({ type: "image", mime_type: i.mime, data: Buffer.from(i.bytes).toString("base64") }))],
      response_format: { type: "image", aspect_ratio: "2:3", image_size: "2K" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  spent += profile.estimatedCostUsd;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const img = extractImages(json)[0];
  if (!img) throw new Error(`no image: ${text.slice(0, 300)}`);
  return { bytes: new Uint8Array(Buffer.from(img.data, "base64")), usage: json.usage };
}

/** Polished editorial e-commerce look, based on the OW observations: groomed, sculpted, neutral lip, not glam. */
const OW_MAKEUP =
  "polished editorial fashion makeup: even, luminous skin that still shows natural texture and pores; softly sculpted cheekbones and jawline; " +
  "groomed, defined brows; subtle smudged brown liner and lengthening mascara; neutral nude-rose matte lip. Fashion-model polish, not glam, not bare-faced.";

const BODY_PROMPT = (view: "front" | "back") => [
  "Full-body reference photograph of the same original fictional adult woman shown in the attached identity portrait (same face, hair and skin tone). She is not a real or identifiable person.",
  "178 cm tall, slim fashion-model build, EU size 36. Wearing a plain fitted black tank top and plain black leggings, barefoot.",
  view === "front"
    ? "Standing straight-on facing the camera, weight even, arms relaxed at the sides, neutral expression, gaze into the camera."
    : "Standing with the back to the camera, weight even, arms relaxed at the sides, head straight forward, face not visible.",
  "Head to toe in frame with margin above the head and below the feet. Camera at waist height, normal lens look, no distortion.",
  "Plain light grey seamless studio background, soft even frontal light, soft contact shadow under the feet. Real skin texture.",
].join("\n\n");

async function main() {
  await mkdir(OUT, { recursive: true });
  const put = (name: string) => store.put(join(INBOX, `${name}.png`));
  const pack = {
    trousersF: await put("trousers_front"), trousersB: await put("trousers_back"),
    furF: await put("furjacket_front"), furB: await put("furjacket_back"),
    meshF: await put("meshdress_front"), meshB: await put("meshdress_back"),
  };
  const barePortrait = await store.put("out/smoke-gemini-3-pro-image-1.jpg");
  // Model version 2: the same identity with the production's fashion makeup baked into the reference.
  // Text alone barely moved the face because the model copies the reference look closely (phase 3 finding).
  const styledFile = join(OUT, "portrait-styled-v2.jpg");
  if (!existsSync(styledFile) && confirm) {
    const r = await rawGenerate(
      "Identity portrait of exactly the same original fictional adult woman as in the attached reference: identical bone structure, facial features, " +
      "eye shape, skin tone and hair. She is not a real or identifiable person. Change only the makeup and grooming to: " + OW_MAKEUP +
      " Hair sleek, centre parted, tucked behind the ears. Straight-on head and shoulders, plain fitted black tank top, neutral relaxed expression, " +
      "lips closed, direct gaze. Plain light grey seamless background, soft high frontal light. Real skin texture.",
      [barePortrait],
    );
    await writeFile(styledFile, r.bytes);
    console.log("  styled portrait v2 generated");
  }
  const portrait = existsSync(styledFile) ? await store.put(styledFile) : barePortrait;
  const trousersSilhouette = await measureBottomsSilhouette((await store.resolve(pack.trousersF)).bytes);
  console.log(`trousers silhouette: ${JSON.stringify(trousersSilhouette)}`);

  // Body references (paid once, cached).
  const refsFile = join(OUT, "body-refs.json");
  let bodyRefs: { front: string; back: string } | null = existsSync(refsFile) ? JSON.parse(await readFile(refsFile, "utf8")) : null;
  const plannedImages = (ONLY ? 1 : 3) * (PRESET ? 1 : 3);
  const plannedCost = (bodyRefs ? 0 : 2 * profile.estimatedCostUsd) + plannedImages * profile.estimatedCostUsd;
  console.log(`model ${profile.id} | planned: ${bodyRefs ? 0 : 2} body refs + ${plannedImages} images | est. $${plannedCost.toFixed(2)} | budget $${BUDGET}`);
  if (plannedCost > BUDGET) throw new Error("planned cost exceeds budget");

  if (!bodyRefs && confirm) {
    for (const view of ["front", "back"] as const) {
      const r = await rawGenerate(BODY_PROMPT(view), [barePortrait]);
      await writeFile(join(OUT, `ref-body-${view}.jpg`), r.bytes);
      bodyRefs = { ...(bodyRefs ?? { front: "", back: "" }), [view]: await store.putBytes(r.bytes) };
      console.log(`  body ${view} ref done (${JSON.stringify((r.usage as any)?.output_tokens_by_modality)})`);
    }
    await writeFile(refsFile, JSON.stringify(bodyRefs));
  }
  // Body references carry the body only: the head is masked out so the bare-faced reference cannot pull the
  // face or makeup away from the identity portrait (phase 3 finding).
  const headless = async (hash: string) => {
    const { bytes } = await store.resolve(hash);
    const meta = await sharp(bytes).metadata();
    const w = meta.width!, h = Math.round(meta.height! * 0.19);
    const out = await sharp(bytes).composite([{ input: { create: { width: w, height: h, channels: 3, background: { r: 241, g: 241, b: 241 } } }, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
    return store.putBytes(new Uint8Array(out));
  };
  const body = bodyRefs ? { front: await headless(bodyRefs.front), back: await headless(bodyRefs.back) } : { front: portrait, back: portrait };

  const spec: ProductionSpecInput = {
    productionId: "phase3_ow_test_01",
    model: {
      ...MODEL_SABLE,
      version: existsSync(styledFile) ? 2 : 1,
      refs: { primaryPortrait: portrait, identityAngles: [], fullBodyFront: body.front, fullBodyBack: body.back, characterSheet: portrait, facialDetailSheet: portrait },
    },
    products: [
      { sku: "T3-TROUSERS", name: "Straight-leg five-pocket trousers", category: "trousers", color: "very dark olive-black",
        description: "Mid-rise five-pocket trousers with a relaxed straight leg that keeps the same width from knee to hem and falls loosely over the shoe. Dark coated cotton-like fabric with a low, soft sheen (not leather-like). Light grey contrast topstitching clearly visible along the side seams, pockets, waistband and hem. Belt loops, single button and zip fly, two back patch pockets outlined in contrast stitching.",
        flags: ["has_pockets", "front_closure", "coated"], ...(trousersSilhouette ? { silhouette: trousersSilhouette } : {}), packshots: { front: pack.trousersF, back: pack.trousersB } },
      { sku: "T3-FURJACKET", name: "Cropped faux fur jacket", category: "jacket", color: "black",
        description: "Cropped boxy faux fur jacket with an oversized shawl collar, curved open front with a single hidden closure, horizontal panel seams across body and sleeves, long wide sleeves.",
        flags: ["fur", "long_sleeve", "front_closure"], packshots: { front: pack.furF, back: pack.furB } },
      { sku: "T3-MESHDRESS", name: "Mesh panel mini dress", category: "dress", color: "black",
        description: "Fitted long-sleeve crew-neck mini dress in opaque black jersey with curved sheer black mesh panels across the bodice, waist, sleeves and hem, and an asymmetric diagonal hem.",
        flags: ["sheer", "long_sleeve", "asymmetric_hem"], packshots: { front: pack.meshF, back: pack.meshB } },
    ],
    slots: [{ preset: "front_crop" }, { preset: "back" }, { preset: "full_body" }],
    styling: { hairState: "sleek, tucked behind the ears", makeup: OW_MAKEUP, top: "a plain fitted black long-sleeve crew-neck top that ends at the waist so the whole waistband, button and belt loops stay visible", innerTop: "a plain fitted black crew-neck top", bottoms: "straight black tailored trousers", footwear: "black pointed-toe ankle boots", accessories: [] },
    style: { background: [241, 241, 241], aspectRatio: "1:1", longEdgePx: 2000 },
    providerProfileId: profile.id,
  };

  const compiled = compileProduction(spec, profile);
  for (const c of compiled.conflicts) console.log(`  [${c.severity}] ${c.code} ${c.sku ?? ""} ${c.message}`);
  if (!compiled.canRun) throw new Error("conflicts block the run");
  for (const i of compiled.images) console.log(`  ${i.sku.padEnd(13)} ${i.preset.padEnd(11)} ${i.assignment.poseId.padEnd(18)} refs=${i.refs.map((r) => r.role).join(",")}`);
  if (!confirm) { console.log("\nDry run. Add --confirm to generate."); return; }

  const adapter = new GeminiProvider(profile, { resolveAsset: store.resolve });
  const jobs = new InMemoryJobStore();
  const manifest: unknown[] = [];
  for (const req of compiled.images.filter((r) => (!ONLY || r.sku === ONLY) && (!PRESET || r.preset === PRESET))) {
    await jobs.save(newJob(req.imageSpecId, req));
    const job = await runJob(req.imageSpecId, { store: jobs, adapter, request: req, policy: { ...DEFAULT_POLICY, budgetRemainingUsd: BUDGET - spent }, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    spent += job.costUsd;
    let file: string | null = null;
    if (job.providerJobId && (job.state === "succeeded" || job.state === "needs_review")) {
      const st = await adapter.poll(job.providerJobId);
      if (st.state === "succeeded") { file = join(OUT, `${req.sku}_${req.preset}.jpg`); await writeFile(file, st.assets[0]!.bytes); }
    }
    console.log(`  ${req.sku.padEnd(13)} ${req.preset.padEnd(11)} ${job.state}${job.lastError ? " " + job.lastError.message.slice(0, 120) : ""} ${file ?? ""}`);
    manifest.push({ imageSpecId: req.imageSpecId, sku: req.sku, preset: req.preset, compileHash: req.compileHash, refs: req.refs, state: job.state, validation: job.validation, file, events: job.events, prompt: req.prompt });
  }
  await writeFile(join(OUT, "manifest.json"), JSON.stringify({ specHash: compiled.specHash, profile: profile.id, estSpentUsd: spent, images: manifest }, null, 2));
  console.log(`\nestimated spend this run: $${spent.toFixed(2)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
