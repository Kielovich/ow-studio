"use client";

import { Button, Chip, Input, Label, ListBox, Select, Spinner, TextArea, TextField, ToggleButton } from "@heroui/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Choices } from "@/components/choices";
import { InfoTip, TipBox } from "@/components/help";
import { ManualLook } from "@/components/manual-look";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import {
  completePairs, DEFAULT_SKU_PATTERN, importIssues, KIND_LABELS, lookAssets, lookOfSku, packshotsBySku, parseFile, ROLES, usable, type FileKind,
  type ImportFile, type ImportIssue, type Role,
} from "@/lib/import";
import { formatTime, assetUrl, BRAND_SET, CATEGORIES, FLAGS, PRESET_LABELS, usd, type Category, type GarmentFlag, type PresetId, formatDateTime } from "@/lib/types";

type ProductInfo = { name: string; category: Category; color: string; description: string; flags: GarmentFlag[] };
type ModelRow = { modelId: string; version: number; status: string; data: { displayName: string; ageYears: number; heightCm: number; euSize: number; refs: { primaryPortrait: string } } };
type Preview = {
  canRun: boolean; estCostUsd: number; budgetRemainingUsd: number;
  conflicts: { code: string; severity: "error" | "warning"; message: string; sku?: string }[];
  images: { sku: string; preset: PresetId; poseId: string }[];
  error?: string;
};
type Styling = { hairState: string; makeup: string; top: string; innerTop: string; bottoms: string; footwear: string; accessories: string; sunglasses: string };
/** Everything the import session saves on the server. */
type Session = {
  name: string; files: ImportFile[]; info: Record<string, ProductInfo>; model: string | null; presets: PresetId[]; sessionAnchor: boolean;
  styling: Styling; skuPattern: string; createKey: string | null;
};
type DraftSummary = { id: string; name: string | null; files: number; productionId: string | null; updatedAt: string };

/** Styling as choices: [text sent to the generator, label shown]. The first option is the default. */
const TOPS: [string, string][] = [
  ["a plain fitted black long-sleeve crew-neck top that ends at the waist", "Black long-sleeve top"],
  ["a plain fitted black sleeveless crew-neck tank top that ends at the waist", "Black tank top"],
  ["a plain fitted white long-sleeve crew-neck top that ends at the waist", "White long-sleeve top"],
  ["a plain fitted white sleeveless crew-neck tank top that ends at the waist", "White tank top"],
];
const BOTTOMS: [string, string][] = [
  ["straight black tailored trousers", "Black trousers"],
  ["straight black jeans", "Black jeans"],
  ["straight mid-blue jeans", "Blue jeans"],
  ["straight white tailored trousers", "White trousers"],
  ["a plain black mini skirt", "Black mini skirt"],
];
const SHOES: [string, string][] = [
  ["black pointed-toe stiletto pumps", "Black pumps"],
  ["black leather ankle boots with a slim heel", "Ankle boots"],
  ["black leather knee-high boots with a slim heel", "Knee-high boots"],
  ["black leather ballet flats", "Ballet flats"],
  ["clean white leather sneakers", "White sneakers"],
];
const ACCESSORIES: [string, string][] = [
  ["small black evening bag carried by its handle", "Small black bag"],
  ["black leather shoulder bag", "Shoulder bag"],
  ["small gold hoop earrings", "Gold earrings"],
  ["small silver hoop earrings", "Silver earrings"],
  ["a thin gold necklace", "Gold necklace"],
];
const SUNGLASSES: [string, string][] = [
  ["", "None"],
  ["modern black sunglasses with dark lenses and a slim rectangular frame", "Black, slim"],
  ["black oval sunglasses with dark lenses", "Black, oval"],
  ["tortoiseshell sunglasses with brown lenses", "Tortoiseshell"],
];

const STEPS = ["Packshots", "Model & shots", "Styling", "Review"] as const;

const DEFAULT_STYLING: Styling = {
  // Empty = the model's own signature hair and makeup from her identity portrait.
  hairState: "",
  makeup: "",
  top: "a plain fitted black long-sleeve crew-neck top that ends at the waist",
  innerTop: "a plain fitted black crew-neck top",
  bottoms: "straight black tailored trousers",
  footwear: "black pointed-toe stiletto pumps",
  accessories: "small black evening bag carried by its handle",
  // The brand's styled shot: sunglasses on the face (owner's OW gallery examples). Empty = no sunglasses.
  sunglasses: "modern black sunglasses with dark lenses and a slim rectangular frame",
};

const guessCategory = (s: string): Category => {
  const t = s.toLowerCase();
  if (/trouser|pant|jean/.test(t)) return "trousers";
  if (/skirt/.test(t)) return "skirt";
  if (/short/.test(t)) return "shorts";
  if (/coat/.test(t)) return "coat";
  if (/jacket|blazer|fur/.test(t)) return "jacket";
  if (/bodysuit/.test(t)) return "bodysuit";
  if (/knit|sweater|cardigan/.test(t)) return "knit";
  if (/top|shirt|blouse/.test(t)) return "top";
  return "dress";
};

const randomId = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);


/** Walks dropped folders. Entries must be taken synchronously in the drop handler, before any await. */
async function droppedFiles(entries: FileSystemEntry[]): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-8 grid md:grid-cols-[240px_1fr] gap-6 md:gap-8">
      <div>
        <h2 className="ow-display text-2xl mb-2">{title}</h2>
        {hint ? <p className="text-sm text-black/60 leading-relaxed">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextField value={value} onChange={onChange} className="w-full">
      <Label className="ow-eyebrow">{label}</Label>
      <Input placeholder={placeholder} />
    </TextField>
  );
}

/** A packshot shown large: the whole garment on the studio canvas, a clear title and a meta line under it. */
function PackshotCard({ hash, title, meta, warn, children }: { hash?: string; title: string; meta?: React.ReactNode; warn?: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={`relative aspect-[3/4] bg-canvas overflow-hidden ${warn ? "outline outline-2 outline-danger" : ""}`}>
        {hash ? <img src={assetUrl(hash, 800)} alt={title} loading="lazy" className="absolute inset-0 w-full h-full object-contain p-3" /> : null}
      </div>
      <div className="mt-3 text-base font-medium leading-tight">{title}</div>
      {meta ? <div className="text-sm text-black/60 mt-1 min-w-0">{meta}</div> : null}
      {children ? <div className="mt-1 flex flex-wrap gap-x-4 items-center">{children}</div> : null}
    </div>
  );
}

/** An empty packshot place: says what it is for. */
function EmptySlot({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="min-w-0">
      <div className="aspect-[3/4] border border-dashed border-[#bbbbbb] bg-white grid place-items-center px-3 text-center">
        <span className="text-sm text-black/60">{hint}</span>
      </div>
      <div className="mt-3 text-base font-medium leading-tight text-black/60">{title}</div>
    </div>
  );
}

/** Text-style action under a card (link or button), with a full touch target. */
function TextAction({ href, onPress, children }: { href?: string; onPress?: () => void; children: React.ReactNode }) {
  const cls = "text-sm underline underline-offset-4 decoration-1 inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-7";
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{children}</a>
    : <button type="button" onClick={onPress} className={cls}>{children}</button>;
}

const SLOT_HINT: Record<Role, string> = {
  front: "Front packshot needed",
  back: "Back packshot, for the back shot",
  detail: "Optional: the close-up uses the front",
  side: "Optional",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One choice per file instead of a style number field and side buttons: which garment and which side, or the rest of the look. */
type Group = "top" | "bottom" | "dress" | "outer";
const GROUP_OF: Record<Category, Group> = { top: "top", bodysuit: "top", knit: "top", trousers: "bottom", skirt: "bottom", shorts: "bottom", dress: "dress", jacket: "outer", coat: "outer" };
const GROUP_CATEGORY: Record<Group, Category> = { top: "top", bottom: "trousers", dress: "dress", outer: "jacket" };
const CHOICES: { label: string; options: [string, string][] }[] = [
  { label: "Top", options: [["top:front", "Top front"], ["top:back", "Top back"], ["top:detail", "Top detail"]] },
  { label: "Bottom", options: [["bottom:front", "Bottom front"], ["bottom:back", "Bottom back"], ["bottom:detail", "Bottom detail"]] },
  { label: "Dress", options: [["dress:front", "Dress front"], ["dress:back", "Dress back"], ["dress:detail", "Dress detail"]] },
  { label: "Jacket or coat", options: [["outer:front", "Jacket front"], ["outer:back", "Jacket back"]] },
  { label: "Rest of the look", options: [["footwear", "Shoes"], ["accessory", "Accessory"], ["fit", "Fit reference"]] },
];
const choiceOf = (f: ImportFile): string =>
  f.kind !== "garment" ? f.kind : f.role && f.category ? `${GROUP_OF[f.category]}:${f.role}` : "";
const slugOf = (s: string) => s.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").toUpperCase().slice(0, 40) || "LOOK";


export function NewProduction() {
  const router = useRouter();
  const params = useSearchParams();
  // Read once: replacing the URL with ?draft=<new id> must not reload the session on top of unsaved edits.
  const initialDraft = useRef(params.get("draft"));
  const [draftId, setDraftId] = useState<string | null>(initialDraft.current);
  const [loaded, setLoaded] = useState(!initialDraft.current);
  const [productionId, setProductionId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [recent, setRecent] = useState<DraftSummary[]>([]);

  const [name, setName] = useState("");
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [info, setInfo] = useState<Record<string, ProductInfo>>({});
  const [skuPattern, setSkuPattern] = useState(DEFAULT_SKU_PATTERN);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetId[]>(BRAND_SET);
  const [sessionAnchor, setSessionAnchor] = useState(true);
  const [styling, setStyling] = useState<Styling>(DEFAULT_STYLING);
  const [createKey, setCreateKey] = useState<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // One step at a time (less scrolling); the bar at the bottom always shows where things stand and how to go on.
  const [step, setStep] = useState(1);
  const goTo = (n: number) => { setStep(n); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d) => {
      const active = (d.models as ModelRow[]).filter((m) => m.status === "active");
      setModels(active);
      setModel((cur) => cur ?? (active[0] ? `${active[0].modelId}@${active[0].version}` : null));
    });
    if (!initialDraft.current) fetch("/api/drafts").then((r) => r.json()).then((d) => setRecent(d.drafts ?? [])).catch(() => {});
  }, []);

  // ---------- Import session: load once, then autosave ----------
  useEffect(() => {
    const id = initialDraft.current;
    if (!id) return;
    fetch(`/api/drafts/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.data) {
        const s = d.data as Partial<Session>;
        if (s.name !== undefined) setName(s.name);
        if (s.files) setFiles(s.files);
        if (s.info) setInfo(s.info);
        if (s.model) setModel(s.model);
        if (s.presets) setPresets(s.presets);
        if (s.sessionAnchor !== undefined) setSessionAnchor(s.sessionAnchor);
        if (s.styling) setStyling({ ...DEFAULT_STYLING, ...s.styling });
        if (s.skuPattern) setSkuPattern(s.skuPattern);
        setCreateKey(s.createKey ?? null);
        setProductionId(d.productionId ?? null);
        setSavedAt(d.updatedAt);
      }
      setLoaded(true);
    });
  }, []);

  const session: Session = useMemo(
    () => ({ name, files, info, model, presets, sessionAnchor, styling, skuPattern, createKey }),
    [name, files, info, model, presets, sessionAnchor, styling, skuPattern, createKey],
  );

  const save = useCallback(async (s: Session, id: string) => {
    const r = await fetch(`/api/drafts/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }).then((r) => r.json()).catch(() => null);
    if (r?.updatedAt) setSavedAt(r.updatedAt);
    return r;
  }, []);

  useEffect(() => {
    if (!loaded || !files.length) return;
    let id = draftId;
    if (!id) {
      id = randomId("draft_");
      setDraftId(id);
      router.replace(`/productions/new?draft=${id}`, { scroll: false });
    }
    const t = setTimeout(() => void save(session, id!), 700);
    return () => clearTimeout(t);
  }, [session, loaded, draftId, files.length, router, save]);

  // ---------- Upload ----------
  const upload = useCallback(async (list: { file: File; path: string; override?: Partial<ImportFile> }[]) => {
    const arr = list.filter((x) => /\.(png|jpe?g|webp|tiff?)$/i.test(x.file.name) && !x.path.split("/").some((p) => p.startsWith(".")));
    if (!arr.length) return;
    setUploading((n) => n + arr.length);
    for (let i = 0; i < arr.length; i += 6) {
      const chunk = arr.slice(i, i + 6);
      const form = new FormData();
      for (const x of chunk) form.append("files", x.file);
      const res = await fetch("/api/uploads", { method: "POST", body: form }).then((r) => r.json()).catch(() => ({ files: chunk.map((x) => ({ filename: x.file.name, error: "Upload failed" })) }));
      setFiles((prev) => {
        const next = [...prev];
        (res.files as { hash?: string; error?: string }[]).forEach((f, j) => {
          const path = chunk[j]!.path;
          const dup = f.hash ? next.find((x) => x.hash === f.hash && !x.duplicateOf) : undefined;
          next.push({
            ...parseFile(path, skuPattern), ...(chunk[j]!.override ?? {}), key: randomId("f_"),
            ...(f.hash ? { hash: f.hash } : {}), ...(f.error ? { error: f.error } : {}), ...(dup ? { duplicateOf: dup.path } : {}),
          });
        });
        return completePairs(next);
      });
      setUploading((n) => n - chunk.length);
    }
  }, [skuPattern]);

  const issues = useMemo(() => importIssues(files), [files]);
  const lookOf = useMemo(() => lookOfSku(files), [files]);
  const looks = useMemo(() => lookAssets(files), [files]);
  const packshots = useMemo(() => packshotsBySku(files), [files]);
  const skus = useMemo(() => [...new Set(files.filter(usable).map((f) => f.sku).filter((s): s is string => !!s))].sort(), [files]);
  const sets = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const sku of skus) {
      const set = files.find((f) => usable(f) && f.sku === sku)?.set ?? "Loose files";
      m.set(set, [...(m.get(set) ?? []), sku]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [skus, files]);

  useEffect(() => {
    setInfo((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of skus) {
        if (next[s]) continue;
        const hint = files.find((f) => f.sku === s && f.category)?.category;
        // An SKU made from the product name ("ABRIL-SUIT-PANTS") reads better as a name: "Abril Suit Pants".
        const fromName = files.some((f) => f.sku === s && f.skuSource === "name");
        const name = fromName ? s.split("-").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ") : s;
        next[s] = { name, category: hint ?? guessCategory(s), color: "black", description: "", flags: [] };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [skus, files]);

  // Every change re-derives front/back pairs, so choosing one side of a two-image product sets the other.
  const update = (key: string, patch: Partial<ImportFile>) => setFiles((fs) => completePairs(fs.map((f) => (f.key === key ? { ...f, ...patch } : f))));
  const remove = (key: string) => setFiles((fs) => fs.filter((f) => f.key !== key));
  const keepOnly = (keep: string, all: string[]) => setFiles((fs) => fs.map((f) => (all.includes(f.key) && f.key !== keep ? { ...f, ignored: true } : f)));
  const setProduct = (sku: string, patch: Partial<ProductInfo>) => setInfo((i) => ({ ...i, [sku]: { ...i[sku]!, ...patch } }));
  const byKey = (k: string) => files.find((f) => f.key === k);

  // ---------- Draft + live preview ----------
  const draft = useMemo(() => {
    if (!model || issues.length) return null;
    const [modelId, version] = model.split("@");
    const products = skus
      .map((sku) => {
        const i = info[sku];
        const p = packshots.get(sku);
        return i && p?.front ? { sku, ...i, name: i.name || sku, packshots: p, look: lookOf.get(sku) ?? "" } : null;
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (!products.length || !presets.length) return null;
    const setNames = [...new Set(files.filter(usable).map((f) => f.set).filter(Boolean))];
    return {
      name: name || (setNames.length ? setNames.join(", ") : products.map((p) => p.sku).join(", ")).slice(0, 80),
      products, modelId: modelId!, modelVersion: Number(version), presets, sessionAnchor, looks,
      styling: {
        // Hair and makeup are always the model's own (her identity portrait); the chosen top also goes under outerwear.
        top: styling.top, innerTop: styling.top,
        bottoms: styling.bottoms, footwear: styling.footwear,
        accessories: styling.accessories.split(",").map((s) => s.trim()).filter(Boolean),
        ...(styling.sunglasses.trim() ? { sunglasses: styling.sunglasses } : {}),
      },
    };
  }, [model, issues.length, skus, info, packshots, presets, files, name, sessionAnchor, styling, lookOf, looks]);

  useEffect(() => {
    if (!draft) { setPreview(null); return; }
    setCompiling(true);
    const t = setTimeout(() => {
      fetch("/api/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) })
        .then((r) => r.json()).then(setPreview).finally(() => setCompiling(false));
    }, 500);
    return () => clearTimeout(t);
  }, [draft]);

  const run = async () => {
    if (!draft || running) return;
    setRunning(true);
    setRunError(null);
    // The key is fixed before the request and saved with the session: a double click, a retried request or a reload
    // after an unanswered request all resolve to the same production.
    const key = createKey ?? randomId("ck_");
    if (!createKey) setCreateKey(key);
    if (draftId) await save({ ...session, createKey: key }, draftId);
    try {
      const res = await fetch("/api/productions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft, createKey: key, draftId }) });
      const r = await res.json();
      if (r.id) {
        setProductionId(r.id);
        router.push(`/productions/${r.id}`);
        return;
      }
      setPreview((p) => (p ? { ...p, error: r.error, conflicts: r.conflicts ?? p.conflicts } : p));
    } catch {
      setRunError("No answer from the server. The production may or may not have been created. Pressing Run again is safe: it can only create it once.");
    }
    setRunning(false);
  };

  const newRunFromImport = () => { setCreateKey(null); setProductionId(null); };

  const setLabel = (f: ImportFile) => f.set ?? "Loose files";
  const isLookFile = (f: ImportFile) => f.kind !== "garment" && !!f.hash && !f.duplicateOf && !f.ignored && !f.error;
  const lookFilesOf = (set: string) => files.filter((f) => isLookFile(f) && setLabel(f) === set);
  const extras = files.filter((f) => (!usable(f) && !(isLookFile(f) && sets.some(([s]) => s === setLabel(f)))) || f.ignored);
  const errors = preview?.conflicts.filter((c) => c.severity === "error") ?? [];
  const warnings = preview?.conflicts.filter((c) => c.severity === "warning" && c.code !== "PROFILE_UNVERIFIED") ?? [];
  const overBudget = preview ? preview.estCostUsd > preview.budgetRemainingUsd : false;

  /** Applies a "What is this?" choice: garment group and side, or shoes / accessory / fit reference. */
  const assign = (f: ImportFile, v: string) => {
    if (v === "footwear" || v === "accessory" || v === "fit") { update(f.key, { kind: v, role: null, roleSource: null }); return; }
    const [g, role] = v.split(":") as [Group, Role];
    const category = f.category && GROUP_OF[f.category] === g ? f.category : GROUP_CATEGORY[g];
    const sku = f.sku ?? `${slugOf(f.set ?? "Look")}-${g.toUpperCase()}`;
    update(f.key, { kind: "garment", role, roleSource: "manual", sku, skuSource: f.sku ? f.skuSource : "manual", category });
    if (info[sku] && GROUP_OF[info[sku]!.category] !== g) setProduct(sku, { category });
  };
  const choiceSelect = (f: ImportFile) => (
    <select aria-label={`What is ${f.filename}?`} value={choiceOf(f)} onChange={(e) => assign(f, e.target.value)}
      className="border border-ink bg-white h-11 px-3 text-sm min-w-0 w-full sm:w-auto">
      <option value="" disabled>What is this?</option>
      {CHOICES.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </optgroup>
      ))}
    </select>
  );

  const stepDone = (n: number): boolean =>
    n === 1 ? skus.length > 0 && issues.length === 0
      : n === 2 ? !!model && presets.length > 0
        : n === 3 ? stepDone(1) && stepDone(2)
          : !!preview?.canRun && !overBudget;
  const barStatus = issues.length
    ? `${issues.length} ${issues.length === 1 ? "image needs" : "images need"} a choice in Packshots`
    : !draft
      ? "Add packshots, then choose a model and shots"
      : !preview || compiling
        ? "Checking…"
        : preview.error && !preview.conflicts
          ? preview.error
          : runError
            ? runError
            : `${preview.images.length} images · about ${usd(preview.estCostUsd)}${overBudget ? " · over the monthly budget" : ""}`;

  const decisionRow = (f: ImportFile) => (
    <div key={f.key} className="grid grid-cols-[112px_1fr] sm:grid-cols-[160px_1fr] gap-4 sm:gap-6 items-start">
      <a href={assetUrl(f.hash)} target="_blank" rel="noreferrer" aria-label={`Open ${f.filename} full size`} className="block relative aspect-[3/4] bg-canvas overflow-hidden">
        <img src={assetUrl(f.hash, 480)} alt={f.filename} loading="lazy" className="absolute inset-0 w-full h-full object-contain p-2" />
      </a>
      <div className="min-w-0 flex flex-col gap-3">
        <div className="font-medium text-base truncate">{f.filename}</div>
        <div className="flex flex-wrap gap-2 items-center">
          {choiceSelect(f)}
          <Button size="sm" variant="ghost" onPress={() => update(f.key, { ignored: true })}>Ignore</Button>
        </div>
      </div>
    </div>
  );

  const issueView = (i: ImportIssue, n: number) => {
    if (i.code === "NEEDS_DECISION") {
      const f = byKey(i.key);
      return f ? decisionRow(f) : null;
    }
    if (i.code === "ROLE_TAKEN") {
      return (
        <div key={`rt${n}`}>
          <div className="text-sm mb-2"><span className="ow-nav mr-2">{i.sku}</span>{i.keys.length} files for <b>{i.role}</b>. Choose one; the others are ignored.</div>
          <div className="flex flex-wrap gap-3">
            {i.keys.map((k) => {
              const f = byKey(k);
              return f ? (
                <div key={k} className="w-36 sm:w-44">
                  <PackshotCard hash={f.hash} title={f.filename} />
                  <Button size="sm" variant="secondary" className="mt-2 w-full" onPress={() => keepOnly(k, i.keys)}>Use this</Button>
                </div>
              ) : null;
            })}
          </div>
        </div>
      );
    }
    return (
      <div key={`nf${n}`} className="text-sm"><span className="ow-nav mr-2">{i.sku}</span>has no front packshot. Assign one of its files as front, or ignore the SKU&apos;s files.</div>
    );
  };

  if (!loaded) return <div className="pt-12 flex items-center gap-3 text-black/60"><Spinner size="sm" /> Opening import…</div>;

  return (
    <>
      <PageTitle eyebrow="Create" title="New production">
        {savedAt && <span className="text-xs text-black/60 self-center">Import saved {formatTime(savedAt)}</span>}
      </PageTitle>
      <TipBox id="new-production" title="Before you start" steps={[
        <>Use one folder per look, or press <b>Add a look by hand</b>: a top, a bottom or both, and if you like shoes, accessories and a fit reference.</>,
        <>If a file name does not say what it shows, choose it in the list: <b>Top front</b>, <b>Bottom back</b> and so on. Every garment needs a front.</>,
        <>A box marked <b>Blocks run</b> needs a decision from you, e.g. two files for the same angle.</>,
        <>Your import is saved as you go. Nothing is paid until you press Run.</>,
      ]} />

      {productionId && (
        <div className="bg-meta p-5 mb-8 flex flex-wrap items-center gap-4 justify-between">
          <p className="text-sm">This import has already been run. Running it again with the same key opens the same production; nothing is paid twice.</p>
          <div className="flex gap-2">
            <Link href={`/productions/${productionId}`} className="button button--primary button--sm inline-flex items-center">Open production</Link>
            <Button size="sm" variant="secondary" onPress={newRunFromImport}>Prepare a new run</Button>
          </div>
        </div>
      )}

      {!files.length && recent.length > 0 && (
        <div className="mb-8">
          <div className="ow-eyebrow mb-3">Continue an import</div>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {recent.filter((d) => d.files > 0).slice(0, 5).map((d) => (
              <li key={d.id}>
                <Link href={`/productions/new?draft=${d.id}`} className="flex justify-between py-3 text-sm hover:bg-meta px-2">
                  <span>{d.name || "Untitled import"} · {d.files} files{d.productionId ? " · run" : ""}</span>
                  <span className="text-black/60">{formatDateTime(d.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav aria-label="Steps" className="sticky top-16 md:top-20 z-30 bg-white/95 backdrop-blur grid grid-cols-4 gap-2 sm:gap-4 pt-1 pb-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = stepDone(n);
          return (
            <button key={label} type="button" onClick={() => goTo(n)} aria-current={active ? "step" : undefined}
              className={`text-left min-h-11 pt-2 flex flex-col justify-start border-t-2 ${active ? "border-t-[#111111]" : done ? "border-t-[#8a8a8a]" : "border-t-[#e8e8e8]"}`}>
              <span className="ow-eyebrow block">{done && !active ? "✓ " : ""}{n}</span>
              <span className={`text-sm leading-tight block ${active ? "text-ink font-medium" : "text-black/60"}`}>{label}</span>
            </button>
          );
        })}
      </nav>

      <div hidden={step !== 1}>
      <Section title="Packshots" hint="Drop a folder per look, choose files, or add a look by hand.">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const entries = Array.from(e.dataTransfer.items).map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
            if (entries.length) void droppedFiles(entries).then(upload);
            else void upload(Array.from(e.dataTransfer.files).map((file) => ({ file, path: file.name })));
          }}
          className={`border border-dashed ${dragOver ? "border-ink bg-meta" : "border-[#aaaaaa]"} py-14 px-4 text-center transition-colors`}
        >
          <p className="ow-display text-xl mb-1">Drop folders or packshots here</p>
          <p className="text-sm text-black/60 mb-5">PNG, JPEG or WebP, up to 25 MB each{uploading ? ` · uploading ${uploading}…` : ""}</p>
          <div className="flex justify-center gap-2">
            <Button size="sm" onPress={() => folderInput.current?.click()}>Choose folder</Button>
            <Button size="sm" variant="secondary" onPress={() => fileInput.current?.click()}>Choose files</Button>
          </div>
          <input ref={fileInput} type="file" multiple accept="image/*" className="hidden"
            onChange={(e) => { if (e.target.files) void upload(Array.from(e.target.files).map((file) => ({ file, path: file.name }))); e.target.value = ""; }} />
          <input ref={folderInput} type="file" multiple className="hidden" {...{ webkitdirectory: "", directory: "" }}
            onChange={(e) => { if (e.target.files) void upload(Array.from(e.target.files).map((file) => ({ file, path: file.webkitRelativePath || file.name }))); e.target.value = ""; }} />
        </div>


        <ManualLook onAdd={(items) => upload(items)} lookCount={sets.length} busy={uploading > 0} />

        {issues.length > 0 && (
          <div className="mt-8 border border-ink p-5">
            <div className="flex items-center gap-3 mb-4">
              <Chip color="danger" size="sm">Blocks run</Chip>
              <span className="ow-eyebrow">Needs a decision ({issues.length})</span>
            </div>
            <p className="text-sm text-black/70 mb-5 max-w-2xl">Choose what each image shows. With two images of one garment, choosing the front sets the other as the back.</p>
            <div className="flex flex-col gap-5">{issues.map(issueView)}</div>
          </div>
        )}

        {sets.length > 0 && (
          <div className="mt-10 flex flex-col gap-12">
            {sets.map(([set, setSkus]) => (
              <div key={set}>
                <div className="flex items-baseline gap-3 border-b border-line pb-2 mb-6">
                  <span className="ow-display text-xl">{set}</span>
                  <span className="text-sm text-black/60">{setSkus.length} {setSkus.length === 1 ? "product" : "products"}</span>
                </div>
                <div className="flex flex-col gap-10">
                  {setSkus.map((sku) => {
                    const own = files.filter((f) => usable(f) && f.sku === sku);
                    const p = info[sku];
                    return (
                      <div key={sku} className="flex flex-col gap-6" data-testid="import-product">
                        <div className="ow-display text-2xl">{p?.name || sku}</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-8">
                          {ROLES.map((r: Role) => {
                            const here = own.filter((x) => x.role === r);
                            const f = here[0];
                            // Optional empty places (detail, side) only take room from tablet width up.
                            if (!f) return <div key={r} className={r === "detail" || r === "side" ? "hidden sm:block" : ""}><EmptySlot title={cap(r)} hint={SLOT_HINT[r]} /></div>;
                            return (
                              <PackshotCard key={r} hash={f.hash} title={cap(r)} warn={here.length > 1}
                                meta={here.length > 1 ? <span className="text-danger">{here.length} files: choose one above</span> : undefined}>
                                <TextAction href={assetUrl(f.hash)}>Full size ↗</TextAction>
                                <TextAction onPress={() => update(f.key, { ignored: true })}>Remove</TextAction>
                              </PackshotCard>
                            );
                          })}
                        </div>
                        {p && (
                          <div className="grid grid-cols-2 gap-4 content-start max-w-3xl">
                            <Field label="Name" value={p.name} onChange={(v) => setProduct(sku, { name: v })} />
                            <Select value={p.category} onChange={(v) => v && setProduct(sku, { category: v as Category })} className="w-full">
                              <Label className="ow-eyebrow">Type</Label>
                              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {CATEGORIES.map((c) => (
                                    <ListBox.Item key={c} id={c} textValue={c}>{c}<ListBox.ItemIndicator /></ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                            <details className="col-span-2 group">
                              <summary className="ow-nav cursor-pointer inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-7 text-black/70">More about this garment (optional)</summary>
                              <div className="grid grid-cols-2 gap-4 mt-3">
                            <Field label="Colour" value={p.color} onChange={(v) => setProduct(sku, { color: v })} />
                            <div />
                            <TextField value={p.description} onChange={(v) => setProduct(sku, { description: v })} className="col-span-2">
                              <Label className="ow-eyebrow">Construction</Label>
                              <TextArea rows={2} placeholder="e.g. strapless A-line mini dress in black sequins, straight neckline, back zip" />
                            </TextField>
                            <div className="col-span-2">
                              <div className="ow-eyebrow mb-2 flex items-center gap-2">Special details
                                <InfoTip title="Construction and special details">Describe how the garment is built (neckline, closures, length, fabric) and mark special details. This helps the images match the packshot exactly. Leave it empty if the packshot says it all.</InfoTip>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {FLAGS.map((f) => (
                                  <ToggleButton
                                    key={f.id}
                                    size="sm"
                                    isSelected={p.flags.includes(f.id)}
                                    onChange={(on) => setProduct(sku, { flags: on ? [...p.flags, f.id] : p.flags.filter((x) => x !== f.id) })}
                                    className="rounded-none"
                                  >
                                    {f.label}
                                  </ToggleButton>
                                ))}
                              </div>
                            </div>
                              </div>
                            </details>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {lookFilesOf(set).length > 0 && (
                  <div className="mt-8" data-testid="rest-of-look">
                    <div className="ow-eyebrow mb-3 flex items-center gap-2">Rest of the look
                      <InfoTip title="Rest of the look">These images style the look: shoes appear where the feet are in the picture, accessories only in the styled shot, and the fit reference shows how the look should sit (its top, with the head, is cut away). The products of this look are also worn together.</InfoTip>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-8">
                      {lookFilesOf(set).map((f) => (
                        <PackshotCard key={f.key} hash={f.hash} title={KIND_LABELS[f.kind]} meta={<span className="block truncate" title={f.path}>{f.filename}</span>}>
                          <select aria-label={`Type of ${f.filename}`} value={f.kind} onChange={(e) => update(f.key, { kind: e.target.value as FileKind })}
                            className="mt-1 border border-line bg-white h-9 px-2 text-sm">
                            {(Object.keys(KIND_LABELS) as FileKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                          </select>
                          <TextAction onPress={() => remove(f.key)}>Remove</TextAction>
                        </PackshotCard>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {extras.length > 0 && (
          <div className="mt-10 bg-meta p-5">
            <div className="ow-eyebrow mb-4">Not used ({extras.length})</div>
            <div className="flex flex-col gap-3">
              {extras.map((f) => (
                <div key={f.key} className="grid grid-cols-[48px_1fr_auto] gap-4 items-center">
                  <Tile src={assetUrl(f.hash, 240)} alt={f.filename} />
                  <div className="text-sm min-w-0">
                    <div className="truncate">{f.path}</div>
                    <div className="text-black/60">
                      {f.error ?? (f.duplicateOf ? `Same image as ${f.duplicateOf}` : f.ignored ? "Ignored" : f.kind !== "garment" ? `${KIND_LABELS[f.kind]}: there is no product in this look to wear it with.` : "")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {f.ignored && <Button size="sm" variant="secondary" onPress={() => update(f.key, { ignored: false })}>Use again</Button>}
                    {!f.ignored && f.kind !== "garment" && f.hash && <Button size="sm" variant="secondary" onPress={() => update(f.key, { kind: "garment" })}>It is a garment</Button>}
                    <Button size="sm" variant="ghost" onPress={() => remove(f.key)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      </div>
      <div hidden={step !== 2}>
      <Section title="Model" hint="Choose who wears the products. All images of the production use this model.">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {models.map((m) => {
            const id = `${m.modelId}@${m.version}`;
            const selected = id === model;
            return (
              <button key={id} onClick={() => setModel(id)} aria-pressed={selected} className="group text-left">
                <Tile src={assetUrl(m.data.refs.primaryPortrait, 480)} alt={m.data.displayName} className={selected ? "outline outline-1 outline-ink outline-offset-4" : "opacity-60 group-hover:opacity-100 transition-opacity"} />
                <div className="ow-nav mt-3">{m.data.displayName}</div>
                <div className="text-sm text-black/60">{m.data.heightCm} cm · EU {m.data.euSize}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Shots" hint="The brand set, framed like the webshop.">
        <div className="flex flex-wrap gap-2">
          {BRAND_SET.map((p) => (
            <ToggleButton
              key={p}
              isSelected={presets.includes(p)}
              onChange={(on) => setPresets((ps) => (on ? BRAND_SET.filter((x) => x === p || ps.includes(x)) : ps.filter((x) => x !== p)))}
              className="rounded-none"
            >
              {PRESET_LABELS[p]}
            </ToggleButton>
          ))}
        </div>
        <div className="mt-8 flex items-start gap-4 max-w-2xl">
          <ToggleButton isSelected={sessionAnchor} onChange={setSessionAnchor} className="rounded-none shrink-0" isDisabled={!presets.includes("full_body")}>
            {sessionAnchor && presets.includes("full_body") ? "On" : "Off"}
          </ToggleButton>
          <div>
            <div className="ow-nav mb-1 flex items-center gap-2">One studio session
              <InfoTip title="One studio session">Recommended. The front image is made first; the other shots then copy its light, hair and makeup, so the set looks like one shoot. If the front is rejected, the others wait.</InfoTip>
            </div>
            {!presets.includes("full_body") && <p className="text-sm text-black/60">Needs the Front shot.</p>}
          </div>
        </div>
      </Section>

      </div>
      <div hidden={step !== 3}>
      <Section title="Styling" hint="What she wears with your products. Hair and makeup are always her own.">
        <div className="flex flex-col gap-7 max-w-3xl">
          <Choices label="Top" hint="With trousers and skirts, and under jackets." options={TOPS} value={styling.top} onChange={(v) => setStyling((s) => ({ ...s, top: v as string }))} />
          <Choices label="Bottoms" hint="With tops and jackets." options={BOTTOMS} value={styling.bottoms} onChange={(v) => setStyling((s) => ({ ...s, bottoms: v as string }))} />
          <Choices label="Shoes" options={SHOES} value={styling.footwear} onChange={(v) => setStyling((s) => ({ ...s, footwear: v as string }))} />
          <Choices label="Accessories" hint="Only in the styled shot." multi options={ACCESSORIES}
            value={styling.accessories.split(",").map((x) => x.trim()).filter(Boolean)} onChange={(v) => setStyling((s) => ({ ...s, accessories: (v as string[]).join(", ") }))} />
          <Choices label="Sunglasses" hint="Only in the styled shot." options={SUNGLASSES} value={styling.sunglasses} onChange={(v) => setStyling((s) => ({ ...s, sunglasses: v as string }))} />
          <div className="max-w-md">
            <Field label="Production name (optional)" value={name} onChange={setName} placeholder="Defaults to the set names" />
          </div>
        </div>
      </Section>

      </div>
      <div hidden={step !== 4}>
      <Section title="Review" hint="Checked before anything is paid for.">
        {issues.length > 0 ? (
          <p className="text-danger">Resolve {issues.length} import {issues.length === 1 ? "decision" : "decisions"} in step 1 first.</p>
        ) : !draft ? (
          <p className="text-black/60">Add at least one product with a front packshot, a model and one shot.</p>
        ) : !preview || compiling ? (
          <div className="flex items-center gap-3 text-black/60"><Spinner size="sm" /> Checking…</div>
        ) : preview.error && !preview.conflicts ? (
          <p className="text-danger">{preview.error}</p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-3 border-y border-line">
              <div className="py-5"><div className="ow-eyebrow mb-1">Images</div><div className="ow-display text-3xl">{preview.images.length}</div></div>
              <div className="py-5 border-l border-line pl-6"><div className="ow-eyebrow mb-1 flex items-center gap-2">Estimated cost <InfoTip title="Estimated cost">About $0.16 per image. You pay again only when you ask for a new attempt of a rejected image.</InfoTip></div><div className="ow-display text-3xl">{usd(preview.estCostUsd)}</div></div>
              <div className="py-5 border-l border-line pl-6"><div className="ow-eyebrow mb-1">Budget left this month</div><div className={`ow-display text-3xl ${overBudget ? "text-danger" : ""}`}>{usd(preview.budgetRemainingUsd)}</div></div>
            </div>
            {[...errors, ...warnings].length > 0 && (
              <ul className="flex flex-col gap-2">
                {[...errors, ...warnings].map((c, i) => (
                  <li key={i} className="flex gap-3 items-start text-sm">
                    <Chip size="sm" color={c.severity === "error" ? "danger" : "warning"}>{c.severity === "error" ? "Blocks" : "Note"}</Chip>
                    <span>{c.sku ? <span className="ow-nav mr-2">{c.sku}</span> : null}{c.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.error && <p className="text-danger text-sm">{preview.error}</p>}
            {runError && <p className="text-danger text-sm">{runError}</p>}
            {overBudget && <p className="text-sm text-danger">Over the monthly budget</p>}
          </div>
        )}
      </Section>
      </div>

      {/* Always in view: status, back, next and run, so the page never has to be scrolled to go on. */}
      <div className="h-32" aria-hidden />
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line">
        <div className="max-w-[1440px] mx-auto safe-x pt-3 safe-bottom sm:pb-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <p className={`text-sm ${issues.length || (preview?.error && !preview?.conflicts) || overBudget ? "text-danger" : "text-black/70"}`} role="status">{barStatus}</p>
          <div className="flex gap-2 items-center">
            {step > 1 && <Button variant="ghost" onPress={() => goTo(step - 1)}>Back</Button>}
            {step < STEPS.length && (
              <Button variant={step === STEPS.length - 1 ? "primary" : "secondary"} className="flex-1 sm:flex-none" onPress={() => goTo(step + 1)}>Next: {STEPS[step]}</Button>
            )}
            <Button isDisabled={!preview?.canRun || overBudget || !draft} isPending={running} onPress={run}
              className={step === STEPS.length ? "flex-1 sm:flex-none" : "hidden sm:inline-flex"}>
              {productionId ? "Open production" : `Run production · ${preview?.images.length ?? 0} images`}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
