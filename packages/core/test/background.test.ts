import { describe, expect, it } from "vitest";
import { normalizeBackgroundRaw } from "../src/post/background.js";

/** Synthetic studio shot: grey gradient background with a cast, dark subject touching the bottom,
 * an arm loop enclosing a background pocket, a contact shadow and a soft edge. */
function synth(W = 240, H = 240) {
  const rgb = new Uint8Array(W * H * 3);
  const px = (x: number, y: number) => 3 * (y * W + x);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const base = 160 + (20 * y) / H;
    rgb.set([base + 3, base, base + 1], px(x, y));
  }
  const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.set(c, px(x, y));
  };
  fill(90, 40, 150, H, [30, 30, 36]); // torso, touching the bottom edge
  fill(60, 70, 70, 140, [30, 30, 36]); // arm, with links forming a closed loop
  fill(60, 70, 90, 80, [30, 30, 36]);
  fill(60, 130, 90, 140, [30, 30, 36]);
  // small contact shadow on the floor, 30% darker (smaller than one model cell)
  for (let y = 214; y < 218; y++) for (let x = 46; x < 56; x++) {
    const i = px(x, y);
    for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(rgb[i + c]! * 0.7);
  }
  // soft 1px edge on the torso's right side (half subject, half background)
  for (let y = 40; y < H; y++) rgb.set([100, 98, 103], px(150, y));
  return { rgb, W, H, px };
}

describe("background normalisation", () => {
  const { rgb, W, H, px } = synth();
  const { out, report } = normalizeBackgroundRaw(rgb, W, H, { enclosedMinFraction: 0.001 });
  const at = (x: number, y: number) => Array.from(out.slice(px(x, y), px(x, y) + 3));

  it("sets open background to the exact target and removes the gradient and cast", () => {
    expect(report.ok).toBe(true);
    for (const c of report.cornerMeansAfter) for (const v of c) expect(Math.abs(v - 241)).toBeLessThanOrEqual(2);
    for (const v of at(200, 20)) expect(Math.abs(v - 241)).toBeLessThanOrEqual(2);
    for (const v of at(200, 190)) expect(Math.abs(v - 241)).toBeLessThanOrEqual(2);
  });

  it("leaves the subject untouched", () => {
    expect(at(120, 120)).toEqual([30, 30, 36]);
    expect(at(65, 100)).toEqual([30, 30, 36]);
  });

  it("normalises an enclosed pocket between arm and torso", () => {
    expect(report.enclosedPockets).toBe(1);
    for (const v of at(80, 105)) expect(Math.abs(v - 241)).toBeLessThanOrEqual(3);
  });

  it("keeps the contact shadow at its relative depth", () => {
    const s = at(50, 215);
    for (const v of s) {
      expect(v).toBeGreaterThan(150);
      expect(v).toBeLessThan(200);
    }
  });

  it("lightens a soft edge pixel without creating a dark halo", () => {
    const e = at(150, 120);
    expect(e[0]!).toBeGreaterThan(110);
    expect(e[0]!).toBeLessThan(241);
  });

  it("is deterministic", () => {
    const again = normalizeBackgroundRaw(rgb, W, H, { enclosedMinFraction: 0.001 });
    expect(Buffer.from(again.out).equals(Buffer.from(out))).toBe(true);
  });

  it("refuses images without a neutral border instead of guessing", () => {
    const red = new Uint8Array(64 * 64 * 3).fill(0);
    for (let i = 0; i < red.length; i += 3) red[i] = 200;
    expect(normalizeBackgroundRaw(red, 64, 64).report).toMatchObject({ ok: false });
  });
});
