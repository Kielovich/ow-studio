import type { CompiledRequest, ProviderProfile } from "../schemas.js";
import { ProviderError, type ProviderAdapter, type ProviderErrorKind, type ProviderStatus } from "./types.js";

export const MOCK_PROFILE: ProviderProfile = {
  id: "mock",
  version: 1,
  verified: true,
  maxRefs: 6,
  supportsSeed: true,
  supportsIdempotencyKey: true,
  aspectRatios: ["1:1", "4:5", "2:3"],
  maxLongEdgePx: 4096,
  concurrency: 4,
  estimatedCostUsd: 0.04,
};

export type MockStep = {
  /** Throw this error from submit() instead of accepting. */
  submitError?: ProviderErrorKind;
  /** Final outcome after polling. Default: success. */
  result?: "success" | ProviderErrorKind;
  /** Number of polls returning "running" before the outcome. */
  pollsBeforeDone?: number;
  /** Override output size, e.g. to trigger a validation failure. */
  size?: { width: number; height: number };
};

/** Scripted provider for tests. Never touches the network. */
export class MockProvider implements ProviderAdapter {
  readonly submitCalls: { idempotencyKey: string; providerJobId: string | null; compileHash: string }[] = [];
  readonly acceptedJobs: string[] = [];
  private step = 0;
  private readonly byKey = new Map<string, string>();
  private readonly jobs = new Map<string, { step: MockStep; polls: number; request: CompiledRequest }>();

  constructor(readonly profile: ProviderProfile = MOCK_PROFILE, private readonly script: MockStep[] = []) {}

  async submit(request: CompiledRequest, { idempotencyKey }: { idempotencyKey: string }) {
    if (this.profile.supportsIdempotencyKey) {
      const existing = this.byKey.get(idempotencyKey);
      if (existing) {
        this.submitCalls.push({ idempotencyKey, providerJobId: existing, compileHash: request.compileHash });
        return { providerJobId: existing };
      }
    }
    const step = this.script[this.step++] ?? {};
    if (step.submitError) {
      this.submitCalls.push({ idempotencyKey, providerJobId: null, compileHash: request.compileHash });
      throw new ProviderError(step.submitError);
    }
    const providerJobId = `mock_${this.acceptedJobs.length + 1}`;
    this.acceptedJobs.push(providerJobId);
    this.byKey.set(idempotencyKey, providerJobId);
    this.jobs.set(providerJobId, { step, polls: 0, request });
    this.submitCalls.push({ idempotencyKey, providerJobId, compileHash: request.compileHash });
    return { providerJobId };
  }

  async poll(providerJobId: string): Promise<ProviderStatus> {
    const job = this.jobs.get(providerJobId);
    if (!job) throw new ProviderError("invalid_request", `Unknown job ${providerJobId}`);
    if (job.polls++ < (job.step.pollsBeforeDone ?? 0)) return { state: "running" };
    const result = job.step.result ?? "success";
    if (result !== "success") {
      const error = new ProviderError(result);
      return { state: "failed", error, costUsd: error.billable === true ? this.profile.estimatedCostUsd : 0 };
    }
    const { width, height } = job.step.size ?? { width: job.request.params.width, height: job.request.params.height };
    return {
      state: "succeeded",
      costUsd: this.profile.estimatedCostUsd,
      assets: [{ bytes: new TextEncoder().encode(`mock:${job.request.compileHash}`), mime: "image/png", width, height }],
    };
  }
}
