import { describe, expect, it } from "vitest";
import { measureBottomsSilhouetteRaw, silhouetteText } from "../src/silhouette.js";

/** Synthetic trousers: waistband/hip block, then two legs with a given taper. */
function trousers(hemInset: number, W = 300, H = 400) {
  const rgb = new Uint8Array(W * H * 3).fill(241);
  const put = (x: number, y: number) => rgb.set([30, 32, 30], 3 * (y * W + x));
  for (let y = 20; y < 120; y++) for (let x = 90; x < 210; x++) put(x, y); // hips 120 wide
  for (let y = 120; y < 380; y++) {
    const t = (y - 120) / 260, inset = Math.round(t * hemInset);
    for (let x = 90 + inset; x < 146; x++) put(x, y); // left leg, outer edge moves in
    for (let x = 154; x < 210 - inset; x++) put(x, y); // right leg
  }
  return rgb;
}

describe("bottoms silhouette", () => {
  it("measures straight legs as no taper", () => {
    expect(measureBottomsSilhouetteRaw(trousers(0), 300, 400)).toEqual({ kind: "bottoms", hemToThigh: 1, hemSpanToHip: 1 });
  });
  it("measures a tapered leg", () => {
    const s = measureBottomsSilhouetteRaw(trousers(20), 300, 400)!;
    expect(s.hemToThigh).toBeLessThan(0.75);
    expect(s.hemSpanToHip).toBeLessThan(0.75);
  });
  it("returns null when there are no two legs", () => {
    const rgb = new Uint8Array(300 * 400 * 3).fill(241);
    for (let y = 50; y < 350; y++) for (let x = 100; x < 200; x++) rgb.set([0, 0, 0], 3 * (y * 300 + x));
    expect(measureBottomsSilhouetteRaw(rgb, 300, 400)).toBeNull();
  });
  it("produces stable prompt text", () => {
    expect(silhouetteText({ kind: "bottoms", hemToThigh: 0.83, hemSpanToHip: 0.84 })).toMatch(/narrows only slightly.*83%.*84%/);
  });
});
