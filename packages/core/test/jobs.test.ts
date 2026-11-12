import { describe, expect, it } from "vitest";
import {
  approveRetry, compileProduction, decideRetry, DEFAULT_POLICY, InMemoryJobStore, MOCK_PROFILE, MockProvider, newJob,
  ProviderError, runJob, type CompiledRequest, type MockStep, type ProviderAdapter, type RetryPolicy,
} from "../src/index.js";
import { exampleSpec } from "../src/fixtures.js";

const request: CompiledRequest = compileProduction(exampleSpec(), MOCK_PROFILE).images[0]!;
const policy: RetryPolicy = { ...DEFAULT_POLICY, budgetRemainingUsd: 10, maxPolls: 5 };
const noSleep = async () => {};

async function setup(script: MockStep[], profile = MOCK_PROFILE) {
  const store = new InMemoryJobStore();
  const adapter = new MockProvider(profile, script);
  await store.save(newJob("job1", request));
  const run = (a: ProviderAdapter = adapter, p = policy) => runJob("job1", { store, adapter: a, request, policy: p, sleep: noSleep });
  return { store, adapter, run };
}

describe("retry policy", () => {
  it("auto-retries only non-billable transport errors, with capped backoff", () => {
    expect(decideRetry(new ProviderError("rate_limited"), 1, policy)).toEqual({ action: "auto_retry", delayMs: 2000 });
    expect(decideRetry(new ProviderError("network_before_accept"), 3, policy)).toEqual({ action: "auto_retry", delayMs: 8000 });
    expect(decideRetry(new ProviderError("rate_limited"), 4, policy)).toEqual({ action: "fail" });
    for (const k of ["timeout_after_accept", "content_policy", "billed_failure", "unknown"] as const) {
      expect(decideRetry(new ProviderError(k), 1, policy)).toEqual({ action: "needs_approval" });
    }
    expect(decideRetry(new ProviderError("invalid_request"), 1, policy)).toEqual({ action: "fail" });
  });
});

describe("job runner", () => {
  it("runs a job to success and records cost and events", async () => {
    const { run, adapter } = await setup([{ pollsBeforeDone: 2 }]);
    const job = await run();
    expect(job.state).toBe("succeeded");
    expect(job.costUsd).toBeCloseTo(MOCK_PROFILE.estimatedCostUsd);
    expect(job.events.map((e) => e.state)).toEqual(["queued", "submitting", "provider_running", "validating", "succeeded"]);
    expect(adapter.acceptedJobs).toHaveLength(1);
  });

  it("retries a rate limit automatically, then succeeds", async () => {
    const { run, adapter } = await setup([{ submitError: "rate_limited" }, {}]);
    const job = await run();
    expect(job.state).toBe("succeeded");
    expect(job.attempt).toBe(2);
    expect(adapter.acceptedJobs).toHaveLength(1);
  });

  it("never auto-retries a billed failure; waits for approval, then retries once approved", async () => {
    const { run, adapter, store } = await setup([{ result: "billed_failure" }, {}]);
    const job = await run();
    expect(job.state).toBe("awaiting_approval");
    expect(adapter.acceptedJobs).toHaveLength(1);
    expect(await run()).toMatchObject({ state: "awaiting_approval" }); // calling again does nothing
    expect(adapter.acceptedJobs).toHaveLength(1);
    await approveRetry(store, "job1");
    expect((await run()).state).toBe("succeeded");
    expect(adapter.acceptedJobs).toHaveLength(2);
  });

  it("treats a polling timeout as possibly billed", async () => {
    const { run } = await setup([{ pollsBeforeDone: 99 }]);
    expect(await run()).toMatchObject({ state: "awaiting_approval", awaitingReason: "timeout_after_accept" });
  });

  it("sends a result with the wrong size to review instead of retrying", async () => {
    const { run, adapter } = await setup([{ size: { width: 1024, height: 1024 } }]);
    const job = await run();
    expect(job.state).toBe("needs_review");
    expect(job.validation?.reasons[0]).toMatch(/does not match/);
    expect(adapter.acceptedJobs).toHaveLength(1);
  });

  it("stops before submitting when the budget is exhausted", async () => {
    const { run, adapter } = await setup([{}]);
    const job = await run(adapter, { ...policy, budgetRemainingUsd: 0 });
    expect(job).toMatchObject({ state: "awaiting_approval", awaitingReason: "budget" });
    expect(adapter.submitCalls).toHaveLength(0);
  });

  it("resumes after a crash without a duplicate paid job (provider dedupes by idempotency key)", async () => {
    const { run, adapter } = await setup([{}]);
    const crashing: ProviderAdapter = {
      profile: adapter.profile,
      submit: async (r, o) => { await adapter.submit(r, o); throw new Error("worker killed"); },
      poll: (id) => adapter.poll(id),
    };
    await expect(run(crashing)).rejects.toThrow("worker killed");
    const job = await run();
    expect(job.state).toBe("succeeded");
    expect(adapter.acceptedJobs).toHaveLength(1);
    expect(new Set(adapter.submitCalls.map((c) => c.idempotencyKey)).size).toBe(1);
  });

  it("resumes after a crash by polling the persisted provider job, never resubmitting", async () => {
    const { run, adapter } = await setup([{ pollsBeforeDone: 1 }]);
    const crashing: ProviderAdapter = { profile: adapter.profile, submit: (r, o) => adapter.submit(r, o), poll: async () => { throw new Error("worker killed"); } };
    await expect(run(crashing)).rejects.toThrow("worker killed");
    expect((await run()).state).toBe("succeeded");
    expect(adapter.submitCalls).toHaveLength(1);
  });

  it("asks for approval after a crash mid-submission when the provider cannot dedupe", async () => {
    const profile = { ...MOCK_PROFILE, supportsIdempotencyKey: false };
    const { run, adapter } = await setup([{}], profile);
    const crashing: ProviderAdapter = { profile, submit: async (r, o) => { await adapter.submit(r, o); throw new Error("worker killed"); }, poll: (id) => adapter.poll(id) };
    await expect(run(crashing)).rejects.toThrow();
    expect(await run()).toMatchObject({ state: "awaiting_approval", awaitingReason: "uncertain_submission" });
    expect(adapter.acceptedJobs).toHaveLength(1);
  });

  it("refuses to run a job against a different compiled request than it was frozen with", async () => {
    const { store, adapter } = await setup([{}]);
    const other = { ...request, compileHash: "cmp_other" };
    await expect(runJob("job1", { store, adapter, request: other, policy, sleep: noSleep })).rejects.toThrow(/frozen/);
  });
});
