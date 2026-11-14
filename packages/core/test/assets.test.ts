import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LocalAssetStore } from "../src/assets";

const image = async () => new Uint8Array(await sharp({ create: { width: 1000, height: 1000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer());

describe("local asset store", () => {
  it("never lets a reader see a half-written file when the same asset is stored concurrently", async () => {
    const root = mkdtempSync(join(tmpdir(), "ow-assets-"));
    const store = new LocalAssetStore(root);
    const bytes = await image();
    const id = await store.putBytes(bytes);
    // Two workers storing the same content-addressed file (a shared crop or anchor) while a third reads it.
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i++) ops.push(store.putBytes(bytes), store.resolve(id));
    const results = await Promise.allSettled(ops);
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("repairs a damaged file when the same content is stored again", async () => {
    const root = mkdtempSync(join(tmpdir(), "ow-assets-"));
    const store = new LocalAssetStore(root);
    const bytes = await image();
    const id = await store.putBytes(bytes);
    const file = join(root, readdirSync(root)[0]!);
    writeFileSync(file, bytes.slice(0, 1000)); // a write cut off by a crash
    await expect(store.resolve(id)).rejects.toThrow(/corrupted/);
    expect(await store.putBytes(bytes)).toBe(id);
    expect((await store.resolve(id)).bytes).toEqual(bytes);
  });
});
