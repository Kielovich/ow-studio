import sharp from "sharp";
import { GEMINI_PRO_PROFILE, GeminiProvider } from "@ow-studio/core";
import { assets } from "./repo";

/**
 * The real Gemini adapter with fetch replaced by a local simulation: no network, no cost. Each call answers with a
 * synthetic 2048 px studio image (a dark garment shape on grey), or, scripted, with a lost response ("unknown outcome").
 * Used by tests and end-to-end runs (worker with OW_PROVIDER=simulated). Never used unless asked for explicitly.
 */
export function simulatedProvider(script: ("ok" | "lost")[] = ["ok"]) {
  let n = 0;
  const fetch = async (_url: string, _init: unknown) => {
    const step = script[Math.min(n++, script.length - 1)];
    if (step === "lost") throw new Error("socket hang up"); // sent, never answered: may have been billed
    const shade = 20 + ((n * 10) % 60);
    const out = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: { r: 241, g: 241, b: 241 } } })
      .composite([{ input: { create: { width: Math.round(2048 / 3), height: Math.round(2048 * 0.7), channels: 3, background: { r: shade, g: shade, b: shade } } }, top: Math.round(2048 * 0.15), left: Math.round(2048 / 3) }])
      .png().toBuffer();
    return { ok: true, status: 200, text: async () => JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: out.toString("base64") }] }] }) };
  };
  return new GeminiProvider(GEMINI_PRO_PROFILE, { resolveAsset: (h: string) => assets.resolve(h), fetch: fetch as any, apiKey: "simulated" });
}
