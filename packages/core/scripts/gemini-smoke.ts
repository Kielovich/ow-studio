/**
 * ONE paid Gemini call to verify auth, request shape and response parsing against the real API.
 * It generates a first identity-portrait candidate for model M01 "Sable" (no references, so no garment rights needed).
 *
 *   npm run smoke -w @ow-studio/core -- --confirm [--model gemini-nano-banana-2.1]
 *
 * Without --confirm it prints the request and the estimated cost and exits without calling the API.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { GEMINI_ENDPOINT, GEMINI_API_REVISION, GEMINI_NB21_PROFILE, GEMINI_PRO_PROFILE, extractImages, imageDimensions } from "../src/index";
import { loadLocalSecrets } from "../src/secrets";

loadLocalSecrets();

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const modelArg = args[args.indexOf("--model") + 1];
// Nano Banana Pro is the default model for this project.
const profile = modelArg === GEMINI_NB21_PROFILE.id ? GEMINI_NB21_PROFILE : GEMINI_PRO_PROFILE;

const prompt = [
  "Professional fashion casting portrait of an original fictional adult woman, 24 years old. She is not a real or identifiable person and must not resemble one.",
  "Long straight dark-brown hair tucked behind the ears, olive skin, straight brows, narrow jaw, defined cheekbones, dark-brown eyes.",
  "Straight-on front view, head and shoulders, camera at eye level, about 85 mm equivalent. Plain fitted black tank top.",
  "Neutral, relaxed expression, lips closed, calm direct gaze into the camera.",
  "Background: seamless flat neutral grey, RGB 241,241,241, no gradient. Soft, high frontal key light, low contrast.",
  "Real skin texture, pores and small asymmetries kept; no smoothing, no makeup beyond a natural base.",
].join("\n\n");

const body = { model: profile.id, input: [{ type: "text", text: prompt }], response_format: { type: "image", aspect_ratio: "1:1", image_size: "2K" } };

console.log(`model: ${profile.id}\nestimated cost: ~$${profile.estimatedCostUsd.toFixed(2)} (one image)\n`);
if (!confirm) {
  console.log(JSON.stringify(body, null, 2));
  console.log("\nDry run. Add --confirm to make the paid call.");
  process.exit(0);
}

const started = Date.now();
const res = await fetch(GEMINI_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "injected-by-proxy", "api-revision": GEMINI_API_REVISION },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(180_000),
});
const text = await res.text();
console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await mkdir("out", { recursive: true });
let json: any = null;
try { json = JSON.parse(text); } catch { /* not JSON */ }
// Keep the raw response (without image data) so the real shape and usage fields can be checked.
await writeFile("out/smoke-response.json", JSON.stringify(json ?? text, (k, v) => ((k === "data" || k === "signature") && typeof v === "string" && v.length > 200 ? `<${v.length} base64 chars>` : v), 2));
if (!res.ok) { console.log(text.slice(0, 800)); process.exit(1); }
const imgs = extractImages(json);
console.log(`images: ${imgs.length}`);
for (const [i, img] of imgs.entries()) {
  const bytes = new Uint8Array(Buffer.from(img.data, "base64"));
  const dim = imageDimensions(bytes);
  const file = `out/smoke-${profile.id}-${i + 1}.${dim?.mime === "image/jpeg" ? "jpg" : "png"}`;
  await writeFile(file, bytes);
  console.log(`  ${file} ${dim?.width}x${dim?.height} ${img.mime ?? dim?.mime}`);
}
console.log(`usage: ${JSON.stringify(json?.usage ?? "not present")}`);
console.log("raw response shape saved to out/smoke-response.json");
