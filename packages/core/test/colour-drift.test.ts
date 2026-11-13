import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { colourDistance, measureColourDrift } from "../src/silhouette";

/** On-model stand-in: grey background, skin-toned face and arms, a garment block, black styling below it. */
async function scene(garment: [number, number, number]) {
  const W = 600, H = 600, raw = Buffer.alloc(W * H * 3, 241);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) raw.set(c, 3 * (y * W + x)); };
  fill(260, 40, 340, 120, [214, 170, 140]); // face
  fill(220, 130, 380, 360, garment);         // garment
  fill(180, 140, 215, 340, [214, 170, 140]); // arms
  fill(385, 140, 420, 340, [214, 170, 140]);
  fill(230, 360, 370, 560, [20, 20, 22]);    // black trousers (styling)
  return new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
}

describe("colour drift check", () => {
  it("passes when the garment colour is present, despite black styling and skin", async () => {
    const r = (await measureColourDrift(await scene([150, 30, 40]), "#962828"))!;
    expect(r.drift).toBe(false);
    expect(r.distance).toBeLessThan(6);
  });

  it("tolerates a studio exposure difference (lighter render of the same colour)", async () => {
    expect((await measureColourDrift(await scene([170, 45, 55]), "#962828"))!.drift).toBe(false);
  });

  it("flags a clear hue drift (red garment rendered blue)", async () => {
    const r = (await measureColourDrift(await scene([40, 40, 150]), "#962828"))!;
    expect(r.drift).toBe(true);
    expect(r.distance).toBeGreaterThan(30);
  });

  it("weights lightness at half: same hue darker is closer than a hue change", () => {
    expect(colourDistance("#962828", "#641a1a")).toBeLessThan(colourDistance("#962828", "#286496"));
  });
});
