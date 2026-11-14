/**
 * Image status as the user sees it, and production metrics. Pure functions shared by server and client.
 *
 * "Unknown outcome" is its own concept: the provider may have accepted (and billed) the request, but we never got a
 * result. It is not a failure and not a normal approval prompt. A new attempt is possible but may cost twice.
 */
import type { ChipColor } from "./types";

export type Review = "approved" | "rejected" | null;

export type Attempt = {
  attempt: number;
  outcome: "succeeded" | "needs_review" | "failed" | "unknown";
  rawAsset: string | null;
  finalAsset: string | null;
  costUsd: number;
  error: string | null;
  /** Origin when not a plain generation, e.g. "hand fix of attempt 1". */
  note?: string | null;
  review: Review;
  createdAt: string;
  /** Automatic checks on this attempt's image. Only checks that can be trusted when they fire (see measureColourDrift). */
  checks?: { colour?: { measuredHex: string; targetHex: string; distance: number; drift: boolean } } | null;
};

type JobLike = { attempt: number; costUsd: number; awaitingReason?: string; lastError?: { kind: string; message: string } };

/** Error kinds and await reasons where the provider may have done (and billed) the work without us seeing a result. */
const UNKNOWN_REASONS = new Set(["timeout_after_accept", "uncertain_submission", "unknown"]);

export function isUnknownOutcome(state: string, job: JobLike): boolean {
  return state === "awaiting_approval" && UNKNOWN_REASONS.has(job.awaitingReason ?? job.lastError?.kind ?? "");
}

/** Outcome stored for a finished attempt. Budget holds are not attempts (nothing was sent). */
export function attemptOutcome(state: string, job: JobLike): Attempt["outcome"] | null {
  if (state === "succeeded") return "succeeded";
  if (state === "needs_review") return "needs_review";
  if (state === "failed") return "failed";
  if (state === "awaiting_approval") return job.awaitingReason === "budget" ? null : isUnknownOutcome(state, job) ? "unknown" : "failed";
  return null;
}

export type StatusView = { key: string; label: string; color: ChipColor; hint?: string; canRetry: boolean };

export function statusView(state: string, job: JobLike, review: Review, opts: { waitingForAnchor?: boolean; checks?: Attempt["checks"] } = {}): StatusView {
  if (opts.waitingForAnchor && state === "queued") return { key: "waiting", label: "Waiting for front", color: "default", canRetry: false };
  if (isUnknownOutcome(state, job)) {
    return {
      key: "unknown", label: "Unknown outcome", color: "warning", canRetry: true,
      hint: "The provider may have produced and billed this image, but no result came back. A new attempt may cost again.",
    };
  }
  switch (state) {
    case "queued": return { key: "queued", label: job.attempt > 1 ? `Queued · attempt ${job.attempt}` : "Queued", color: "default", canRetry: false };
    case "submitting": return { key: "running", label: "Sending", color: "accent", canRetry: false };
    case "provider_running": return { key: "running", label: "Generating", color: "accent", canRetry: false };
    case "validating": return { key: "running", label: "Finishing", color: "accent", canRetry: false };
    case "succeeded":
      if (review === "approved") return { key: "approved", label: "Approved", color: "success", canRetry: false };
      if (review === "rejected") return { key: "rejected", label: "Rejected", color: "danger", canRetry: true };
      if (opts.checks?.colour?.drift) {
        const c = opts.checks.colour;
        return { key: "check_colour", label: "Check colour", color: "warning", canRetry: false,
          hint: `Garment colour in the image (${c.measuredHex}) is far from the packshot (${c.targetHex}). Compare before approving.` };
      }
      return { key: "to_review", label: "To review", color: "accent", canRetry: false };
    case "needs_review":
      if (review === "approved") return { key: "approved", label: "Approved", color: "success", canRetry: false };
      return { key: "needs_review", label: "Check size", color: "warning", canRetry: true, hint: "The image did not pass the automatic size check." };
    case "awaiting_approval":
      return job.awaitingReason === "budget"
        ? { key: "budget", label: "Over budget", color: "warning", canRetry: true, hint: "Monthly budget reached; nothing was sent." }
        : { key: "failed", label: "Failed · may have cost", color: "danger", canRetry: true, hint: job.lastError?.message };
    case "failed": return { key: "failed", label: "Failed", color: "danger", canRetry: true, hint: job.lastError?.message };
    case "cancelled": return { key: "cancelled", label: "Cancelled", color: "default", canRetry: false };
    default: return { key: state, label: state, color: "default", canRetry: false };
  }
}

export type Metrics = {
  images: number;
  approved: number;
  approvedFirstTry: number;
  attempts: number;
  spentUsd: number;
  /** Attempts with an unknown outcome: not in spentUsd, but they may have been billed. */
  unknownAttempts: number;
  /** Everything spent on the production divided by approved images. Null until something is approved. */
  costPerApprovedUsd: number | null;
};

export function productionMetrics(images: { job: JobLike; attempts: Attempt[] }[]): Metrics {
  let approved = 0, approvedFirstTry = 0, attempts = 0, spent = 0, unknown = 0;
  for (const i of images) {
    attempts += i.attempts.length;
    unknown += i.attempts.filter((a) => a.outcome === "unknown").length;
    spent += i.job.costUsd ?? 0;
    const a = i.attempts.find((x) => x.review === "approved");
    if (a) {
      approved++;
      // First recorded attempt, not attempt number 1: unbilled automatic retries (rate limits) also raise the number.
      if (a.attempt === Math.min(...i.attempts.map((x) => x.attempt))) approvedFirstTry++;
    }
  }
  return { images: images.length, approved, approvedFirstTry, attempts, spentUsd: spent, unknownAttempts: unknown, costPerApprovedUsd: approved ? spent / approved : null };
}
