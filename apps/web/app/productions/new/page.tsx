"use client";

import { Button, Chip, Input, Label, ListBox, Select, Spinner, TextArea, TextField, ToggleButton } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { SLOTS, type Slot } from "@/lib/filename";
import {
  assetUrl, BRAND_SET, CATEGORIES, DEFAULT_MAKEUP, FLAGS, PRESET_LABELS, usd,
  type Category, type GarmentFlag, type PresetId,
} from "@/lib/types";

type Uploaded = { key: string; filename: string; hash?: string; width?: number; height?: number; sku: string; slot: Slot | null; error?: string; duplicateOf?: string };
type ProductInfo = { name: string; category: Category; color: string; description: string; flags: GarmentFlag[] };
type ModelRow = { modelId: string; version: number; status: string; data: { displayName: string; ageYears: number; heightCm: number; euSize: number; refs: { primaryPortrait: string } } };
type Preview = {
  canRun: boolean; estCostUsd: number; budgetRemainingUsd: number;
  conflicts: { code: string; severity: "error" | "warning"; message: string; sku?: string }[];
  images: { sku: string; preset: PresetId; poseId: string }[];
  error?: string;
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

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-12 border-t border-line grid md:grid-cols-[260px_1fr] gap-8">
      <div>
        <div className="ow-eyebrow mb-2">Step {n}</div>
        <h2 className="ow-display text-2xl mb-2">{title}</h2>
        {hint ? <p className="text-sm text-black/60 leading-relaxed">{hint}</p> : null}
      </div>
      <div>{children}</div>
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

export default function NewProductionPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [info, setInfo] = useState<Record<string, ProductInfo>>({});
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetId[]>(BRAND_SET);
  const [sessionAnchor, setSessionAnchor] = useState(true);
  const [styling, setStyling] = useState({
    // Empty = the model's own signature hair and makeup from her identity portrait.
    hairState: "",
    makeup: "",
    top: "a plain fitted black long-sleeve crew-neck top that ends at the waist",
    innerTop: "a plain fitted black crew-neck top",
    bottoms: "straight black tailored trousers",
    footwear: "black pointed-toe stiletto pumps",
    accessories: "small black evening bag carried by its handle",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d) => {
      const active = (d.models as ModelRow[]).filter((m) => m.status === "active");
      setModels(active);
      if (active[0]) setModel(`${active[0].modelId}@${active[0].version}`);
    });
  }, []);

  // ---------- Upload ----------
  const upload = useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => /\.(png|jpe?g|webp|tiff?)$/i.test(f.name));
    if (!arr.length) return;
    setUploading((n) => n + arr.length);
    for (let i = 0; i < arr.length; i += 6) {
      const form = new FormData();
      for (const f of arr.slice(i, i + 6)) form.append("files", f);
      const res = await fetch("/api/uploads", { method: "POST", body: form }).then((r) => r.json()).catch(() => ({ files: [] }));
      setFiles((prev) => {
        const next = [...prev];
        for (const f of res.files as Uploaded[]) {
          const dup = next.find((x) => x.hash && x.hash === f.hash);
          next.push({ ...f, key: `${f.filename}-${Math.random().toString(36).slice(2, 8)}`, ...(dup ? { duplicateOf: dup.filename } : {}) });
        }
        return next;
      });
      setUploading((n) => n - Math.min(6, arr.length - i));
    }
  }, []);

  const skus = useMemo(() => [...new Set(files.filter((f) => f.hash && !f.duplicateOf).map((f) => f.sku))].sort(), [files]);

  useEffect(() => {
    setInfo((prev) => {
      const next = { ...prev };
      for (const s of skus) if (!next[s]) next[s] = { name: s.replace(/[-_]+/g, " "), category: guessCategory(s), color: "black", description: "", flags: [] };
      return next;
    });
  }, [skus]);

  const update = (key: string, patch: Partial<Uploaded>) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const remove = (key: string) => setFiles((fs) => fs.filter((f) => f.key !== key));
  const setProduct = (sku: string, patch: Partial<ProductInfo>) => setInfo((i) => ({ ...i, [sku]: { ...i[sku]!, ...patch } }));

  // ---------- Draft + live preview ----------
  const draft = useMemo(() => {
    if (!model) return null;
    const [modelId, version] = model.split("@");
    const products = skus
      .map((sku) => {
        const own = files.filter((f) => f.sku === sku && f.hash && !f.duplicateOf);
        const packshots: Partial<Record<Slot, string>> = {};
        for (const s of SLOTS) {
          const f = own.find((x) => x.slot === s);
          if (f?.hash) packshots[s] = f.hash;
        }
        const i = info[sku];
        return i ? { sku, ...i, packshots } : null;
      })
      .filter((p): p is NonNullable<typeof p> => !!p && !!p.packshots.front);
    if (!products.length || !presets.length) return null;
    return {
      name: name || `${products.map((p) => p.sku).join(", ")}`.slice(0, 80),
      products, modelId, modelVersion: Number(version), presets, sessionAnchor,
      styling: {
        ...(styling.hairState.trim() ? { hairState: styling.hairState } : {}),
        ...(styling.makeup.trim() ? { makeup: styling.makeup } : {}),
        top: styling.top, innerTop: styling.innerTop,
        bottoms: styling.bottoms, footwear: styling.footwear,
        accessories: styling.accessories.split(",").map((s) => s.trim()).filter(Boolean),
      },
    };
  }, [model, skus, files, info, presets, styling, name, sessionAnchor]);

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
    if (!draft) return;
    setRunning(true);
    const r = await fetch("/api/productions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }).then((r) => r.json());
    setRunning(false);
    if (r.id) router.push(`/productions/${r.id}`);
    else setPreview((p) => (p ? { ...p, error: r.error, conflicts: r.conflicts ?? p.conflicts } : p));
  };

  const unassigned = files.filter((f) => !f.hash || f.duplicateOf || !f.slot);
  const errors = preview?.conflicts.filter((c) => c.severity === "error") ?? [];
  const warnings = preview?.conflicts.filter((c) => c.severity === "warning" && c.code !== "PROFILE_UNVERIFIED") ?? [];
  const overBudget = preview ? preview.estCostUsd > preview.budgetRemainingUsd : false;

  return (
    <>
      <PageTitle eyebrow="Create" title="New production" />

      <Section n={1} title="Packshots" hint="Drop files or a folder. Name them SKU_front, SKU_back, SKU_detail; anything else can be assigned by hand below.">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer border border-dashed ${dragOver ? "border-ink bg-meta" : "border-[#aaaaaa]"} py-16 text-center transition-colors`}
        >
          <p className="ow-display text-xl mb-1">Drop packshots here</p>
          <p className="text-sm text-black/60">PNG, JPEG or WebP, up to 25 MB each{uploading ? ` · uploading ${uploading}…` : ""}</p>
          <input ref={inputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>

        {skus.length > 0 && (
          <div className="mt-10 flex flex-col gap-10">
            {skus.map((sku) => {
              const own = files.filter((f) => f.sku === sku && f.hash && !f.duplicateOf);
              const p = info[sku];
              return (
                <div key={sku} className="grid lg:grid-cols-[1fr_1fr] gap-8">
                  <div>
                    <div className="flex items-baseline gap-3 mb-4">
                      <span className="ow-nav">{sku}</span>
                      {!own.some((f) => f.slot === "front") && <Chip color="danger" size="sm">Front missing</Chip>}
                      {own.filter((f) => f.slot === "front").length > 1 && <Chip color="warning" size="sm">Two fronts</Chip>}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {SLOTS.map((s) => {
                        const f = own.find((x) => x.slot === s);
                        return (
                          <div key={s}>
                            <Tile src={assetUrl(f?.hash, 240)} alt={`${sku} ${s}`} className={f ? "" : "border border-dashed border-[#cccccc] bg-white"}>
                              {f ? (
                                <button aria-label={`Remove ${s}`} onClick={() => remove(f.key)} className="absolute top-1 right-1 bg-white/90 text-xs px-1.5">✕</button>
                              ) : (
                                <span className="absolute inset-0 grid place-items-center ow-eyebrow">empty</span>
                              )}
                            </Tile>
                            <div className="ow-eyebrow mt-1.5">{s}</div>
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
        )}

        {unassigned.length > 0 && (
          <div className="mt-10 bg-meta p-5">
            <div className="ow-eyebrow mb-4">Needs a decision ({unassigned.length})</div>
            <div className="flex flex-col gap-3">
              {unassigned.map((f) => (
                <div key={f.key} className="grid grid-cols-[64px_1fr_auto] gap-4 items-center">
                  <Tile src={assetUrl(f.hash, 240)} alt={f.filename} />
                  <div className="text-sm">
                    <div className="truncate">{f.filename}</div>
                    <div className="text-black/60">
                      {f.error ?? (f.duplicateOf ? `Duplicate of ${f.duplicateOf}, ignored` : "Angle not recognised from the file name")}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {f.hash && !f.duplicateOf && (
                      <>
                        <Input aria-label="SKU" className="w-36" value={f.sku} onChange={(e) => update(f.key, { sku: e.target.value })} />
                        {SLOTS.map((s) => (
                          <Button key={s} size="sm" variant="secondary" onPress={() => update(f.key, { slot: s })}>{s}</Button>
                        ))}
                      </>
                    )}
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
          <Field label="Production name" value={name} onChange={setName} placeholder="e.g. SS27 drop 1" />
          <Field label="Hair (empty = model's own)" value={styling.hairState} onChange={(v) => setStyling((s) => ({ ...s, hairState: v }))} placeholder="Her signature hairstyle from the portrait" />
          <TextField value={styling.makeup} onChange={(v) => setStyling((s) => ({ ...s, makeup: v }))} className="md:col-span-2">
            <Label className="ow-eyebrow">Makeup (empty = model's own)</Label>
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
        {!draft ? (
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
            <div className="flex items-center gap-4">
              <Button size="lg" isDisabled={!preview.canRun || overBudget} isPending={running} onPress={run}>
                Run production · {preview.images.length} images
              </Button>
              {overBudget && <span className="text-sm text-danger">Over the monthly budget</span>}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
