import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

// Isolated data directory: the real .data/ production history is never touched.
process.env.OW_DATA_DIR = mkdtempSync(join(tmpdir(), "ow-studio-test-"));

let repo: typeof import("../lib/server/repo");
let db: typeof import("../lib/server/db");

const png = async (w: number, h: number, shade: number) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 241, g: 241, b: 241 } } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h * 0.7), channels: 3, background: { r: shade, g: shade, b: shade } } }, top: Math.round(h * 0.15), left: Math.round(w / 3) }])
    .png().toBuffer());

let draft: import("../lib/server/repo").ProductionDraft;

const CLAIMABLE = `SELECT i.id FROM images i WHERE i.production_id = ? AND i.state = 'queued'
  AND (i.depends_on IS NULL OR EXISTS (SELECT 1 FROM images a WHERE a.id = i.depends_on AND a.state = 'succeeded' AND a.final_asset IS NOT NULL))`;

beforeAll(async () => {
  repo = await import("../lib/server/repo");
  db = await import("../lib/server/db");
  const h = async (shade: number) => repo.assets.putBytes(await png(300, 300, shade));
  const refs = { primaryPortrait: await h(90), identityAngles: [], fullBodyFront: await h(91), fullBodyBack: await h(92), characterSheet: await h(90), facialDetailSheet: await h(90) };
  const base = { modelId: "M01", displayName: "Test", ageYears: 24, heightCm: 178, euSize: 36, look: { hair: "dark hair", skinTone: "olive", eyes: "brown eyes", features: "straight brows" }, refs };
  repo.insertModelVersion({ ...base, version: 1 }, "archived");
  repo.insertModelVersion({ ...base, version: 2 }, "active");
  draft = {
    name: "anchor test",
    products: [{ sku: "SKU-1", name: "Dress", category: "dress", color: "black", description: "", flags: [], packshots: { front: await h(30), back: await h(31) } }],
    modelId: "M01", modelVersion: 2,
    presets: ["full_body", "three_quarter_full", "back_full", "styled_full", "detail"],
    styling: { hairState: "sleek", accessories: [] },
  };
});

describe("session anchor in the production pipeline", () => {
  it("rejects archived model versions on the server", async () => {
    await expect(repo.previewDraft({ ...draft, modelVersion: 1 })).rejects.toThrow(/not active/);
    await expect(repo.createProduction({ ...draft, modelVersion: 1 })).rejects.toThrow(/not active/);
  });

  it("plans the preview exactly like the run", async () => {
    const preview = await repo.previewDraft(draft);
    const created = await repo.createProduction(draft);
    if (!("id" in created)) throw new Error(JSON.stringify(created));
    const p = repo.getProduction(created.id)!;
    const run = p.images.map((i) => [i.preset, (JSON.parse((db.getDb().prepare("SELECT request FROM images WHERE id = ?").get(i.id) as any).request)).assignment.poseId]);
    const pre = preview.images.map((i) => [i.preset, i.poseId]);
    expect(new Map(run as [string, string][])).toEqual(new Map(pre as [string, string][]));
  });

  it("holds dependents until the anchor succeeds, then freezes the anchor once into request and job", async () => {
    const created = await repo.createProduction(draft);
    if (!("id" in created)) throw new Error("create failed");
    const d = db.getDb();
    const rows = d.prepare("SELECT id, preset, depends_on, compile_hash FROM images WHERE production_id = ?").all(created.id) as any[];
    const anchor = rows.find((r) => r.preset === "full_body");
    const dependents = rows.filter((r) => r.preset !== "full_body");
    expect(anchor.depends_on).toBeNull();
    for (const r of dependents) expect(r.depends_on).toBe(anchor.id);

    // Only the anchor is claimable at first.
    expect((d.prepare(CLAIMABLE).all(created.id) as any[]).map((r) => r.id)).toEqual([anchor.id]);
    expect(repo.freezeAnchor(dependents[0].id)).toBe(false);

    // Anchor finishes.
    const finalHash = await repo.assets.putBytes(await png(320, 320, 60));
    d.prepare("UPDATE images SET state = 'succeeded', final_asset = ? WHERE id = ?").run(finalHash, anchor.id);
    // The anchor itself is done; all four dependents are now claimable.
    expect((d.prepare(CLAIMABLE).all(created.id) as any[]).length).toBe(4);

    for (const dep of dependents) {
      expect(repo.freezeAnchor(dep.id)).toBe(true);
      const row: any = d.prepare("SELECT request, compile_hash, job FROM images WHERE id = ?").get(dep.id);
      const req = JSON.parse(row.request);
      const job = JSON.parse(row.job);
      const sess = req.refs.find((r: any) => r.role === "session_anchor");
      expect(sess.asset).toBe(finalHash);
      expect(row.compile_hash).toBe(req.compileHash);
      expect(job.compileHash).toBe(req.compileHash);
      expect(row.compile_hash).not.toBe(dep.compile_hash);
      expect(job.events.at(-1).note).toMatch(/session anchor frozen/);
      // Frozen once: a second call changes nothing.
      expect(repo.freezeAnchor(dep.id)).toBe(false);
    }

    // A later anchor retry does not touch already frozen dependents.
    const other = await repo.assets.putBytes(await png(330, 330, 70));
    d.prepare("UPDATE images SET final_asset = ? WHERE id = ?").run(other, anchor.id);
    const before: any = d.prepare("SELECT compile_hash FROM images WHERE id = ?").get(dependents[0].id);
    expect(repo.freezeAnchor(dependents[0].id)).toBe(false);
    expect((d.prepare("SELECT compile_hash FROM images WHERE id = ?").get(dependents[0].id) as any).compile_hash).toBe(before.compile_hash);
  });

  it("never re-freezes a job that has already been submitted", async () => {
    const created = await repo.createProduction(draft);
    if (!("id" in created)) throw new Error("create failed");
    const d = db.getDb();
    const rows = d.prepare("SELECT id, preset, job FROM images WHERE production_id = ?").all(created.id) as any[];
    const anchor = rows.find((r) => r.preset === "full_body");
    const dep = rows.find((r) => r.preset === "back_full");
    const job = { ...JSON.parse(dep.job), attempt: 2 };
    d.prepare("UPDATE images SET job = ? WHERE id = ?").run(JSON.stringify(job), dep.id);
    d.prepare("UPDATE images SET state = 'succeeded', final_asset = ? WHERE id = ?").run(await repo.assets.putBytes(await png(310, 310, 50)), anchor.id);
    expect(repo.freezeAnchor(dep.id)).toBe(false);
  });

  it("can be switched off per production", async () => {
    const created = await repo.createProduction({ ...draft, sessionAnchor: false });
    if (!("id" in created)) throw new Error("create failed");
    const rows = db.getDb().prepare("SELECT depends_on FROM images WHERE production_id = ?").all(created.id) as any[];
    for (const r of rows) expect(r.depends_on).toBeNull();
  });
});
