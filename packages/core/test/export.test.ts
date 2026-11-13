import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exportDelivery } from "../src/post/export";

const img = async (w: number, h: number) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer());

describe("delivery export", () => {
  it("gives exactly 2000 x 2000 sRGB JPEG from the 2048 px provider output", async () => {
    const r = await exportDelivery(await img(2048, 2048));
    const m = await sharp(Buffer.from(r.bytes)).metadata();
    expect([m.format, m.width, m.height, m.space, m.chromaSubsampling]).toEqual(["jpeg", 2000, 2000, "srgb", "4:4:4"]);
    expect(m.icc).toBeTruthy();
    expect(r.upscaled).toBe(false);
  });

  it("fits a non-square image on the studio background instead of cropping, and flags upscaling", async () => {
    const r = await exportDelivery(await img(1000, 1500));
    const m = await sharp(Buffer.from(r.bytes)).metadata();
    expect([m.width, m.height]).toEqual([2000, 2000]);
    expect(r.upscaled).toBe(true);
    const { data } = await sharp(Buffer.from(r.bytes)).extract({ left: 5, top: 1000, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0]! - 241)).toBeLessThanOrEqual(2);
  });

  it("is deterministic", async () => {
    const a = await exportDelivery(await img(2048, 2048)), b = await exportDelivery(await img(2048, 2048));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});
