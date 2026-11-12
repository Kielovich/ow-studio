import { describe, expect, it } from "vitest";
import {
  compileProduction, DEFAULT_POLICY, GEMINI_ENDPOINT, GEMINI_NB21_PROFILE, GeminiProvider, imageDimensions, imageSizeTier,
  InMemoryJobStore, newJob, runJob, type FetchLike, type ProviderProfile,
} from "../src/index.js";
import { exampleSpec } from "../src/fixtures.js";

function fakePng(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const okBody = (w = 2048, h = 2048) => JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: b64(fakePng(w, h)) }] }] });

type Call = { url: string; headers: Record<string, string>; body: any };
function fakeFetch(responses: (() => Promise<{ status: number; body: string }>)[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    const r = await next();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return { fetch, calls };
}
const resolveAsset = async (hash: string) => ({ bytes: new TextEncoder().encode(hash), mime: "image/png" });

const profile: ProviderProfile = GEMINI_NB21_PROFILE;
const compiled = compileProduction(exampleSpec({ providerProfileId: profile.id }), profile);
const request = compiled.images.find((i) => i.sku === "TEST-TP-002" && i.preset === "front_crop")!;
const policy = { ...DEFAULT_POLICY, budgetRemainingUsd: 10 };
const noSleep = async () => {};

async function run(responses: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(responses);
  const adapter = new GeminiProvider(profile, { resolveAsset, fetch });
  const store = new InMemoryJobStore();
  await store.save(newJob("j", request));
  const job = await runJob("j", { store, adapter, request, policy, sleep: noSleep });
  return { job, calls, adapter, store };
}

describe("Gemini adapter", () => {
  it("compiles for the Nano Banana 2.1 profile with only an 'unverified' warning", () => {
    expect(compiled.canRun).toBe(true);
    expect(compiled.conflicts.map((c) => c.code)).toEqual(["PROFILE_UNVERIFIED"]);
  });

  it("sends the documented request shape: prompt first, references in priority order, 2K for 2000px", async () => {
    const { calls, job } = await run([async () => ({ status: 200, body: okBody() })]);
    expect(job.state).toBe("succeeded");
    const c = calls[0]!;
    expect(c.url).toBe(GEMINI_ENDPOINT);
    expect(c.headers["x-goog-api-key"]).toBeDefined();
    expect(c.headers["api-revision"]).toBe("2026-05-20");
    expect(c.body.model).toBe("gemini-nano-banana-2.1");
    expect(c.body.input[0]).toEqual({ type: "text", text: request.prompt });
    expect(c.body.input.slice(1).map((x: any) => Buffer.from(x.data, "base64").toString())).toEqual(request.refs.map((r) => r.asset));
    expect(c.body.response_format).toEqual({ type: "image", aspect_ratio: "1:1", image_size: "2K" });
  });

  it("labels every attached reference in the prompt, in order", () => {
    const legend = request.prompt.split("Reference images, in the order attached:\n")[1]!.split("\n\n")[0]!.split("\n");
    expect(legend).toHaveLength(request.refs.length);
    expect(legend[0]).toMatch(/^1\. garment packshot, front/);
  });

  it("accepts a larger native render with the right aspect, rejects a wrong aspect", async () => {
    expect((await run([async () => ({ status: 200, body: okBody(2048, 2048) })])).job.state).toBe("succeeded");
    expect((await run([async () => ({ status: 200, body: okBody(2048, 1536) })])).job.state).toBe("needs_review");
  });

  it("auto-retries 429 and succeeds", async () => {
    const { job, calls } = await run([async () => ({ status: 429, body: "quota" }), async () => ({ status: 200, body: okBody() })]);
    expect(job.state).toBe("succeeded");
    expect(calls).toHaveLength(2);
  });

  it("never auto-retries a 5xx (billing undocumented)", async () => {
    const { job, calls } = await run([async () => ({ status: 500, body: "internal" })]);
    expect(job).toMatchObject({ state: "awaiting_approval", awaitingReason: "unknown" });
    expect(calls).toHaveLength(1);
  });

  it("fails fast with a billing message on 402 (credits depleted, seen on the real API)", async () => {
    const { job, calls } = await run([async () => ({ status: 402, body: '{"error":{"code":402,"message":"Your prepayment credits are depleted."}}' })]);
    expect(job.state).toBe("failed");
    expect(job.lastError?.message).toMatch(/^Billing: HTTP 402/);
    expect(calls).toHaveLength(1);
  });

  it("fails fast on 400/403 without retry", async () => {
    expect((await run([async () => ({ status: 400, body: "bad" })])).job.state).toBe("failed");
    expect((await run([async () => ({ status: 403, body: "key" })])).job.state).toBe("failed");
  });

  it("treats a 200 without an image as a possibly billed content block", async () => {
    const { job } = await run([async () => ({ status: 200, body: JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "text", text: "I can't help with that." }] }] }) })]);
    expect(job).toMatchObject({ state: "awaiting_approval", awaitingReason: "content_policy" });
    expect(job.lastError?.message).toMatch(/can't help/);
  });

  it("distinguishes connect failures (safe to retry) from lost responses (approval)", async () => {
    const refused = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const a = await run([async () => { throw refused; }, async () => ({ status: 200, body: okBody() })]);
    expect(a.job.state).toBe("succeeded");
    const b = await run([async () => { throw new Error("The operation was aborted due to timeout"); }]);
    expect(b.job).toMatchObject({ state: "awaiting_approval", awaitingReason: "timeout_after_accept" });
  });

  it("asks for approval when the result was lost in a restart after a paid call", async () => {
    const { store, adapter } = await run([async () => ({ status: 200, body: okBody() })]);
    const j = await store.get("j");
    await store.save({ ...j, state: "provider_running", events: j.events });
    const fresh = new GeminiProvider(profile, { resolveAsset, fetch: adapter["fetchImpl"] });
    const job = await runJob("j", { store, adapter: fresh, request, policy, sleep: noSleep });
    expect(job).toMatchObject({ state: "awaiting_approval", awaitingReason: "unknown" });
  });

  it("respects the person-reference limit", () => {
    const strict = compileProduction(exampleSpec({ providerProfileId: profile.id }), { ...profile, maxIdentityRefs: 2 });
    const front = strict.images.find((i) => i.sku === "TEST-TP-002" && i.preset === "front_crop")!;
    expect(front.refs.map((r) => r.role)).toEqual(["garment_front", "identity_primary", "body_front"]);
    expect(strict.conflicts.some((c) => c.code === "REFS_TRIMMED")).toBe(true);
  });

  it("parses PNG dimensions and picks size tiers", () => {
    expect(imageDimensions(fakePng(1856, 2304))).toEqual({ width: 1856, height: 2304, mime: "image/png" });
    expect([imageSizeTier(1000), imageSizeTier(2000), imageSizeTier(3000)]).toEqual(["1K", "2K", "4K"]);
  });
});
