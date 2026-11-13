import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropFabric } from "../src/silhouette";

/** Trousers-like packshot: two dark legs with a 3 px background gap that starts below a solid hip block. */
async function legs() {
  const W = 1100, H = 1100;
  const raw = Buffer.alloc(W * H * 3, 241);
  const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) raw.fill(v, 3 * (y * W + x), 3 * (y * W + x) + 3);
  };
  fill(400, 100, 700, 1000, 20); // hips and legs
  fill(549, 330, 552, 1000, 241); // narrow gap between the legs
  return { png: new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()), raw, W };
}

describe("fabric crop", () => {
  it("never includes background, not even a 3 px gap between the legs", async () => {
    const { png, raw, W } = await legs();
    const c = (await cropFabric(png))!;
    expect(c).not.toBeNull();
    for (let y = c.box.top; y < c.box.top + c.box.size; y++) for (let x = c.box.left; x < c.box.left + c.box.size; x++) {
      expect(raw[3 * (y * W + x)]).toBe(20);
    }
    expect(c.box.size).toBeGreaterThanOrEqual(150);
  });

  it("is deterministic and refuses garments with no area large enough", async () => {
    const { png } = await legs();
    expect(Buffer.from((await cropFabric(png))!.bytes).equals(Buffer.from((await cropFabric(png))!.bytes))).toBe(true);
    const strap = Buffer.alloc(600 * 600 * 3, 241);
    for (let y = 50; y < 550; y++) strap.fill(20, 3 * (y * 600 + 300), 3 * (y * 600 + 330));
    expect(await cropFabric(new Uint8Array(await sharp(strap, { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer()))).toBeNull();
  });
});
