import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

// Isolated data directory and seed directory; nothing real is touched.
process.env.OW_DATA_DIR = mkdtempSync(join(tmpdir(), "ow-studio-seed-test-"));

let repo: typeof import("../lib/server/repo");
let seed: typeof import("../lib/server/seed");

const jpg = async (shade: number) =>
  new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: shade, g: shade, b: shade } } }).jpeg().toBuffer());

/** A seed folder like scripts/export-seed.ts writes: models.json and the assets named by their hash. */
async function seedDir(models: { id: string; name: string; version: number; status?: string; shade: number }[]) {
  const dir = mkdtempSync(join(tmpdir(), "ow-studio-seed-dir-"));
  mkdirSync(join(dir, "assets"));
  const out = [];
  for (const m of models) {
    const bytes = await jpg(m.shade);
    const h = `sha256:${createHash("sha256").update(bytes).digest("hex")}`; // as the asset store names it
    writeFileSync(join(dir, "assets", `${h.slice(7)}.jpg`), bytes);
    out.push({
      status: m.status ?? "active",
      data: {
        modelId: m.id, displayName: m.name, ageYears: 23, heightCm: 178, euSize: 36, version: m.version,
        look: { hair: "dark hair", skinTone: "olive", eyes: "brown eyes", features: "straight brows" },
        refs: { primaryPortrait: h, identityAngles: [], fullBodyFront: h, fullBodyBack: h, characterSheet: h, facialDetailSheet: h },
      },
    });
  }
  writeFileSync(join(dir, "models.json"), JSON.stringify({ exportedAt: "2026-11-15T00:00:00Z", models: out }));
  return dir;
}
const active = () => repo.listModels().filter((m) => m.status === "active").map((m) => `${m.modelId}@${m.version}`).sort();

beforeAll(async () => {
  repo = await import("../lib/server/repo");
  seed = await import("../lib/server/seed");
});

describe("model seed: additive on every start", () => {
  it("an empty server gets every seed model", async () => {
    const dir = await seedDir([{ id: "M01", name: "Sable", version: 4, shade: 10 }, { id: "M06", name: "Lucía", version: 2, shade: 20 }]);
    expect(await seed.importSeed(dir)).toEqual({ imported: 2, clashes: [] });
    expect(active()).toEqual(["M01@4", "M06@2"]);
    // Every asset is in the store.
    for (const m of repo.listModels()) await repo.assets.resolve(m.data.refs.primaryPortrait);
  });

  it("a second start changes nothing", async () => {
    const dir = await seedDir([{ id: "M01", name: "Sable", version: 4, shade: 10 }, { id: "M06", name: "Lucía", version: 2, shade: 20 }]);
    expect(await seed.importSeed(dir)).toEqual({ imported: 0, skipped: "seed models already present", clashes: [] });
    expect(repo.listModels()).toHaveLength(2);
  });

  it("models added to the seed later reach a server that already has models, without touching the ones it has", async () => {
    const before = repo.listModels().find((m) => m.modelId === "M06")!;
    const dir = await seedDir([
      { id: "M01", name: "Sable", version: 4, shade: 10 },
      { id: "M06", name: "Lucía", version: 2, shade: 20 },
      { id: "M12", name: "New One", version: 1, shade: 30 },
      { id: "M13", name: "New Two", version: 1, shade: 40 },
    ]);
    expect(await seed.importSeed(dir)).toEqual({ imported: 2, clashes: [] });
    expect(active()).toEqual(["M01@4", "M06@2", "M12@1", "M13@1"]);
    const after = repo.listModels().find((m) => m.modelId === "M06")!;
    expect(after).toEqual(before);
  });

  it("a newer version of a model replaces the active one; the old one is archived, not deleted", async () => {
    const dir = await seedDir([{ id: "M06", name: "Lucía", version: 3, shade: 50 }]);
    expect(await seed.importSeed(dir)).toEqual({ imported: 1, clashes: [] });
    expect(repo.listModels().filter((m) => m.modelId === "M06").map((m) => `${m.version}:${m.status}`)).toEqual(["3:active", "2:archived"]);
  });

  it("an older seed version never archives a newer one on the server", async () => {
    const dir = await seedDir([{ id: "M01", name: "Sable", version: 3, shade: 60 }]);
    expect(await seed.importSeed(dir)).toEqual({ imported: 1, clashes: [] });
    expect(repo.listModels().filter((m) => m.modelId === "M01").map((m) => `${m.version}:${m.status}`)).toEqual(["4:active", "3:archived"]);
  });

  it("a model id the server uses for a different model (made in the app) is never overwritten", async () => {
    const dir0 = await seedDir([{ id: "M14", name: "Made Here", version: 1, shade: 70 }]);
    await seed.importSeed(dir0); // stands in for a model built in the app
    const dir = await seedDir([{ id: "M14", name: "From Seed", version: 2, shade: 80 }]);
    const r = await seed.importSeed(dir);
    expect(r.imported).toBe(0);
    expect(r.clashes).toEqual(["M14 (From Seed) is Made Here on this server"]);
    expect(repo.listModels().filter((m) => m.modelId === "M14").map((m) => m.data.displayName)).toEqual(["Made Here"]);
  });

  it("an asset that does not match its hash stops the import before anything is registered", async () => {
    const dir = await seedDir([{ id: "M15", name: "Broken", version: 1, shade: 90 }]);
    const { readdirSync } = await import("node:fs");
    const name = readdirSync(join(dir, "assets"))[0]!;
    writeFileSync(join(dir, "assets", name), await jpg(91)); // different bytes under the old name
    await expect(seed.importSeed(dir)).rejects.toThrow(/does not match its content hash/);
    expect(repo.listModels().some((m) => m.modelId === "M15")).toBe(false);
  });

  it("no seed folder: nothing happens", async () => {
    expect(await seed.importSeed(join(tmpdir(), "ow-studio-no-seed-here"))).toEqual({ imported: 0, skipped: "no seed", clashes: [] });
  });
});
