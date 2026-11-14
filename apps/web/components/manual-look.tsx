"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InfoTip } from "@/components/help";
import { parseFile, type FileKind, type ImportFile, type Role } from "@/lib/import";
import type { Category } from "@/lib/types";

export type ManualItem = { file: File; path: string; override: Partial<ImportFile> };

const TOP_CATEGORIES: Category[] = ["top", "bodysuit", "knit", "jacket", "coat", "dress"];
const BOTTOM_CATEGORIES: Category[] = ["trousers", "skirt", "shorts"];
type Garment = { sku: string; category: Category; front: File | null; back: File | null };
const slug = (s: string) => s.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "LOOK";

/** One square slot: tap to choose an image, shows it, can be cleared. */
function Slot({ label, file, onPick, onClear, testId }: { label: string; file: File | null; onPick: (f: File) => void; onClear: () => void; testId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <div className="relative">
      <button type="button" data-testid={testId} onClick={() => input.current?.click()}
        className={`relative block w-full aspect-square overflow-hidden ${file ? "bg-canvas" : "border border-dashed border-[#aaaaaa] hover:border-ink"}`}>
        {url ? <img src={url} alt={label} className="absolute inset-0 w-full h-full object-cover" />
          : <span className="absolute inset-0 flex flex-col items-center justify-center text-center px-1"><span className="text-xl leading-none">+</span><span className="ow-eyebrow mt-1">{label}</span></span>}
      </button>
      {file && (
        <>
          <span className="absolute top-1 left-1 bg-white/90 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{label}</span>
          <button type="button" aria-label={`Remove ${label}`} onClick={onClear} className="absolute top-1 right-1 w-7 h-7 bg-white/90 grid place-items-center text-sm">×</button>
        </>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </div>
  );
}

function CategorySelect({ value, options, onChange, label }: { value: Category; options: Category[]; onChange: (c: Category) => void; label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="ow-eyebrow">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Category)} className="border border-line bg-white h-10 px-2 capitalize">
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}

/**
 * Upload a look by hand: each image goes into its own slot, so nothing depends on file names. Produces the same import
 * files as a folder import (set = look name, SKU and angle set by hand), so everything after this step is shared.
 */
export function ManualLook({ onAdd, lookCount, busy }: { onAdd: (items: ManualItem[]) => Promise<void>; lookCount: number; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [look, setLook] = useState("");
  const [top, setTop] = useState<Garment>({ sku: "", category: "top", front: null, back: null });
  const [bottom, setBottom] = useState<Garment>({ sku: "", category: "trousers", front: null, back: null });
  const patchTop = (p: Partial<Garment>) => setTop((x) => ({ ...x, ...p }));
  const patchBottom = (p: Partial<Garment>) => setBottom((x) => ({ ...x, ...p }));
  const [shoes, setShoes] = useState<File | null>(null);
  const [accessories, setAccessories] = useState<(File | null)[]>([null, null, null]);
  const [fit, setFit] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLook(""); setTop({ sku: "", category: "top", front: null, back: null }); setBottom({ sku: "", category: "trousers", front: null, back: null });
    setShoes(null); setAccessories([null, null, null]); setFit(null); setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!top.front && !bottom.front) { setError("Add at least one front packshot (top or bottom)."); return; }
    if (top.back && !top.front) { setError("The top needs a front packshot too."); return; }
    if (bottom.back && !bottom.front) { setError("The bottom needs a front packshot too."); return; }
    const name = look.trim() || `Look ${lookCount + 1}`;
    const set = name;
    const skuFor = (g: Garment, fallback: string) => slug(g.sku) !== "LOOK" ? slug(g.sku) : parseFile(g.front!.name).sku ?? `${slug(name)}-${fallback}`;
    const items: ManualItem[] = [];
    const garment = (g: Garment, fallback: string) => {
      if (!g.front) return;
      const sku = skuFor(g, fallback);
      for (const role of ["front", "back"] as Role[]) {
        const file = g[role as "front" | "back"];
        if (file) items.push({ file, path: `${set}/${file.name}`, override: { set, sku, skuSource: "manual", role, roleSource: "manual", kind: "garment", category: g.category } });
      }
    };
    garment(top, "TOP");
    garment(bottom, "BOTTOM");
    const extra = (file: File | null, kind: FileKind) => { if (file) items.push({ file, path: `${set}/${file.name}`, override: { set, sku: null, skuSource: null, role: null, roleSource: null, kind, category: null } }); };
    extra(shoes, "footwear");
    accessories.forEach((a) => extra(a, "accessory"));
    extra(fit, "fit");
    await onAdd(items);
    reset();
    setOpen(false);
  };

  if (!open) return (
    <div className="mt-4">
      <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>Add a look by hand</Button>
    </div>
  );

  return (
    <div className="mt-6 border border-ink p-4 sm:p-6" data-testid="manual-look">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="ow-display text-xl">Add a look by hand</div>
        <Button size="sm" variant="ghost" onPress={() => { reset(); setOpen(false); }}>Cancel</Button>
      </div>
      <TextField value={look} onChange={setLook} className="mb-6 max-w-sm">
        <Label className="ow-eyebrow">Look name</Label>
        <Input placeholder={`Look ${lookCount + 1}`} />
      </TextField>

      {([["Top", top, patchTop, TOP_CATEGORIES, "top"], ["Bottom", bottom, patchBottom, BOTTOM_CATEGORIES, "bottom"]] as const).map(([title, g, patch, cats, id]) => (
        <div key={title} className="mb-6">
          <div className="ow-nav mb-3">{title}</div>
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(2,120px)_1fr_1fr] gap-3 items-end">
            <Slot label="Front" testId={`slot-${id}-front`} file={g.front} onPick={(f) => patch({ front: f })} onClear={() => patch({ front: null })} />
            <Slot label="Back" testId={`slot-${id}-back`} file={g.back} onPick={(f) => patch({ back: f })} onClear={() => patch({ back: null })} />
            <TextField value={g.sku} onChange={(v) => patch({ sku: v })}>
              <Label className="ow-eyebrow">Style number</Label>
              <Input placeholder="From the file name" />
            </TextField>
            <CategorySelect label="Type" value={g.category} options={[...cats]} onChange={(c) => patch({ category: c })} />
          </div>
        </div>
      ))}

      <div className="grid grid-cols-3 sm:grid-cols-[repeat(5,120px)] gap-3 mb-2">
        <div>
          <div className="ow-nav mb-3">Shoes</div>
          <Slot label="Shoes" testId="slot-shoes" file={shoes} onPick={setShoes} onClear={() => setShoes(null)} />
        </div>
        <div className="col-span-3 sm:col-span-3">
          <div className="ow-nav mb-3">Accessories</div>
          <div className="grid grid-cols-3 gap-3">
            {accessories.map((a, i) => (
              <Slot key={i} label={`Item ${i + 1}`} testId={`slot-accessory-${i}`} file={a}
                onPick={(f) => setAccessories((xs) => xs.map((x, j) => (j === i ? f : x)))} onClear={() => setAccessories((xs) => xs.map((x, j) => (j === i ? null : x)))} />
            ))}
          </div>
        </div>
        <div>
          <div className="ow-nav mb-3 flex items-center gap-2">Fit
            <InfoTip title="Fit reference">A photo that shows how the look should sit on the body: length, looseness, where the waist and hems sit. The top of the photo (the head) is cut away before it is used, and the person in it is ignored.</InfoTip>
          </div>
          <Slot label="Fit" testId="slot-fit" file={fit} onPick={setFit} onClear={() => setFit(null)} />
        </div>
      </div>
      <p className="text-xs text-black/60 mb-5">Shoes appear where the feet are in the picture. Accessories appear only in the styled shot.</p>

      {error && <p className="text-danger text-sm mb-3" role="alert">{error}</p>}
      <Button onPress={submit} isPending={busy}>Add look</Button>
    </div>
  );
}
