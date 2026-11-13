/**
 * Folder import: turns relative file paths ("Look-07/AB123-045_top-front.jpg") into set, SKU and role, and says where
 * each answer came from. Pure and shared by client and tests. Nothing here guesses silently: anything not recognised
 * is left empty and has to be decided by the user, and two files for the same SKU and role block the run.
 */
import type { Category } from "./types";

export const ROLES = ["front", "back", "detail", "side"] as const;
export type Role = (typeof ROLES)[number];
export type Source = "filename" | "folder" | "manual";

/** Brand style numbers: 2-4 letters, 2-6 digits, optional colour code ("AB123-045"). Editable per import. */
export const DEFAULT_SKU_PATTERN = "[A-Z]{2,4}\\d{2,6}(?:-\\d{2,4})?";

const ROLE_WORDS: Record<string, Role> = {
  front: "front", forside: "front", forfra: "front", fr: "front", main: "front",
  back: "back", bagside: "back", bagfra: "back", bk: "back", rear: "back",
  detail: "detail", detalje: "detail", closeup: "detail", close: "detail", zoom: "detail", macro: "detail",
  side: "side", profile: "side", profil: "side",
};
/** One-letter roles only count as the last word of the name ("AB123_f"), never in the middle. */
const SHORT_ROLES: Record<string, Role> = { f: "front", b: "back", d: "detail", s: "side" };

/** Product words. Accessories are not garments: their files are kept but not sent (styling is text for now). */
const ACCESSORY_WORDS = new Set(["shoe", "shoes", "sko", "heels", "pumps", "boots", "sandals", "bag", "bags", "taske", "belt", "baelte", "jewellery", "jewelry", "smykke", "smykker", "earrings", "necklace", "accessory", "accessories", "tilbehoer"]);
const CATEGORY_WORDS: Record<string, Category> = {
  dress: "dress", kjole: "dress", top: "top", shirt: "top", blouse: "top", bluse: "top", body: "bodysuit", bodysuit: "bodysuit",
  trousers: "trousers", pants: "trousers", bukser: "trousers", jeans: "trousers", skirt: "skirt", nederdel: "skirt", shorts: "shorts",
  jacket: "jacket", jakke: "jacket", blazer: "jacket", coat: "coat", frakke: "coat", knit: "knit", strik: "knit", sweater: "knit", cardigan: "knit",
};
/** Camera and phone file prefixes that look like style numbers but never are. */
const CAMERA_PREFIXES = /^(IMG|DSC|DSCF|DSCN|DJI|PXL|MVIMG|GOPR|CIMG|P\d)/i;

export type ParsedFile = {
  path: string;
  filename: string;
  /** Folder the file was in (the set). Null for loose files. */
  set: string | null;
  sku: string | null;
  skuSource: Source | null;
  role: Role | null;
  roleSource: Source | null;
  kind: "garment" | "accessory";
  category: Category | null;
};

function skuRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(`(?<![A-Za-z0-9])(${pattern})(?![A-Za-z0-9])`, "i");
  } catch {
    return null;
  }
}

export function isValidPattern(pattern: string): boolean {
  return skuRegex(pattern) !== null;
}

function findSku(text: string, re: RegExp | null): string | null {
  if (!re) return null;
  const m = text.match(re);
  if (!m || CAMERA_PREFIXES.test(m[1]!)) return null;
  return m[1]!.toUpperCase();
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9æøå]+/i).filter(Boolean).map((w) => w.replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa"));

export function parseFile(path: string, pattern = DEFAULT_SKU_PATTERN): ParsedFile {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const filename = parts.at(-1) ?? path;
  const folders = parts.slice(0, -1);
  // "name (1).jpg", "name copy.jpg", "name-kopi.jpg" are copies: the suffix says nothing about role or SKU.
  const base = filename.replace(/\.[^.]+$/, "").replace(/\s*\(\d+\)$/, "").replace(/[\s_-]+(copy|kopi)(\s*\d+)?$/i, "");
  const re = skuRegex(pattern);

  let sku = findSku(base, re);
  let skuSource: Source | null = sku ? "filename" : null;
  if (!sku) {
    for (const f of [...folders].reverse()) {
      sku = findSku(f, re);
      if (sku) { skuSource = "folder"; break; }
    }
  }

  // Role and product words come from what is left of the name once the SKU is removed.
  const rest = sku && skuSource === "filename" ? base.replace(re!, " ") : base;
  const w = words(rest);
  let role: Role | null = null;
  let roleSource: Source | null = null;
  for (const x of w) if (ROLE_WORDS[x]) { role = ROLE_WORDS[x]!; roleSource = "filename"; }
  if (!role && w.length && SHORT_ROLES[w.at(-1)!]) { role = SHORT_ROLES[w.at(-1)!]!; roleSource = "filename"; }
  if (!role) {
    for (const f of [...folders].reverse()) {
      const fw = words(f);
      const hit = fw.length === 1 ? ROLE_WORDS[fw[0]!] : undefined;
      if (hit) { role = hit; roleSource = "folder"; break; }
    }
  }

  const kind = w.some((x) => ACCESSORY_WORDS.has(x)) ? "accessory" : "garment";
  const category = w.map((x) => CATEGORY_WORDS[x]).find(Boolean) ?? null;
  // The set is the folder nearest the file that is not itself a role folder ("Look-07/Back/x.jpg" → Look-07).
  const set = [...folders].reverse().find((f) => !(words(f).length === 1 && ROLE_WORDS[words(f)[0]!])) ?? null;
  return { path: parts.join("/"), filename, set, sku, skuSource, role, roleSource, kind, category };
}

export type ImportFile = ParsedFile & { key: string; hash?: string; error?: string; duplicateOf?: string; ignored?: boolean };

export type ImportIssue =
  | { code: "ROLE_TAKEN"; sku: string; role: Role; keys: string[] }
  | { code: "NEEDS_DECISION"; key: string; missing: ("sku" | "role")[] }
  | { code: "NO_FRONT"; sku: string };

/** Files that take part in the production: uploaded, not a duplicate, not ignored, and a garment. */
export const usable = (f: ImportFile) => !!f.hash && !f.duplicateOf && !f.ignored && !f.error && f.kind === "garment";

/** Everything that must be resolved before a run. Each issue blocks. */
export function importIssues(files: ImportFile[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const groups = new Map<string, string[]>();
  const skus = new Set<string>();
  for (const f of files.filter(usable)) {
    const missing = [...(f.sku ? [] : ["sku" as const]), ...(f.role ? [] : ["role" as const])];
    if (missing.length) { issues.push({ code: "NEEDS_DECISION", key: f.key, missing }); continue; }
    skus.add(f.sku!);
    const k = `${f.sku}\u0000${f.role}`;
    groups.set(k, [...(groups.get(k) ?? []), f.key]);
  }
  for (const [k, keys] of groups) {
    if (keys.length > 1) {
      const [sku, role] = k.split("\u0000") as [string, Role];
      issues.push({ code: "ROLE_TAKEN", sku, role, keys });
    }
  }
  for (const sku of skus) if (!groups.has(`${sku}\u0000front`)) issues.push({ code: "NO_FRONT", sku });
  return issues;
}

/** SKU → role → asset hash, from files without issues. */
export function packshotsBySku(files: ImportFile[]): Map<string, Partial<Record<Role, string>>> {
  const out = new Map<string, Partial<Record<Role, string>>>();
  for (const f of files.filter(usable)) {
    if (!f.sku || !f.role || !f.hash) continue;
    const p = out.get(f.sku) ?? {};
    p[f.role] ??= f.hash;
    out.set(f.sku, p);
  }
  return out;
}
