import type { CompiledRequest, ProviderProfile } from "../schemas.js";

export type ProviderErrorKind =
  | "network_before_accept"
  | "rate_limited"
  | "server_error_unbilled"
  | "timeout_after_accept"
  | "content_policy"
  | "billed_failure"
  | "invalid_request"
  | "unknown";

/**
 * Whether an error may have cost money. "unknown" is treated like billable:
 * it never triggers an automatic retry.
 */
export const ERROR_BILLABLE: Record<ProviderErrorKind, boolean | "unknown"> = {
  network_before_accept: false,
  rate_limited: false,
  server_error_unbilled: false,
  timeout_after_accept: "unknown",
  content_policy: "unknown",
  billed_failure: true,
  invalid_request: false,
  unknown: "unknown",
};

export class ProviderError extends Error {
  readonly billable: boolean | "unknown";
  constructor(readonly kind: ProviderErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "ProviderError";
    this.billable = ERROR_BILLABLE[kind];
  }
}

export type GeneratedAsset = { bytes: Uint8Array; mime: string; width: number; height: number };

export type ProviderStatus =
  | { state: "running" }
  | { state: "succeeded"; assets: GeneratedAsset[]; costUsd: number; usage?: unknown }
  | { state: "failed"; error: ProviderError; costUsd: number };

/** The only boundary that talks to an image provider. Credentials live inside the adapter, server-side. */
export interface ProviderAdapter {
  readonly profile: ProviderProfile;
  submit(request: CompiledRequest, opts: { idempotencyKey: string }): Promise<{ providerJobId: string }>;
  poll(providerJobId: string): Promise<ProviderStatus>;
}
