import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { GEMINI_PRO_PROFILE, GeminiProvider } from "@ow-studio/core";
import { importIssues, packshotsBySku, parseFile, type ImportFile } from "../lib/import";
import { productionMetrics, statusView } from "../lib/outcome";

// Isolated data directory: the real production history is never touched. No network: the provider is simulated.
process.env.OW_DATA_DIR = mkdtempSync(join(tmpdir(), "ow-studio-catalog-"));

let repo: typeof import("../lib/server/repo");
let db: typeof import("../lib/server/db");
let pipeline: typeof import("../lib/server/pipeline");

const png = async (w: number, h: number, shade: number) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 241, g: 241, b: 241 } } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h * 0.7), channels: 3, background: { r: shade, g: shade, b: shade } } }, top: Math.round(h * 0.15), left: Math.round(w / 3) }])
    .png().toBuffer());

/** The real Gemini adapter with fetch replaced: each call answers with the next scripted response. */
function simulated(script: ("ok" | "lost")[], sent: unknown[] = []) {
  let n = 0;
  const fetch = async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    const step = script[Math.min(n++, script.length - 1)];
    if (step === "lost") throw new Error("socket hang up"); // request went out, no answer: may have been billed
    const out = await png(2048, 2048, 20 + n * 10); // a different image per attempt
    return { ok: true, status: 200, text: async () => JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: Buffer.from(out).toString("base64") }] }] }) };
  };
  return new GeminiProvider(GEMINI_PRO_PROFILE, { resolveAsset: (h: string) => repo.assets.resolve(h), fetch: fetch as any, apiKey: "test" });
}
const sleep = async () => {};

let draft: import("../lib/server/repo").ProductionDraft;

beforeAll(async () => {
  repo = await import("../lib/server/repo");
  db = await import("../lib/server/db");
  pipeline = await import("../lib/server/pipeline");
  const h = async (shade: number) => repo.assets.putBytes(await png(300, 300, shade));
  const refs = { primaryPortrait: await h(90), identityAngles: [], fullBodyFront: await h(91), fullBodyBack: await h(92), characterSheet: await h(90), facialDetailSheet: await h(90) };
  repo.insertModelVersion({ modelId: "M07", version: 1, displayName: "Liv", ageYears: 21, heightCm: 178, euSize: 34, look: { hair: "light blonde", skinTone: "fair", eyes: "blue eyes", features: "high cheekbones" }, refs }, "active");
  draft = {
    name: "Look-07",
    products: [{ sku: "AB123-045", name: "Top", category: "top", color: "black", description: "", flags: [], packshots: { front: await h(30), back: await h(31) } }],
    modelId: "M07", modelVersion: 1,
    presets: ["full_body", "three_quarter_full", "back_full", "styled_full", "detail"],
    styling: { accessories: [] },
  };
});

const rowsOf = (id: string) => db.getDb().prepare("SELECT * FROM images WHERE production_id = ? ORDER BY slot_index").all(id) as any[];
const created = async (d = draft, opts = {}) => {
  const r = await repo.createProduction(d, opts);
  if (!("id" in r)) throw new Error(JSON.stringify(r));
  return r.id;
};

describe("folder import", () => {
  const paths = [
    "Look-07/AB123-045_top-front.jpg",
    "Look-07/AB123-045_top-back.jpg",
    "Look-07/SH456-010-shoes.jpg",
    "Look-08/CD789-001_front.jpg",
    "Look-08/CD789-001_front (1).jpg",
    "Look-08/IMG_2231.jpg",
  ];

  it("reads set, SKU and role from the path and says where each came from", () => {
    const r = paths.map((p) => parseFile(p));
    expect(r.map((x) => [x.set, x.sku, x.role, x.kind])).toEqual([
      ["Look-07", "AB123-045", "front", "garment"],
      ["Look-07", "AB123-045", "back", "garment"],
      ["Look-07", "SH456-010", null, "accessory"],
      ["Look-08", "CD789-001", "front", "garment"],
      ["Look-08", "CD789-001", "front", "garment"],
      ["Look-08", null, null, "garment"],
    ]);
    expect(r[0]!.skuSource).toBe("filename");
    expect(r[0]!.category).toBe("top");
  });

  it("takes SKU or role from a folder when the file name has none, and marks the source", () => {
    const a = parseFile("SS27/AB123-045/back.jpg");
    expect([a.set, a.sku, a.skuSource, a.role, a.roleSource]).toEqual(["AB123-045", "AB123-045", "folder", "back", "filename"]);
    const b = parseFile("Look-07/Back/AB123-045.jpg");
    expect([b.set, b.role, b.roleSource]).toEqual(["Look-07", "back", "folder"]);
  });

  it("never reads camera file names as SKUs and honours a custom pattern", () => {
    expect(parseFile("DSC01234_front.jpg").sku).toBeNull();
    expect(parseFile("IMG2231.jpg").sku).toBeNull();
    expect(parseFile("OW-1001_f.png", "OW-\\d{4}").sku).toBe("OW-1001");
    expect(parseFile("OW-1001_f.png", "OW-\\d{4}").role).toBe("front");
  });

  it("blocks two files for one role and files that need a decision, until they are resolved", () => {
    const files: ImportFile[] = paths.map((p, i) => ({ ...parseFile(p), key: `k${i}`, hash: `sha256:${i}` }));
    const issues = importIssues(files);
    expect(issues).toEqual(expect.arrayContaining([
      { code: "ROLE_TAKEN", sku: "CD789-001", role: "front", keys: ["k3", "k4"] },
      { code: "NEEDS_DECISION", key: "k5", missing: ["sku", "role"] },
    ]));
    expect(issues).toHaveLength(2); // the shoe file is an accessory: kept, not sent, not blocking

    files[4]!.ignored = true;
    Object.assign(files[5]!, { sku: "CD789-001", skuSource: "manual", role: "back", roleSource: "manual" });
    expect(importIssues(files)).toEqual([]);
    expect(Object.keys(packshotsBySku(files).get("CD789-001")!).sort()).toEqual(["back", "front"]);
  });
});

describe("idempotent creation", () => {
  it("creates one production for concurrent requests with the same key", async () => {
    const key = "run_" + Math.random().toString(36).slice(2);
    const [a, b, c] = await Promise.all([repo.createProduction(draft, { createKey: key }), repo.createProduction(draft, { createKey: key }), repo.createProduction(draft, { createKey: key })]);
    const ids = [a, b, c].map((r) => ("id" in r ? r.id : null));
    expect(new Set(ids).size).toBe(1);
    expect((db.getDb().prepare("SELECT COUNT(*) AS n FROM productions WHERE create_key = ?").get(key) as any).n).toBe(1);
    expect(rowsOf(ids[0]!)).toHaveLength(5);
    const other = await repo.createProduction(draft, { createKey: key + "x" });
    expect("id" in other && other.id).not.toBe(ids[0]);
  });

  it("links the import session to the production it created", async () => {
    repo.saveDraft("draft_abc123", { name: "Look-07", files: [] });
    const id = await created(draft, { createKey: "k_draft", draftId: "draft_abc123" });
    expect(repo.getDraft("draft_abc123")!.productionId).toBe(id);
  });
});

describe("attempts and approval", () => {
  it("keeps every attempt with its own files; a retry never overwrites", async () => {
    const id = await created({ ...draft, sessionAnchor: false });
    const p0 = repo.getProduction(id)!;
    const front = p0.images.find((i) => i.preset === "full_body")!;
    const adapter = simulated(["ok", "ok"]);

    await pipeline.processImage(db.getDb().prepare("SELECT * FROM images WHERE id = ?").get(front.id), { adapter, sleep });
    let img = repo.getProduction(id)!.images.find((i) => i.id === front.id)!;
    expect(img.attempts).toHaveLength(1);
    expect(img.status.key).toBe("to_review");
    const first = img.attempts[0]!;
    expect(first.finalAsset).toBeTruthy();

    // A finished image can only be replaced after it was rejected.
    expect(await repo.retryImage(front.id)).toEqual({ error: expect.stringMatching(/Reject/) });
    expect(repo.setReview(front.id, 1, "rejected")).toEqual({ ok: true });
    expect(repo.getProduction(id)!.images.find((i) => i.id === front.id)!.status.key).toBe("rejected");
    expect(await repo.retryImage(front.id)).toEqual({ state: "queued" });

    await pipeline.processImage(db.getDb().prepare("SELECT * FROM images WHERE id = ?").get(front.id), { adapter, sleep });
    img = repo.getProduction(id)!.images.find((i) => i.id === front.id)!;
    expect(img.attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(img.attempts[1]!.finalAsset).not.toBe(first.finalAsset);
    expect(img.finalAsset).toBe(img.attempts[1]!.finalAsset);
    // The first attempt's file is still there to compare against.
    expect((await repo.assets.resolve(first.finalAsset!)).bytes.byteLength).toBeGreaterThan(0);
    expect(img.attempts.reduce((s, a) => s + a.costUsd, 0)).toBeCloseTo(2 * GEMINI_PRO_PROFILE.estimatedCostUsd);

    // Approving the earlier attempt is allowed; only one attempt per image is approved.
    repo.setReview(front.id, 2, "approved");
    repo.setReview(front.id, 1, "approved");
    img = repo.getProduction(id)!.images.find((i) => i.id === front.id)!;
    expect(img.attempts.map((a) => a.review)).toEqual(["approved", null]);
    expect(img.approvedAttempt).toBe(1);

    // The ZIP takes the approved attempt, not the latest, and says so in the manifest.
    const entries = repo.zipEntries(id);
    expect(entries).toEqual([expect.objectContaining({ name: "AB123-045/AB123-045_01_full_body.jpg", asset: first.finalAsset, attempt: 1, attempts: 2, review: "approved" })]);
    expect(repo.zipManifest(entries)).toContain("AB123-045/AB123-045_01_full_body.jpg,AB123-045,full_body,1,2,approved");
  });

  it("exports approved images only by default, and reports approval metrics", async () => {
    const id = await created({ ...draft, sessionAnchor: false });
    const adapter = simulated(["ok"]);
    for (const r of rowsOf(id)) await pipeline.processImage(r, { adapter, sleep });
    const imgs = repo.getProduction(id)!.images;
    for (const i of imgs.slice(0, 4)) repo.setReview(i.id, 1, "approved");
    repo.setReview(imgs[4]!.id, 1, "rejected");

    expect(repo.zipEntries(id)).toHaveLength(4);
    expect(repo.zipEntries(id, { all: true })).toHaveLength(5);
    expect(repo.zipEntries(id, { all: true }).filter((e) => e.review === "rejected")).toHaveLength(1);

    const m = repo.getProduction(id)!.metrics;
    expect(m).toMatchObject({ images: 5, approved: 4, approvedFirstTry: 4, attempts: 5 });
    expect(m.spentUsd).toBeCloseTo(5 * GEMINI_PRO_PROFILE.estimatedCostUsd);
    expect(m.costPerApprovedUsd).toBeCloseTo((5 * GEMINI_PRO_PROFILE.estimatedCostUsd) / 4);
  });

  it("holds dependents on the anchor and still records each attempt (session anchor on)", async () => {
    const id = await created();
    const adapter = simulated(["ok"]);
    const sent: any[] = [];
    const rows = rowsOf(id);
    const anchor = rows.find((r) => r.preset === "full_body")!;
    await pipeline.processImage(anchor, { adapter: simulated(["ok"], sent), sleep });
    for (const r of rowsOf(id).filter((r) => r.id !== anchor.id)) await pipeline.processImage(r, { adapter, sleep });
    const p = repo.getProduction(id)!;
    expect(p.images.every((i) => i.attempts.length === 1 && i.state === "succeeded")).toBe(true);
    expect(p.images.filter((i) => i.refs.some((r) => r.role === "session_anchor"))).toHaveLength(4);
    expect(sent).toHaveLength(1);
  });
});

describe("colour drift check in the pipeline", () => {
  it("marks an image whose garment colour is far from the packshot as 'Check colour'", async () => {
    const red = async () => repo.assets.putBytes(new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 241, g: 241, b: 241 } } })
      .composite([{ input: { create: { width: 100, height: 210, channels: 3, background: { r: 170, g: 30, b: 40 } } }, top: 45, left: 100 }]).png().toBuffer()));
    const front = await red();
    const id = await created({ ...draft, sessionAnchor: false, presets: ["full_body"], products: [{ ...draft.products[0]!, sku: "RED-1", color: "red", packshots: { front } }] });
    const row = rowsOf(id)[0]!;
    await pipeline.processImage(row, { adapter: simulated(["ok"]), sleep }); // simulated output: a dark grey garment
    const img = repo.getProduction(id)!.images[0]!;
    expect(img.attempts[0]!.checks?.colour).toMatchObject({ drift: true });
    expect(img.status).toMatchObject({ key: "check_colour", label: "Check colour" });
    // Reviewing still works as usual: approving clears the warning.
    repo.setReview(img.id, 1, "approved");
    expect(repo.getProduction(id)!.images[0]!.status.key).toBe("approved");
  });

  it("does not flag a correct colour", async () => {
    const id = await created({ ...draft, sessionAnchor: false, presets: ["full_body"] });
    await pipeline.processImage(rowsOf(id)[0]!, { adapter: simulated(["ok"]), sleep });
    const img = repo.getProduction(id)!.images[0]!;
    expect(img.attempts[0]!.checks?.colour?.drift).toBe(false);
    expect(img.status.key).toBe("to_review");
  });
});

describe("unknown outcome", () => {
  it("is its own state: may have cost, recorded as an attempt, new attempt on request", async () => {
    const id = await created({ ...draft, sessionAnchor: false });
    const row = rowsOf(id).find((r) => r.preset === "detail")!;
    const job = await pipeline.processImage(row, { adapter: simulated(["lost"]), sleep });
    expect(job.state).toBe("awaiting_approval");
    expect(job.awaitingReason).toBe("timeout_after_accept");

    const img = repo.getProduction(id)!.images.find((i) => i.id === row.id)!;
    expect(img.status).toMatchObject({ key: "unknown", label: "Unknown outcome", canRetry: true });
    expect(img.status.hint).toMatch(/may cost again/);
    expect(img.attempts).toEqual([expect.objectContaining({ attempt: 1, outcome: "unknown", finalAsset: null })]);

    expect(await repo.retryImage(row.id)).toEqual({ state: "queued" });
    await pipeline.processImage(db.getDb().prepare("SELECT * FROM images WHERE id = ?").get(row.id), { adapter: simulated(["ok"]), sleep });
    const after = repo.getProduction(id)!.images.find((i) => i.id === row.id)!;
    expect(after.attempts.map((a) => a.outcome)).toEqual(["unknown", "succeeded"]);
    expect(after.status.key).toBe("to_review");
    expect(repo.getProduction(id)!.metrics.unknownAttempts).toBe(1);
  });

  it("keeps budget holds, failures and unknown outcomes apart", () => {
    const j = (p: object) => ({ attempt: 1, costUsd: 0, ...p });
    expect(statusView("awaiting_approval", j({ awaitingReason: "uncertain_submission" }), null).key).toBe("unknown");
    expect(statusView("awaiting_approval", j({ awaitingReason: "unknown" }), null).key).toBe("unknown");
    expect(statusView("awaiting_approval", j({ awaitingReason: "budget" }), null).key).toBe("budget");
    expect(statusView("awaiting_approval", j({ awaitingReason: "billed_failure" }), null).key).toBe("failed");
    expect(statusView("failed", j({}), null).key).toBe("failed");
    expect(statusView("queued", j({}), null, { waitingForAnchor: true }).key).toBe("waiting");
  });

  it("counts an image approved on a later attempt as not first-try", () => {
    const a = (attempt: number, review: "approved" | null) => ({ attempt, outcome: "succeeded" as const, rawAsset: "x", finalAsset: "x", costUsd: 0.16, error: null, review, createdAt: "" });
    const m = productionMetrics([
      { job: { attempt: 1, costUsd: 0.16 }, attempts: [a(1, "approved")] },
      { job: { attempt: 2, costUsd: 0.32 }, attempts: [a(1, null), a(2, "approved")] },
      { job: { attempt: 1, costUsd: 0.16 }, attempts: [a(1, null)] },
    ]);
    expect(m).toMatchObject({ approved: 2, approvedFirstTry: 1, attempts: 4 });
    expect(m.costPerApprovedUsd).toBeCloseTo(0.32);
  });
});

describe("hand fix (local edit)", () => {
  const finished = async () => {
    const id = await created({ ...draft, sessionAnchor: false, presets: ["full_body"] });
    const row = rowsOf(id)[0]!;
    await pipeline.processImage(row, { adapter: simulated(["ok"]), sleep });
    return row.id as string;
  };
  const editRow = (id: string) => db.getDb().prepare("SELECT * FROM edits WHERE id = ?").get(id) as any;
  const raw = async (h: string) => new Uint8Array(await sharp((await repo.assets.resolve(h)).bytes).removeAlpha().raw().toBuffer());

  it("sends only the crop, keeps every pixel outside it and stores the result as a new attempt", async () => {
    const imageId = await finished();
    const r = repo.requestEdit(imageId, { attempt: 1, x: 0.5, y: 0.5, createKey: "fix-1" });
    if (!("id" in r)) throw new Error(JSON.stringify(r));
    const sent: any[] = [];
    expect(await pipeline.processEdit(editRow(r.id), { adapter: simulated(["ok"], sent) })).toBe("succeeded");

    // One call, and the image sent is the square crop, not the whole frame.
    expect(sent).toHaveLength(1);
    const input = sent[0].input.find((i: any) => i.type === "image");
    expect((await sharp(Buffer.from(input.data, "base64")).metadata()).width).toBe(492);

    const img = repo.getImage(imageId)!;
    expect(img.attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(img.attempts[1]).toMatchObject({ outcome: "succeeded", note: "hand fix of attempt 1", review: null });
    expect(img.finalAsset).toBe(img.attempts[1]!.finalAsset);
    expect(img.edits).toEqual([expect.objectContaining({ id: r.id, state: "succeeded", resultAttempt: 2 })]);
    expect(img.attempts.reduce((s, a) => s + a.costUsd, 0)).toBeCloseTo(2 * GEMINI_PRO_PROFILE.estimatedCostUsd);

    const [a, b] = [await raw(img.attempts[0]!.finalAsset!), await raw(img.attempts[1]!.finalAsset!)];
    const box = { left: 778, top: 778, size: 492 }; // handBox(2048, 2048, 0.5, 0.5)
    let outside = 0, inside = 0;
    for (let y = 0; y < 2048; y += 4) for (let x = 0; x < 2048; x += 4) {
      const k = 3 * (y * 2048 + x);
      const diff = a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2];
      const inBox = x >= box.left && x < box.left + box.size && y >= box.top && y < box.top + box.size;
      if (diff && !inBox) outside++;
      if (diff && inBox) inside++;
    }
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(0);
  });

  it("is idempotent per click and refuses a second fix while one is pending", async () => {
    const imageId = await finished();
    const r1 = repo.requestEdit(imageId, { attempt: 1, x: 0.3, y: 0.6, createKey: "fix-2" });
    expect(repo.requestEdit(imageId, { attempt: 1, x: 0.3, y: 0.6, createKey: "fix-2" })).toEqual({ id: (r1 as any).id, existing: true });
    expect(repo.requestEdit(imageId, { attempt: 1, x: 0.7, y: 0.6, createKey: "fix-3" })).toEqual({ error: expect.stringMatching(/already in progress/) });
    expect(repo.requestEdit(imageId, { attempt: 9, x: 0.7, y: 0.6 })).toEqual({ error: expect.stringMatching(/in progress|no image/) });
    expect(repo.requestEdit(imageId, { attempt: 1, x: 1.5, y: 0.6 })).toEqual({ error: expect.stringMatching(/inside/) });
    // No new generation and no delete while the fix is pending: both would race with the fix's new attempt.
    repo.setReview(imageId, 1, "rejected");
    expect(await repo.retryImage(imageId)).toEqual({ error: expect.stringMatching(/hand fix/) });
    expect(repo.deleteProduction((db.getDb().prepare("SELECT production_id AS p FROM images WHERE id = ?").get(imageId) as any).p)).toEqual({ error: expect.stringMatching(/hand fix/) });
  });

  it("a lost response is an unknown outcome: no attempt added, counted against the budget", async () => {
    const imageId = await finished();
    const before = repo.spentThisMonthUsd();
    const r = repo.requestEdit(imageId, { attempt: 1, x: 0.5, y: 0.4, createKey: "fix-4" }) as { id: string };
    expect(await pipeline.processEdit(editRow(r.id), { adapter: simulated(["lost"]) })).toBe("failed");
    expect(editRow(r.id)).toMatchObject({ state: "unknown", result_attempt: null });
    expect(editRow(r.id).error).toMatch(/May have been billed/);
    const img = repo.getImage(imageId)!;
    expect(img.attempts).toHaveLength(1);
    expect(repo.spentThisMonthUsd() - before).toBeCloseTo(GEMINI_PRO_PROFILE.estimatedCostUsd);
    // Nothing is retried on its own; a new fix is a new click.
    expect("id" in repo.requestEdit(imageId, { attempt: 1, x: 0.5, y: 0.4, createKey: "fix-5" })).toBe(true);
  });
});
