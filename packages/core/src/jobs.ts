import { hashOf } from "./canonical.js";
import { ProviderError, type ProviderAdapter, type ProviderErrorKind, type ProviderStatus } from "./providers/types.js";
import type { CompiledRequest } from "./schemas.js";

export type JobState =
  | "queued" | "submitting" | "provider_running" | "validating"
  | "succeeded" | "needs_review" | "failed" | "awaiting_approval" | "cancelled";

const STOPPED: ReadonlySet<JobState> = new Set(["succeeded", "needs_review", "failed", "cancelled", "awaiting_approval"]);

export type JobRecord = {
  id: string;
  imageSpecId: string;
  /** Frozen at creation: the job only ever runs this exact compiled request. */
  compileHash: string;
  state: JobState;
  attempt: number;
  providerJobId?: string;
  costUsd: number;
  lastError?: { kind: ProviderErrorKind; message: string };
  awaitingReason?: string;
  validation?: ValidationReport;
  outputs?: { mime: string; width: number; height: number; bytes: number }[];
  events: { seq: number; state: JobState; note?: string }[];
};

export interface JobStore {
  get(id: string): Promise<JobRecord>;
  save(job: JobRecord): Promise<void>;
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  async get(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`Job ${id} not found`);
    return structuredClone(j);
  }
  async save(job: JobRecord) { this.jobs.set(job.id, structuredClone(job)); }
}

export function newJob(id: string, request: CompiledRequest): JobRecord {
  return { id, imageSpecId: request.imageSpecId, compileHash: request.compileHash, state: "queued", attempt: 1, costUsd: 0, events: [{ seq: 1, state: "queued" }] };
}

export type RetryPolicy = {
  maxAutoRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  pollIntervalMs: number;
  maxPolls: number;
  /** Remaining budget for this production; checked before every submission. */
  budgetRemainingUsd: number;
};

export const DEFAULT_POLICY: RetryPolicy = {
  maxAutoRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000, pollIntervalMs: 2000, maxPolls: 150, budgetRemainingUsd: 0,
};

const AUTO_RETRY_KINDS: ReadonlySet<ProviderErrorKind> = new Set(["network_before_accept", "rate_limited", "server_error_unbilled"]);

export type RetryDecision =
  | { action: "auto_retry"; delayMs: number }
  | { action: "needs_approval" }
  | { action: "fail" };

/** Paid or possibly-paid failures never retry automatically. */
export function decideRetry(error: ProviderError, attempt: number, policy: RetryPolicy): RetryDecision {
  if (error.kind === "invalid_request") return { action: "fail" };
  if (error.billable !== false) return { action: "needs_approval" };
  if (AUTO_RETRY_KINDS.has(error.kind) && attempt <= policy.maxAutoRetries) {
    return { action: "auto_retry", delayMs: Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs) };
  }
  return { action: "fail" };
}

export function idempotencyKey(job: Pick<JobRecord, "imageSpecId" | "compileHash" | "attempt">): string {
  return "idem_" + hashOf([job.imageSpecId, job.compileHash, job.attempt]).slice(0, 32);
}

export type ValidationReport = { ok: boolean; reasons: string[] };

/** Cheap structural checks. Visual heuristics (background, identity, colour) plug in here later. */
export function validateResult(status: Extract<ProviderStatus, { state: "succeeded" }>, request: CompiledRequest): ValidationReport {
  const reasons: string[] = [];
  if (status.assets.length === 0) reasons.push("provider returned no image");
  for (const a of status.assets) {
    if (a.width !== request.params.width || a.height !== request.params.height) {
      reasons.push(`size ${a.width}x${a.height} does not match requested ${request.params.width}x${request.params.height}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export type RunDeps = {
  store: JobStore;
  adapter: ProviderAdapter;
  request: CompiledRequest;
  policy: RetryPolicy;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Runs one image job to a stopping state. Safe to call again after a crash:
 * - a persisted providerJobId is polled, never resubmitted
 * - a submission interrupted before its id was persisted is resubmitted with the same
 *   idempotency key only if the provider dedupes; otherwise it waits for human approval
 * Non-provider exceptions propagate (treated as a crash; the job stays resumable).
 */
export async function runJob(jobId: string, d: RunDeps): Promise<JobRecord> {
  let job = await d.store.get(jobId);
  const set = async (patch: Partial<JobRecord>, note?: string) => {
    const next: JobRecord = { ...job, ...patch };
    if (patch.state && patch.state !== job.state) {
      next.events = [...job.events, { seq: job.events.length + 1, state: patch.state, ...(note ? { note } : {}) }];
    }
    job = next;
    await d.store.save(job);
  };

  if (STOPPED.has(job.state)) return job;
  if (job.compileHash !== d.request.compileHash) throw new Error(`Job ${jobId} is frozen to ${job.compileHash}, got ${d.request.compileHash}`);

  if (job.state === "submitting" && !job.providerJobId && !d.adapter.profile.supportsIdempotencyKey) {
    await set({ state: "awaiting_approval", awaitingReason: "uncertain_submission" }, "resumed mid-submission; provider cannot dedupe");
    return job;
  }

  const onError = async (e: ProviderError): Promise<"continue" | "stop"> => {
    const decision = decideRetry(e, job.attempt, d.policy);
    const lastError = { kind: e.kind, message: e.message };
    if (decision.action === "auto_retry") {
      await set({ state: "queued", attempt: job.attempt + 1, providerJobId: undefined, lastError }, `auto retry after ${e.kind}`);
      await d.sleep(decision.delayMs);
      return "continue";
    }
    if (decision.action === "needs_approval") {
      await set({ state: "awaiting_approval", awaitingReason: e.kind, lastError }, `${e.kind}: may have been billed`);
      return "stop";
    }
    await set({ state: "failed", lastError }, e.kind);
    return "stop";
  };

  for (;;) {
    if (!job.providerJobId) {
      if (d.adapter.profile.estimatedCostUsd > d.policy.budgetRemainingUsd) {
        await set({ state: "awaiting_approval", awaitingReason: "budget" }, "budget cap reached");
        return job;
      }
      await set({ state: "submitting" });
      try {
        const { providerJobId } = await d.adapter.submit(d.request, { idempotencyKey: idempotencyKey(job) });
        await set({ state: "provider_running", providerJobId });
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        if ((await onError(e)) === "stop") return job;
        continue;
      }
    } else if (job.state !== "provider_running") {
      await set({ state: "provider_running" }, "resumed");
    }

    let status: ProviderStatus;
    let polls = 0;
    for (;;) {
      status = await d.adapter.poll(job.providerJobId!);
      if (status.state !== "running") break;
      if (++polls >= d.policy.maxPolls) {
        status = { state: "failed", error: new ProviderError("timeout_after_accept"), costUsd: 0 };
        break;
      }
      await d.sleep(d.policy.pollIntervalMs);
    }

    if (status.state === "succeeded") {
      await set({ state: "validating", costUsd: job.costUsd + status.costUsd });
      const validation = validateResult(status, d.request);
      await set({
        state: validation.ok ? "succeeded" : "needs_review",
        validation,
        outputs: status.assets.map((a) => ({ mime: a.mime, width: a.width, height: a.height, bytes: a.bytes.byteLength })),
      }, validation.ok ? undefined : validation.reasons.join("; "));
      return job;
    }

    await set({ costUsd: job.costUsd + status.costUsd });
    if ((await onError(status.error)) === "stop") return job;
  }
}

/** Explicit user approval for a paid retry. The only way out of awaiting_approval. */
export async function approveRetry(store: JobStore, jobId: string): Promise<JobRecord> {
  const job = await store.get(jobId);
  if (job.state !== "awaiting_approval" && job.state !== "failed" && job.state !== "needs_review") {
    throw new Error(`Job ${jobId} is ${job.state}; nothing to approve`);
  }
  const next: JobRecord = {
    ...job,
    state: "queued",
    attempt: job.attempt + 1,
    providerJobId: undefined,
    awaitingReason: undefined,
    events: [...job.events, { seq: job.events.length + 1, state: "queued", note: "retry approved by user" }],
  };
  await store.save(next);
  return next;
}
