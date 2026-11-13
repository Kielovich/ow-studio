export const SLOTS = ["front", "back", "detail", "side"] as const;
export type Slot = (typeof SLOTS)[number];


/** Parses "SKU_slot.ext" (also "SKU-slot", "SKU slot"); slot defaults to unknown. */
export function parseName(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "");
  const m = base.match(/^(.*?)[\s_-]+(front|back|detail|side|f|b|d|s)(?:[\s_-]*\d+)?$/i);
  const short: Record<string, Slot> = { f: "front", b: "back", d: "detail", s: "side" };
  if (!m) return { sku: base.trim().replace(/[^A-Za-z0-9._-]+/g, "-"), slot: null };
  const s = m[2]!.toLowerCase();
  return { sku: m[1]!.trim().replace(/[^A-Za-z0-9._-]+/g, "-"), slot: (short[s] ?? s) as Slot };
}

