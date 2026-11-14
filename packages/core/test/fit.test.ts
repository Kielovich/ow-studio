import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropFitReference, FIT_HEAD_SHARE } from "../src/post/fit";

describe("fit reference crop", () => {
  it("removes the top of the image, where a standing figure's head is", async () => {
    // Red band at the top (the "head"), grey below.
    const raw = Buffer.alloc(400 * 1000 * 3, 120);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) raw.set([220, 30, 30], 3 * (y * 400 + x));
    const input = new Uint8Array(await sharp(raw, { raw: { width: 400, height: 1000, channels: 3 } }).png().toBuffer());
    const out = await cropFitReference(input);
    const m = await sharp(out).metadata();
    expect(m.format).toBe("jpeg");
    expect(m.width).toBe(400);
    expect(m.height).toBe(Math.round(1000 * (1 - FIT_HEAD_SHARE)));
    const px = await sharp(out).raw().toBuffer();
    let red = 0;
    for (let i = 0; i < px.length; i += 3) if (px[i]! > 180 && px[i + 1]! < 80) red++;
    expect(red).toBe(0);
  });

  it("never sends more than 1600 px on the long edge", async () => {
    const big = new Uint8Array(await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 200, g: 200, b: 200 } } }).jpeg().toBuffer());
    const m = await sharp(await cropFitReference(big)).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(1600);
  });
});
