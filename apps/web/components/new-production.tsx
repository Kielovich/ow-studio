"use client";

import { Button, Chip, Input, Label, ListBox, Select, Spinner, TextArea, TextField, ToggleButton } from "@heroui/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import {
  DEFAULT_SKU_PATTERN, importIssues, isValidPattern, packshotsBySku, parseFile, ROLES, usable,
  type ImportFile, type ImportIssue, type Role, type Source,
} from "@/lib/import";
import {
  assetUrl, BRAND_SET, CATEGORIES, DEFAULT_MAKEUP, FLAGS, PRESET_LABELS, usd,
  type Category, type GarmentFlag, type PresetId,
} from "@/lib/types";

type ProductInfo = { name: string; category: Category; color: string; description: string; flags: GarmentFlag[] };
type ModelRow = { modelId: string; version: number; status: string; data: { displayName: string; ageYears: number; heightCm: number; euSize: number; refs: { primaryPortrait: string } } };
type Preview = {
  canRun: boolean; estCostUsd: number; budgetRemainingUsd: number;
  conflicts: { code: string; severity: "error" | "warning"; message: string; sku?: string }[];
  images: { sku: string; preset: PresetId; poseId: string }[];
  error?: string;
};
type Styling = { hairState: string; makeup: string; top: string; innerTop: string; bottoms: string; footwear: string; accessories: string };
/** Everything the import session saves on the server. */
type Session = {
  name: string; files: ImportFile[]; info: Record<string, ProductInfo>; model: string | null; presets: PresetId[]; sessionAnchor: boolean;
  styling: Styling; skuPattern: string; createKey: string | null;
};
type DraftSummary = { id: string; name: string | null; files: number; productionId: string | null; updatedAt: string };

const DEFAULT_STYLING: Styling = {
  // Empty = the model's own signature hair and makeup from her identity portrait.
  hairState: "",
  makeup: "",
  top: "a plain fitted black long-sleeve crew-neck top that ends at the waist",
  innerTop: "a plain fitted black crew-neck top",
  bottoms: "straight black tailored trousers",
  footwear: "black pointed-toe stiletto pumps",
  accessories: "small black evening bag carried by its handle",
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

const SOURCE_LABEL: Record<Source, string> = { filename: "from name", folder: "from folder", manual: "set by hand" };

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

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-12 border-t border-line grid md:grid-cols-[260px_1fr] gap-8">
      <div>
        <div className="ow-eyebrow mb-2">Step {n}</div>
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

function SourceTag({ source }: { source: Source | null }) {
  if (!source) return null;
  return <span className={`text-[10px] uppercase tracking-wide ${source === "manual" ? "text-ink" : "text-black/50"}`}>{SOURCE_LABEL[source]}</span>;
}

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
  const upload = useCallback(async (list: { file: File; path: string }[]) => {
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
            ...parseFile(path, skuPattern), key: randomId("f_"),
            ...(f.hash ? { hash: f.hash } : {}), ...(f.error ? { error: f.error } : {}), ...(dup ? { duplicateOf: dup.path } : {}),
          });
        });
        return next;
      });
      setUploading((n) => n - chunk.length);
    }
  }, [skuPattern]);

  /** Re-reads names with a new SKU pattern. Decisions made by hand are kept. */
  const applyPattern = (pattern: string) => {
    setSkuPattern(pattern);
    if (!isValidPattern(pattern)) return;
    setFiles((fs) => fs.map((f) => {
      const p = parseFile(f.path, pattern);
      return {
        ...f,
        ...(f.skuSource === "manual" ? {} : { sku: p.sku, skuSource: p.skuSource }),
        ...(f.roleSource === "manual" ? {} : { role: p.role, roleSource: p.roleSource }),
      };
    }));
  };

  const issues = useMemo(() => importIssues(files), [files]);
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
        next[s] = { name: s, category: hint ?? guessCategory(s), color: "black", description: "", flags: [] };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [skus, files]);

  const update = (key: string, patch: Partial<ImportFile>) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
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
        return i && p?.front ? { sku, ...i, name: i.name || sku, packshots: p } : null;
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (!products.length || !presets.length) return null;
    const setNames = [...new Set(files.filter(usable).map((f) => f.set).filter(Boolean))];
    return {
      name: name || (setNames.length ? setNames.join(", ") : products.map((p) => p.sku).join(", ")).slice(0, 80),
      products, modelId: modelId!, modelVersion: Number(version), presets, sessionAnchor,
      styling: {
        ...(styling.hairState.trim() ? { hairState: styling.hairState } : {}),
        ...(styling.makeup.trim() ? { makeup: styling.makeup } : {}),
        top: styling.top, innerTop: styling.innerTop,
        bottoms: styling.bottoms, footwear: styling.footwear,
        accessories: styling.accessories.split(",").map((s) => s.trim()).filter(Boolean),
      },
    };
  }, [model, issues.length, skus, info, packshots, presets, files, name, sessionAnchor, styling]);

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

  const extras = files.filter((f) => !usable(f) || f.ignored);
  const errors = preview?.conflicts.filter((c) => c.severity === "error") ?? [];
  const warnings = preview?.conflicts.filter((c) => c.severity === "warning" && c.code !== "PROFILE_UNVERIFIED") ?? [];
  const overBudget = preview ? preview.estCostUsd > preview.budgetRemainingUsd : false;

  const decisionRow = (f: ImportFile, note: string) => (
    <div key={f.key} className="grid grid-cols-[64px_1fr] md:grid-cols-[64px_1fr_auto] gap-4 items-center">
      <Tile src={assetUrl(f.hash, 240)} alt={f.filename} />
      <div className="text-sm min-w-0">
        <div className="truncate">{f.path}</div>
        <div className="text-black/60">{note}</div>
      </div>
      <div className="flex flex-wrap gap-2 items-center col-span-2 md:col-span-1">
        <Input aria-label="SKU" placeholder="SKU" className="w-36" value={f.sku ?? ""} onChange={(e) => update(f.key, { sku: e.target.value.trim().toUpperCase() || null, skuSource: "manual" })} />
        {ROLES.map((r) => (
          <Button key={r} size="sm" variant={f.role === r ? "primary" : "secondary"} onPress={() => update(f.key, { role: r, roleSource: "manual" })}>{r}</Button>
        ))}
        <Button size="sm" variant="ghost" onPress={() => update(f.key, { ignored: true })}>Ignore</Button>
      </div>
    </div>
  );

  const issueView = (i: ImportIssue, n: number) => {
    if (i.code === "NEEDS_DECISION") {
      const f = byKey(i.key);
      return f ? decisionRow(f, `${i.missing.map((m) => (m === "sku" ? "SKU" : "angle")).join(" and ")} not recognised`) : null;
    }
    if (i.code === "ROLE_TAKEN") {
      return (
        <div key={`rt${n}`}>
          <div className="text-sm mb-2"><span className="ow-nav mr-2">{i.sku}</span>{i.keys.length} files for <b>{i.role}</b>. Choose one; the others are ignored.</div>
          <div className="flex flex-wrap gap-3">
            {i.keys.map((k) => {
              const f = byKey(k);
              return f ? (
                <div key={k} className="w-32">
                  <Tile src={assetUrl(f.hash, 240)} alt={f.filename} />
                  <div className="text-[11px] truncate mt-1" title={f.path}>{f.filename}</div>
                  <Button size="sm" variant="secondary" className="mt-1 w-full" onPress={() => keepOnly(k, i.keys)}>Use this</Button>
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
        {savedAt && <span className="text-xs text-black/50 self-center">Import saved {new Date(savedAt + "Z").toLocaleTimeString()}</span>}
      </PageTitle>

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
                  <span className="text-black/50">{new Date(d.updatedAt + "Z").toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section n={1} title="Packshots" hint="Drop a folder per look: the folder becomes the set. SKU and angle are read from names like AB123-045_top-front.jpg, and every guess shows where it came from.">
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

        <details className="mt-4 text-sm">
          <summary className="ow-eyebrow cursor-pointer">SKU pattern</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <TextField value={skuPattern} onChange={applyPattern} className="w-80">
              <Label className="ow-eyebrow">Regular expression</Label>
              <Input className="font-mono" />
            </TextField>
            <Button size="sm" variant="ghost" onPress={() => applyPattern(DEFAULT_SKU_PATTERN)}>Reset</Button>
            {!isValidPattern(skuPattern) && <span className="text-danger">Not a valid pattern</span>}
          </div>
          <p className="text-black/60 mt-2">Default matches style numbers like AB123 or AB123-045. Changing it re-reads every name; choices made by hand are kept.</p>
        </details>

        {issues.length > 0 && (
          <div className="mt-8 border border-ink p-5">
            <div className="flex items-center gap-3 mb-4">
              <Chip color="danger" size="sm">Blocks run</Chip>
              <span className="ow-eyebrow">Needs a decision ({issues.length})</span>
            </div>
            <div className="flex flex-col gap-5">{issues.map(issueView)}</div>
          </div>
        )}

        {sets.length > 0 && (
          <div className="mt-10 flex flex-col gap-12">
            {sets.map(([set, setSkus]) => (
              <div key={set}>
                <div className="flex items-baseline gap-3 border-b border-line pb-2 mb-6">
                  <span className="ow-display text-xl">{set}</span>
                  <span className="text-sm text-black/50">{setSkus.length} {setSkus.length === 1 ? "product" : "products"}</span>
                </div>
                <div className="flex flex-col gap-10">
                  {setSkus.map((sku) => {
                    const own = files.filter((f) => usable(f) && f.sku === sku);
                    const p = info[sku];
                    return (
                      <div key={sku} className="grid lg:grid-cols-[1fr_1fr] gap-8">
                        <div>
                          <div className="flex items-baseline gap-3 mb-4">
                            <span className="ow-nav">{sku}</span>
                            <SourceTag source={own[0]?.skuSource ?? null} />
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {ROLES.map((r: Role) => {
                              const here = own.filter((x) => x.role === r);
                              const f = here[0];
                              return (
                                <div key={r}>
                                  <Tile src={assetUrl(f?.hash, 240)} alt={`${sku} ${r}`} className={here.length > 1 ? "outline outline-2 outline-danger" : f ? "" : "border border-dashed border-[#cccccc] bg-white"}>
                                    {f ? (
                                      <button aria-label={`Remove ${r}`} onClick={() => update(f.key, { ignored: true })} className="absolute top-1 right-1 bg-white/90 text-xs px-1.5">✕</button>
                                    ) : (
                                      <span className="absolute inset-0 grid place-items-center ow-eyebrow">empty</span>
                                    )}
                                    {here.length > 1 && <span className="absolute bottom-1 left-1 bg-white/90 text-[10px] px-1">{here.length} files</span>}
                                  </Tile>
                                  <div className="ow-eyebrow mt-1.5">{r}</div>
                                  {f && <SourceTag source={f.roleSource} />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {p && (
                          <div className="grid grid-cols-2 gap-4 content-start">
                            <Field label="Name" value={p.name} onChange={(v) => setProduct(sku, { name: v })} />
                            <Select value={p.category} onChange={(v) => v && setProduct(sku, { category: v as Category })} className="w-full">
                              <Label className="ow-eyebrow">Category</Label>
                              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {CATEGORIES.map((c) => (
                                    <ListBox.Item key={c} id={c} textValue={c}>{c}<ListBox.ItemIndicator /></ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                            <Field label="Colour" value={p.color} onChange={(v) => setProduct(sku, { color: v })} />
                            <div />
                            <TextField value={p.description} onChange={(v) => setProduct(sku, { description: v })} className="col-span-2">
                              <Label className="ow-eyebrow">Construction (helps fidelity)</Label>
                              <TextArea rows={2} placeholder="e.g. strapless A-line mini dress in black sequins, straight neckline, back zip" />
                            </TextField>
                            <div className="col-span-2">
                              <div className="ow-eyebrow mb-2">Construction flags</div>
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
                        )}
                      </div>
                    );
                  })}
                </div>
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
                      {f.error ?? (f.duplicateOf ? `Same image as ${f.duplicateOf}` : f.ignored ? "Ignored" : f.kind === "accessory" ? `Accessory${f.sku ? ` ${f.sku}` : ""}: kept, not sent. Describe it under Styling.` : "")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {f.ignored && <Button size="sm" variant="secondary" onPress={() => update(f.key, { ignored: false })}>Use again</Button>}
                    {!f.ignored && f.kind === "accessory" && f.hash && <Button size="sm" variant="secondary" onPress={() => update(f.key, { kind: "garment" })}>It is a garment</Button>}
                    <Button size="sm" variant="ghost" onPress={() => remove(f.key)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section n={2} title="Model" hint="Only active model versions can be used. A production keeps the exact version it was created with.">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {models.map((m) => {
            const id = `${m.modelId}@${m.version}`;
            const selected = id === model;
            return (
              <button key={id} onClick={() => setModel(id)} className={`text-left ${selected ? "" : "opacity-60 hover:opacity-100"}`}>
                <Tile src={assetUrl(m.data.refs.primaryPortrait, 480)} alt={m.data.displayName} className={selected ? "outline outline-1 outline-ink outline-offset-4" : ""} />
                <div className="ow-nav mt-3">{m.data.displayName} <span className="text-black/50">v{m.version}</span></div>
                <div className="text-sm text-black/60">{m.data.heightCm} cm · EU {m.data.euSize}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section n={3} title="Shots" hint="The brand set: front, three-quarter, back, styled and close-up, all framed like the brand's gallery.">
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
            <div className="ow-nav mb-1">One studio session</div>
            <p className="text-sm text-black/60 leading-relaxed">
              The front is generated first. Once it has passed, it is sent with the other shots as the session reference for light, hair,
              makeup and how the garment sits, so the set reads as one shoot. The face still follows the identity portrait and every garment
              detail still follows the packshots.{!presets.includes("full_body") ? " Needs the Front shot." : ""}
            </p>
          </div>
        </div>
      </Section>

      <Section n={4} title="Styling" hint="Hair, makeup and the pieces worn with the product. Accessories appear only in the styled shot.">
        <div className="grid md:grid-cols-2 gap-5">
          <Field label="Production name" value={name} onChange={setName} placeholder="Defaults to the set names" />
          <Field label="Hair (empty = model's own)" value={styling.hairState} onChange={(v) => setStyling((s) => ({ ...s, hairState: v }))} placeholder="Her signature hairstyle from the portrait" />
          <TextField value={styling.makeup} onChange={(v) => setStyling((s) => ({ ...s, makeup: v }))} className="md:col-span-2">
            <Label className="ow-eyebrow">Makeup (empty = model&apos;s own)</Label>
            <TextArea rows={2} placeholder={`Her clean-glam look from the portrait. Example override: ${DEFAULT_MAKEUP}`} />
          </TextField>
          <Field label="Top (with bottoms)" value={styling.top} onChange={(v) => setStyling((s) => ({ ...s, top: v }))} />
          <Field label="Under outerwear" value={styling.innerTop} onChange={(v) => setStyling((s) => ({ ...s, innerTop: v }))} />
          <Field label="Bottoms (with tops)" value={styling.bottoms} onChange={(v) => setStyling((s) => ({ ...s, bottoms: v }))} />
          <Field label="Footwear" value={styling.footwear} onChange={(v) => setStyling((s) => ({ ...s, footwear: v }))} />
          <Field label="Accessories, comma separated" value={styling.accessories} onChange={(v) => setStyling((s) => ({ ...s, accessories: v }))} />
        </div>
      </Section>

      <Section n={5} title="Review" hint="Checked before anything is paid for. Blocking problems disable Run.">
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
              <div className="py-5 border-l border-line pl-6"><div className="ow-eyebrow mb-1">Estimated cost</div><div className="ow-display text-3xl">{usd(preview.estCostUsd)}</div></div>
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
            <div className="flex items-center gap-4">
              <Button size="lg" isDisabled={!preview.canRun || overBudget} isPending={running} onPress={run}>
                {productionId ? "Open production" : `Run production · ${preview.images.length} images`}
              </Button>
              {overBudget && <span className="text-sm text-danger">Over the monthly budget</span>}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
