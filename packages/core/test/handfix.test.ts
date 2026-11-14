import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compositeFix, cropForFix, HAND_FIX_PROMPT, handBox } from "../src/post/handfix";

const W = 400, H = 400;
/** Grey studio frame with a dark garment block and a warm "hand" patch. */
async function base() {
  const raw = Buffer.alloc(W * H * 3, 241);
  for (let y = 100; y < 380; y++) for (let x = 150; x < 250; x++) raw.set([30, 30, 34], 3 * (y * W + x));
  for (let y = 230; y < 270; y++) for (let x = 250; x < 280; x++) raw.set([200, 160, 135], 3 * (y * W + x));
  return new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
}
const pixels = async (b: Uint8Array) => new Uint8Array(await sharp(b).removeAlpha().raw().toBuffer());

describe("hand fix composite", () => {
  it("places a square around the click and keeps it inside the image", () => {
    expect(handBox(2048, 2048, 0.5, 0.5)).toEqual({ left: 778, top: 778, size: 492 });
    expect(handBox(2048, 2048, 0.99, 0.01)).toEqual({ left: 2048 - 492, top: 0, size: 492 });
  });

  it("changes nothing outside the box, applies the edit inside, without a seam at the edge", async () => {
    const img = await base();
    const box = handBox(W, H, 265 / W, 250 / H, 0.25); // 100 px square around the hand
    const crop = await cropForFix(img, box);
    expect((await sharp(crop).metadata()).width).toBe(box.size);
    // The "edit": the crop with the hand painted pale, at a different size (as a provider returns 2K).
    const editRaw = Buffer.from(await pixels(crop));
    for (let i = 0; i < editRaw.length; i += 3) if (editRaw[i]! > 150 && editRaw[i]! < 230) editRaw.set([230, 200, 185], i);
    const edited = new Uint8Array(await sharp(editRaw, { raw: { width: box.size, height: box.size, channels: 3 } }).resize(512, 512).png().toBuffer());

    const out = await pixels(await compositeFix(img, box, edited));
    const before = await pixels(img);
    let changedOutside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inside = x >= box.left && x < box.left + box.size && y >= box.top && y < box.top + box.size;
      const k = 3 * (y * W + x);
      if (!inside && (out[k] !== before[k] || out[k + 1] !== before[k + 1] || out[k + 2] !== before[k + 2])) changedOutside++;
    }
    expect(changedOutside).toBe(0);
    // Centre of the hand now carries the edit.
    const c = 3 * (250 * W + 265);
    expect(Math.abs(out[c]! - 230)).toBeLessThanOrEqual(8);
    // At the box edge the result equals the original (feathered to zero).
    const e = 3 * (box.top * W + box.left + 5);
    expect(out[e]).toBe(before[e]);
  });

  it("asks for a change of pose and describes the target, not the current gesture", () => {
    expect(HAND_FIX_PROMPT).toMatch(/Change its pose\./);
    expect(HAND_FIX_PROMPT).toMatch(/wrist and the sleeve stay exactly where they are/);
    expect(HAND_FIX_PROMPT).not.toMatch(/middle finger/);
  });
});
