import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Canonical form used for every hash in the system.
 * - object keys sorted, undefined values dropped
 * - strings NFC-normalised, whitespace collapsed and trimmed
 * - -0 becomes 0, non-finite numbers are rejected
 * Arrays keep their order: callers must sort arrays that are semantically sets.
 */
export function canonicalize(value: unknown): Json {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value.normalize("NFC").replace(/\s+/g, " ").trim();
    case "number":
      if (!Number.isFinite(value)) throw new Error("Cannot canonicalize non-finite number");
      return Object.is(value, -0) ? 0 : value;
    case "boolean":
      return value;
    case "object": {
      if (Array.isArray(value)) return value.map(canonicalize);
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k.normalize("NFC"), v] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out: { [key: string]: Json } = {};
      for (const [k, v] of entries) out[k] = canonicalize(v);
      return out;
    }
    default:
      throw new Error(`Cannot canonicalize value of type ${typeof value}`);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hash of the canonical JSON form of a value. */
export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
