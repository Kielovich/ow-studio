import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Isolated data directory, and a small monthly budget so the budget stop can be tested: $1.00 is 6 images.
process.env.OW_DATA_DIR = mkdtempSync(join(tmpdir(), "ow-studio-builder-test-"));
process.env.OW_BUDGET_USD = "1";

let builder: typeof import("../lib/server/builder");
let repo: typeof import("../lib/server/repo");
let db: typeof import("../lib/server/db");
let maker: ReturnType<typeof import("../lib/server/simulated").simulatedProvider>;

const SPEC = { heritage: "east-asian", skin: "light", freckles: false, hairColour: "black", hairTexture: "straight", hairLength: "long", hairStyle: "low-bun", eyes: "dark-brown", ageYears: 22, heightCm: 176, euSize: 34 };

/** Runs the worker's builder step until the queue is empty. */
async function drain() {
  for (let row = builder.claimBuilderImage("test"); row; row = builder.claimBuilderImage("test")) await builder.processBuilderImage(row, maker);
}

beforeAll(async () => {
  builder = await import("../lib/server/builder");
  repo = await import("../lib/server/repo");
  db = await import("../lib/server/db");
  maker = (await import("../lib/server/simulated")).simulatedProvider();
});

describe("model builder", () => {
  let id = "";
  let modelId = "";

  it("a draft starts from the choices and generates nothing by itself", () => {
    id = builder.createDraft(SPEC);
    const d = builder.getDraft(id)!;
    expect(d.status).toBe("open");
    expect(d.portraits).toHaveLength(0);
    expect(d.spentUsd).toBe(0);
    expect(() => builder.createDraft({ ...SPEC, ageYears: 18 })).toThrow();
  });

  it("makes three portrait candidates; a second round waits until the first is done", async () => {
    builder.queuePortraits(id);
    expect(builder.getDraft(id)!.portraits.filter((p) => p.state === "queued")).toHaveLength(3);
    expect(() => builder.queuePortraits(id)).toThrow(/still being made/);
    await drain();
    const d = builder.getDraft(id)!;
    expect(d.portraits.every((p) => p.state === "succeeded" && p.asset)).toBe(true);
    expect(d.spentUsd).toBeCloseTo(0.48);
    expect(repo.spentThisMonthUsd()).toBeCloseTo(0.48); // builder images count against the monthly budget
  });

  it("new choices clear a chosen portrait (it no longer matches them)", () => {
    const d = builder.getDraft(id)!;
    builder.choosePortrait(id, d.portraits[0]!.id);
    expect(builder.getDraft(id)!.portrait).toBe(d.portraits[0]!.asset);
    builder.updateSpec(id, { ...SPEC, eyes: "hazel" });
    expect(builder.getDraft(id)!.portrait).toBeNull();
    expect(builder.getDraft(id)!.spec.eyes).toBe("hazel");
    builder.choosePortrait(id, d.portraits[1]!.id);
  });

  it("stops at the monthly budget before anything is sent", () => {
    // $0.48 spent of $1.00: the five references ($0.80) do not fit.
    expect(() => builder.queueReferences(id)).toThrow(/Over the monthly budget/);
    expect(Object.keys(builder.getDraft(id)!.references)).toHaveLength(0);
  });

  it("makes the reference set from the chosen portrait, then one reference again", async () => {
    // Move the earlier spend out of this month, so the rest of the flow fits the $1.00 budget.
    db.getDb().prepare("UPDATE model_draft_images SET updated_at = date('now', '-2 months')").run();
    builder.queueReferences(id);
    const queued = db.getDb().prepare("SELECT kind, refs FROM model_draft_images WHERE draft_id = ? AND kind != 'portrait'").all(id) as any[];
    expect(queued.map((r) => r.kind).sort()).toEqual(["bodyBack", "bodyFront", "characterSheet", "profile", "threeQuarter"]);
    expect(queued.every((r) => JSON.parse(r.refs)[0] === builder.getDraft(id)!.portrait)).toBe(true);
    expect(() => builder.choosePortrait(id, builder.getDraft(id)!.portraits[0]!.id)).toThrow(/already made/);
    await drain();
    const d = builder.getDraft(id)!;
    expect(Object.values(d.references).every((r) => r!.state === "succeeded")).toBe(true);
    builder.redoReference(id, "profile");
    expect(builder.getDraft(id)!.references.profile!.round).toBe(2);
    await drain();
    expect(builder.getDraft(id)!.references.profile!.state).toBe("succeeded");
  });

  it("adds her to the models with a name: version 1, active, headless body references", async () => {
    await expect(builder.registerDraft(id, "X")).rejects.toThrow(/2 to 24 letters/);
    await expect(builder.registerDraft(id, "Mia <script>")).rejects.toThrow(/2 to 24 letters/);
    modelId = await builder.registerDraft(id, "  Hana  ");
    expect(modelId).toMatch(/^M\d{2}$/);
    const m = repo.listModels().find((x) => x.modelId === modelId)!;
    expect(m.status).toBe("active");
    expect(m.version).toBe(1);
    expect(m.data.displayName).toBe("Hana");
    expect(m.data.look.features).toBe("East Asian heritage");
    expect(m.data.look.eyes).toBe("hazel eyes");
    const d = builder.getDraft(id)!;
    expect(m.data.refs.primaryPortrait).toBe(d.portrait);
    expect(m.data.refs.identityAngles).toEqual([d.references.threeQuarter!.asset, d.references.profile!.asset]);
    expect(m.data.refs.fullBodyFront).not.toBe(d.references.bodyFront!.asset); // the stored body reference is headless
    expect(d.status).toBe("registered");
    expect(() => builder.queuePortraits(id)).toThrow(/already been added/);
  });

  it("refuses a second model with the same name, and gives the next model a new id", async () => {
    const other = builder.createDraft(SPEC);
    db.getDb().prepare("UPDATE model_draft_images SET updated_at = date('now', '-2 months')").run();
    builder.queuePortraits(other);
    await drain();
    builder.choosePortrait(other, builder.getDraft(other)!.portraits[0]!.id);
    db.getDb().prepare("UPDATE model_draft_images SET updated_at = date('now', '-2 months')").run();
    builder.queueReferences(other);
    await drain();
    await expect(builder.registerDraft(other, "hana")).rejects.toThrow(/already a model called/);
    const second = await builder.registerDraft(other, "Ida");
    expect(Number(second.slice(1))).toBe(Number(modelId.slice(1)) + 1);
  });

  it("an image interrupted mid-call is closed as possibly billed and never sent again", () => {
    const d = builder.createDraft(SPEC);
    db.getDb().prepare("UPDATE model_draft_images SET updated_at = date('now', '-2 months')").run();
    builder.queuePortraits(d);
    const row = builder.claimBuilderImage("crashed-worker")!;
    db.getDb().prepare("UPDATE model_draft_images SET claimed_until = datetime('now', '-1 minute') WHERE id = ?").run(row.id);
    builder.claimBuilderImage("next-worker"); // expires the stale one, claims the next queued
    const r: any = db.getDb().prepare("SELECT state, cost_usd, error FROM model_draft_images WHERE id = ?").get(row.id);
    expect(r.state).toBe("failed");
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(r.error).toMatch(/may have cost/);
  });

  it("discarding cancels images not started yet: nothing more is sent", () => {
    const d = builder.createDraft(SPEC);
    db.getDb().prepare("UPDATE model_draft_images SET updated_at = date('now', '-2 months')").run();
    db.getDb().prepare("UPDATE model_draft_images SET state = 'failed' WHERE state IN ('queued', 'running')").run();
    builder.queuePortraits(d);
    builder.discardDraft(d);
    const states = (db.getDb().prepare("SELECT state, error FROM model_draft_images WHERE draft_id = ?").all(d) as any[]);
    expect(states.every((s) => s.state === "failed" && /Nothing was sent/.test(s.error))).toBe(true);
    expect(builder.claimBuilderImage("w")).toBeNull();
    expect(builder.listOpenDrafts().some((x) => x.id === d)).toBe(false);
  });
});
