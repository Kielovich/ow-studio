import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

// Isolated data directory; only the simulated provider (no network, no cost).
process.env.OW_DATA_DIR = mkdtempSync(join(tmpdir(), "ow-studio-lost-test-"));

let repo: typeof import("../lib/server/repo");
let db: typeof import("../lib/server/db");
let pipeline: typeof import("../lib/server/pipeline");
let jobstore: typeof import("../lib/server/jobstore");
let core: typeof import("@ow-studio/core");
let simulated: typeof import("../lib/server/simulated");

const png = async (w: number, h: number, shade: number) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 241, g: 241, b: 241 } } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h * 0.7), channels: 3, background: { r: shade, g: shade, b: shade } } }, top: Math.round(h * 0.15), left: Math.round(w / 3) }])
    .png().toBuffer());
const noSleep = async () => {};

/** A new production with one image (the close-up), returning that image's row. */
async function oneImage(): Promise<any> {
  const h = async (shade: number) => repo.assets.putBytes(await png(300, 300, shade));
  const created = await repo.createProduction({
    name: "lost result test",
    products: [{ sku: "SKU-1", name: "Dress", category: "dress", color: "black", description: "", flags: [], packshots: { front: await h(30), back: await h(31) } }],
    modelId: "M01", modelVersion: 1, presets: ["detail"], styling: { accessories: [] },
  } as any);
  if (!("id" in created)) throw new Error(JSON.stringify(created));
  return db.getDb().prepare("SELECT * FROM images WHERE production_id = ?").get(created.id);
}
const rowOf = (id: string): any => db.getDb().prepare("SELECT * FROM images WHERE id = ?").get(id);
const statusOf = (row: any) => repo.getProduction(row.production_id)!.images.find((i) => i.id === row.id)!;

beforeAll(async () => {
  repo = await import("../lib/server/repo");
  db = await import("../lib/server/db");
  pipeline = await import("../lib/server/pipeline");
  jobstore = await import("../lib/server/jobstore");
  core = await import("@ow-studio/core");
  simulated = await import("../lib/server/simulated");
  const h = async (shade: number) => repo.assets.putBytes(await png(300, 300, shade));
  const refs = { primaryPortrait: await h(90), identityAngles: [], fullBodyFront: await h(91), fullBodyBack: await h(92), characterSheet: await h(90), facialDetailSheet: await h(90) };
  repo.insertModelVersion({ modelId: "M01", displayName: "Test", ageYears: 24, heightCm: 178, euSize: 36, version: 1, look: { hair: "dark hair", skinTone: "olive", eyes: "brown eyes", features: "straight brows" }, refs }, "active");
});

describe("a paid image is never left finished without its file", () => {
  it("the normal path: the image reads as finished only with its file and its attempt", async () => {
    const row = await oneImage();
    const job = await pipeline.processImage(row, { adapter: simulated.simulatedProvider(), sleep: noSleep });
    expect(job.state).toBe("succeeded");
    const after = rowOf(row.id);
    expect(after.state).toBe("succeeded");
    expect(after.final_asset).toBeTruthy();
    expect(statusOf(row).status.key).toBe("to_review");
  });

  it("a worker that stops after the image is made but before its file is stored leaves an unfinished image", async () => {
    const row = await oneImage();
    // The first half of the worker step: the provider made the image (paid) ...
    const job = await core.runJob(row.id, {
      store: jobstore.holdingStore(), adapter: simulated.simulatedProvider(), request: JSON.parse(row.request),
      policy: { ...core.DEFAULT_POLICY, budgetRemainingUsd: 10 }, sleep: noSleep,
    });
    expect(job.state).toBe("succeeded");
    expect(job.costUsd).toBeGreaterThan(0);
    // ... and the worker stops here, before the file is stored.
    const stopped = rowOf(row.id);
    expect(stopped.state).toBe("validating"); // not "succeeded": it does not read as done
    expect(stopped.final_asset).toBeNull();
    expect(statusOf(row).status.label).toBe("Finishing");

    // A new worker picks it up. The provider's result lived in the old process's memory: it is gone.
    const resumed = await pipeline.processImage(rowOf(row.id), { adapter: simulated.simulatedProvider(), sleep: noSleep });
    expect(resumed.state).toBe("awaiting_approval");
    const st = statusOf(row);
    expect(st.status.label).toBe("Not saved · may have cost");
    expect(st.status.canRetry).toBe(true);
    // The lost attempt is recorded with its cost (it may have been billed), without a file.
    const attempts = db.getDb().prepare("SELECT outcome, cost_usd, final_asset FROM attempts WHERE image_id = ?").all(row.id) as any[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe("unknown");
    expect(attempts[0].cost_usd).toBeGreaterThan(0);
    expect(attempts[0].final_asset).toBeNull();

    // A new attempt is offered and works; both attempts are kept.
    expect(await repo.retryImage(row.id)).toEqual({ state: "queued" });
    const again = await pipeline.processImage(rowOf(row.id), { adapter: simulated.simulatedProvider(), sleep: noSleep });
    expect(again.state).toBe("succeeded");
    expect(again.attempt).toBe(2);
    expect(rowOf(row.id).final_asset).toBeTruthy();
    expect((db.getDb().prepare("SELECT COUNT(*) AS n FROM attempts WHERE image_id = ?").get(row.id) as any).n).toBe(2);
  });

  it("an image an earlier version left finished without a file is recovered when the worker starts", async () => {
    const row = await oneImage();
    // As the earlier version could leave it: succeeded, paid, no file, no attempt.
    const job = { ...JSON.parse(row.job), state: "succeeded", costUsd: 0.16, providerJobId: "gemini_1_lost" };
    db.getDb().prepare("UPDATE images SET state = 'succeeded', job = ? WHERE id = ?").run(JSON.stringify(job), row.id);
    expect(await pipeline.recoverUnsavedResults()).toBe(1);
    const st = statusOf(row);
    expect(rowOf(row.id).state).toBe("awaiting_approval");
    expect(st.status.label).toBe("Not saved · may have cost");
    expect(st.status.hint).toMatch(/file was not saved/);
    expect(await repo.retryImage(row.id)).toEqual({ state: "queued" });
    // Nothing else is touched: finished images with files stay as they are.
    expect(await pipeline.recoverUnsavedResults()).toBe(0);
  });
});
