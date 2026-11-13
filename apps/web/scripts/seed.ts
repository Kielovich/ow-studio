/**
 * Registers the model library from the phase 3 assets (idempotent).
 *   npm run seed -w web
 * M01 "Sable" v1: makeup-free identity. v2: same identity with the editorial makeup baked into the portrait (active).
 * Body references are stored headless so they carry body proportions only.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { MODEL_SABLE } from "@ow-studio/core/src/fixtures";
import { assets, insertModelVersion, listModels } from "../lib/server/repo";

const CORE_OUT = resolve(process.cwd(), "..", "..", "packages", "core", "out");
const need = (p: string) => { if (!existsSync(p)) throw new Error(`missing ${p}`); return p; };

async function headless(path: string) {
  const img = sharp(path);
  const m = await img.metadata();
  const h = Math.round(m.height! * 0.19);
  const out = await img.composite([{ input: { create: { width: m.width!, height: h, channels: 3, background: { r: 241, g: 241, b: 241 } } }, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
  return assets.putBytes(new Uint8Array(out));
}

async function main() {
  const existing = new Set(listModels().map((m) => `${m.modelId}@${m.version}`));
  const bare = await assets.put(need(join(CORE_OUT, "smoke-gemini-3-pro-image-1.jpg")));
  const styled = await assets.put(need(join(CORE_OUT, "phase3", "portrait-styled-v2.jpg")));
  const bodyFront = await headless(need(join(CORE_OUT, "phase3", "ref-body-front.jpg")));
  const bodyBack = await headless(need(join(CORE_OUT, "phase3", "ref-body-back.jpg")));
  const base = { ...MODEL_SABLE, displayName: "Sable" };
  const versions = [
    { v: 1, portrait: bare, status: "archived" },
    { v: 2, portrait: styled, status: "active" },
  ];
  for (const { v, portrait, status } of versions) {
    if (existing.has(`M01@${v}`)) { console.log(`M01 v${v} exists, skipped`); continue; }
    insertModelVersion({
      ...base, version: v,
      refs: { primaryPortrait: portrait, identityAngles: [], fullBodyFront: bodyFront, fullBodyBack: bodyBack, characterSheet: portrait, facialDetailSheet: portrait },
    }, status);
    console.log(`M01 v${v} registered (${status})`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
