"use client";

import { Button, Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJson, isNotFound } from "@/lib/client";
import { assetUrl, PRESET_LABELS, type PresetId } from "@/lib/types";

type Data = { current: string | null; candidates: { hash: string; production: string; preset: string }[] };

/** Settings: which approved image shows on the overview's Ecom panel (a model portrait until one is chosen). */
export function HomeImagePicker() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => { getJson<Data>("/api/settings/home-image").then((d) => { if (!isNotFound(d)) setData(d); }).catch(() => setError("Could not load the images.")); }, []);

  const choose = async (hash: string | null) => {
    setSaving(hash ?? "portrait");
    setError(null);
    const r = await fetch("/api/settings/home-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection to the studio. Try again." }));
    setSaving(null);
    if (r.error) setError(r.error);
    else setData((d) => (d ? { ...d, current: r.current } : d));
  };

  if (!data) return error ? <p className="text-sm text-danger">{error}</p> : <Skeleton className="h-40 w-full max-w-3xl rounded-none" />;
  return (
    <div className="max-w-3xl">
      {data.candidates.length === 0 ? (
        <p className="text-sm text-black/60">No approved images yet. Approve an image in a production, and it can be the Ecom picture on the overview. Until then a model portrait is shown.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {data.candidates.map((c) => {
              const on = data.current === c.hash;
              return (
                <button key={c.hash} type="button" aria-pressed={on} onClick={() => choose(c.hash)} disabled={!!saving}
                  aria-label={`${c.production}, ${PRESET_LABELS[c.preset as PresetId] ?? c.preset}`}
                  className={`relative block aspect-square bg-canvas overflow-hidden text-left ${on ? "outline outline-2 outline-ink outline-offset-2" : "hover:opacity-90"}`}>
                  <img src={assetUrl(c.hash, 480)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  {on && <span className="absolute top-1.5 left-1.5 bg-ink text-white ow-nav px-2 py-1">✓ Shown</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" isDisabled={data.current === null} isPending={saving === "portrait"} onPress={() => choose(null)}>Use a model portrait</Button>
            <Link href="/" className="text-sm underline underline-offset-4 inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-7">See the overview</Link>
          </div>
        </>
      )}
      {error && <p className="text-sm text-danger mt-3" role="alert">{error}</p>}
    </div>
  );
}
