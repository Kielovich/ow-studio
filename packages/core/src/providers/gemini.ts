import type { CompiledRequest, ProviderProfile } from "../schemas";
import { ProviderError, type GeneratedAsset, type ProviderAdapter, type ProviderStatus } from "./types";

/*
 * Gemini "Nano Banana" adapter for the Interactions API.
 * Source: https://ai.google.dev/gemini-api/docs/image-generation (read 2026-11-12, now served from aistudio.google.com/docs).
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   headers: x-goog-api-key, Api-Revision: 2026-05-20
 *   body: { model, input: [{type:"text"}, {type:"image", mime_type, data}], response_format: {type:"image", aspect_ratio, image_size} }
 *   output: steps[type=model_output].content[type=image].data (base64)
 * The call is synchronous. The docs document no seed and no idempotency key.
 * Profiles stay verified:false until a capability test against the real API has passed.
 */

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_API_REVISION = "2026-05-20";

/** Nano Banana 2.1: up to 14 references, character consistency for up to 4 people images, 10 object images. */
export const GEMINI_NB21_PROFILE: ProviderProfile = {
  id: "gemini-nano-banana-2.1",
  version: 1,
  verified: false,
  maxRefs: 14,
  maxIdentityRefs: 4,
  supportsSeed: false,
  supportsIdempotencyKey: false,
  aspectRatios: ["1:1", "4:5", "2:3"],
  maxLongEdgePx: 4096,
  concurrency: 2,
  // Documented 2K output price is $0.0504; the rest is a margin for input and thinking tokens until measured.
  estimatedCostUsd: 0.07,
};

/** Nano Banana Pro: 5 high-fidelity character images and 6 object images. */
export const GEMINI_PRO_PROFILE: ProviderProfile = {
  id: "gemini-3-pro-image",
  version: 1,
  verified: false,
  maxRefs: 11,
  maxIdentityRefs: 5,
  supportsSeed: false,
  supportsIdempotencyKey: false,
  aspectRatios: ["1:1", "4:5", "2:3"],
  maxLongEdgePx: 4096,
  concurrency: 2,
  // Documented 1K/2K output price is $0.134 plus $0.0011 per input image; margin for thinking tokens.
  estimatedCostUsd: 0.16,
};

export type AssetResolver = (hash: string) => Promise<{ bytes: Uint8Array; mime: string }>;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type GeminiOptions = {
  resolveAsset: AssetResolver;
  fetch?: FetchLike;
  /** The egress proxy injects the real key; a placeholder is sent otherwise. Never hard-code a key. */
  apiKey?: string;
  thinkingLevel?: "minimal" | "medium" | "high";
  timeoutMs?: number;
};

export function imageSizeTier(longEdgePx: number): "1K" | "2K" | "4K" {
  if (longEdgePx <= 1024) return "1K";
  if (longEdgePx <= 2048) return "2K";
  return "4K";
}

const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "ECONNRESET_BEFORE_SEND"]);

export function classifyHttpStatus(status: number, body: string): ProviderError {
  const msg = `HTTP ${status}: ${body.slice(0, 300)}`;
  if (status === 429) return new ProviderError("rate_limited", msg);
  // 402: prepaid credits depleted. Rejected before generation; retrying cannot help until billing is fixed.
  if (status === 402) return new ProviderError("invalid_request", `Billing: ${msg}`);
  if (status === 400 || status === 401 || status === 403 || status === 404) return new ProviderError("invalid_request", msg);
  // 5xx billing behaviour is not documented: never auto-retry it.
  return new ProviderError("unknown", msg);
}

export function buildGeminiBody(request: CompiledRequest, model: string, images: { bytes: Uint8Array; mime: string }[], thinkingLevel?: string) {
  return {
    model,
    input: [
      { type: "text", text: request.prompt },
      ...images.map((img) => ({ type: "image", mime_type: img.mime, data: Buffer.from(img.bytes).toString("base64") })),
    ],
    response_format: { type: "image", aspect_ratio: request.params.aspectRatio, image_size: imageSizeTier(Math.max(request.params.width, request.params.height)) },
    ...(thinkingLevel ? { generation_config: { thinking_level: thinkingLevel } } : {}),
  };
}

/** Collects image blocks from steps[model_output].content, falling back to any {type:"image", data} block. */
export function extractImages(json: unknown): { data: string; mime?: string }[] {
  const out: { data: string; mime?: string }[] = [];
  const steps = (json as { steps?: { type?: string; content?: unknown[] }[] })?.steps;
  if (Array.isArray(steps)) {
    for (const s of steps) {
      if (s?.type !== "model_output" || !Array.isArray(s.content)) continue;
      for (const b of s.content as { type?: string; data?: string; mime_type?: string }[]) {
        if (b?.type === "image" && typeof b.data === "string") out.push({ data: b.data, ...(b.mime_type ? { mime: b.mime_type } : {}) });
      }
    }
  }
  if (out.length) return out;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.type === "image" && typeof o.data === "string") out.push({ data: o.data, ...(typeof o.mime_type === "string" ? { mime: o.mime_type } : {}) });
      else Object.values(o).forEach(walk);
    }
  };
  walk(json);
  return out;
}

/** Reads width/height from PNG or JPEG bytes. */
export function imageDimensions(b: Uint8Array): { width: number; height: number; mime: string } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20), mime: "image/png" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]!, mime: "image/jpeg" };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * The Interactions call is synchronous, so submit() performs the generation and poll() returns the stored result.
 * A crash during submit() leaves the job in "submitting"; the runner then asks for approval because this
 * provider cannot dedupe (supportsIdempotencyKey: false).
 */
export class GeminiProvider implements ProviderAdapter {
  private readonly results = new Map<string, ProviderStatus>();
  private seq = 0;
  private readonly fetchImpl: FetchLike;

  constructor(readonly profile: ProviderProfile, private readonly opts: GeminiOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async submit(request: CompiledRequest, { idempotencyKey }: { idempotencyKey: string }): Promise<{ providerJobId: string }> {
    const images = await Promise.all(request.refs.map((r) => this.opts.resolveAsset(r.asset)));
    const body = JSON.stringify(buildGeminiBody(request, this.profile.id, images, this.opts.thinkingLevel));

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.opts.apiKey ?? process.env.GEMINI_API_KEY ?? "injected-by-proxy",
          "api-revision": GEMINI_API_REVISION,
        },
        body,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
      });
    } catch (e) {
      const code = (e as { cause?: { code?: string } })?.cause?.code;
      if (code && CONNECT_ERRORS.has(code)) throw new ProviderError("network_before_accept", `${code} before request was accepted`);
      throw new ProviderError("timeout_after_accept", `request sent, no response: ${(e as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) throw classifyHttpStatus(res.status, text);

    const providerJobId = `gemini_${++this.seq}_${idempotencyKey.slice(5, 17)}`;
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = null; }
    const blocks = json ? extractImages(json) : [];
    if (blocks.length === 0) {
      this.results.set(providerJobId, { state: "failed", costUsd: this.profile.estimatedCostUsd, error: new ProviderError("content_policy", `no image returned: ${text.slice(0, 300)}`) });
      return { providerJobId };
    }
    const assets: GeneratedAsset[] = blocks.map((b) => {
      const bytes = new Uint8Array(Buffer.from(b.data, "base64"));
      const dim = imageDimensions(bytes);
      return { bytes, mime: b.mime ?? dim?.mime ?? "application/octet-stream", width: dim?.width ?? 0, height: dim?.height ?? 0 };
    });
    this.results.set(providerJobId, { state: "succeeded", assets, costUsd: this.profile.estimatedCostUsd, usage: (json as { usage?: unknown })?.usage });
    return { providerJobId };
  }

  async poll(providerJobId: string): Promise<ProviderStatus> {
    const r = this.results.get(providerJobId);
    if (!r) throw new ProviderError("unknown", `result for ${providerJobId} is not in memory (process restarted after a paid call)`);
    return r;
  }
}
