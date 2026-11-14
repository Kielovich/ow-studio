"use client";

import { Chip, Modal, Skeleton } from "@heroui/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { getJson, isNotFound } from "@/lib/client";
import { assetUrl } from "@/lib/types";

export type ModelRow = {
  modelId: string; version: number; status: string; createdAt: string;
  data: { displayName: string; ageYears: number; heightCm: number; euSize: number; look: Record<string, string>; refs: Record<string, string | string[]> };
};

const REF_LABELS: Record<string, string> = {
  primaryPortrait: "Identity portrait", fullBodyFront: "Body, front", fullBodyBack: "Body, back", characterSheet: "Character sheet", facialDetailSheet: "Facial detail",
};

/** Every reference image of one version, labelled, without duplicates (some versions reuse the portrait). */
function refsOf(v: ModelRow) {
  const seen = new Set<string>();
  const out: { key: string; label: string; hash: string }[] = [];
  const add = (key: string, label: string, hash: unknown) => {
    if (typeof hash !== "string" || !hash || seen.has(hash)) return;
    seen.add(hash);
    out.push({ key, label, hash });
  };
  for (const [k, label] of Object.entries(REF_LABELS)) add(k, label, v.data.refs[k]);
  ((v.data.refs.identityAngles as string[]) ?? []).forEach((h, i) => add(`angle${i}`, i === 0 ? "Three-quarter" : "Profile", h));
  return out;
}

/** The version a model is shown with: the active one, else the newest. */
function currentVersions(models: ModelRow[]) {
  const by = new Map<string, ModelRow[]>();
  for (const m of models) by.set(m.modelId, [...(by.get(m.modelId) ?? []), m]);
  return [...by.entries()].map(([id, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    return { id, current: sorted.find((v) => v.status === "active") ?? sorted[0]!, versions: sorted };
  });
}

const facts = (v: ModelRow) => `${v.data.ageYears} · ${v.data.heightCm} cm · EU ${v.data.euSize}`;

function useModels() {
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    getJson<{ models: ModelRow[] }>("/api/models")
      .then((d) => { if (!isNotFound(d)) setModels(d.models); })
      .catch(() => setOffline(true));
  }, []);
  return { models, offline };
}

/** /models: one card per model, portrait and name. */
export function ModelOverview() {
  const { models, offline } = useModels();
  const list = useMemo(() => currentVersions(models ?? []), [models]);
  return (
    <>
      <PageTitle eyebrow="Library" title="Models" />
      {offline && <p className="text-warning text-sm mb-6" role="status">Cannot reach the studio. Reload to try again.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
        {!models
          ? Array.from({ length: 8 }, (_, i) => <div key={i}><Skeleton className="aspect-square w-full mb-3" /><Skeleton className="h-5 w-24" /></div>)
          : list.map(({ id, current }) => (
            <Link key={id} href={`/models/${id}`} className="group" data-testid="model-card">
              <Tile src={assetUrl(current.data.refs.primaryPortrait as string, 480)} alt={current.data.displayName} className="mb-3 group-hover:opacity-90 transition-opacity" />
              <div className="ow-display text-2xl leading-tight">{current.data.displayName}</div>
              <div className="text-sm text-black/60 mt-1">{facts(current)}</div>
            </Link>
          ))}
      </div>
      <p className="text-sm text-black/60 mt-12 max-w-2xl">
        Open a model to see all her reference images and earlier versions. Versions are immutable: productions always keep the version they were made with.
      </p>
    </>
  );
}

/** /models/[id]: every reference image of the current version, facts, and earlier versions folded away. */
export function ModelDetail() {
  const { id } = useParams<{ id: string }>();
  const { models, offline } = useModels();
  const [viewer, setViewer] = useState<{ hash: string; label: string } | null>(null);
  const model = useMemo(() => currentVersions(models ?? []).find((m) => m.id === id) ?? null, [models, id]);

  if (offline) return <div className="pt-24 max-w-lg"><h1 className="ow-display text-3xl mb-3">Cannot reach the studio</h1><p className="text-black/60">Reload to try again.</p></div>;
  if (!models) return <div className="pt-12"><Skeleton className="h-12 w-64 mb-10" /><Skeleton className="aspect-[3/1] w-full" /></div>;
  if (!model) return (
    <div className="pt-24 max-w-lg">
      <div className="ow-eyebrow mb-3">Model</div>
      <h1 className="ow-display text-4xl mb-4">Not found</h1>
      <p className="text-black/60 mb-8">This model does not exist.</p>
      <LinkButton href="/models">All models</LinkButton>
    </div>
  );

  const v = model.current;
  const look = v.data.look;
  const rows: [string, string | undefined][] = [
    ["Age", String(v.data.ageYears)], ["Height", `${v.data.heightCm} cm`], ["EU size", String(v.data.euSize)],
    ["Hair", look.hair], ["Eyes", look.eyes], ["Skin tone", look.skinTone], ["Features", look.features],
  ];
  const earlier = model.versions.filter((x) => x.version !== v.version);

  return (
    <>
      <Link href="/models" className="ow-nav inline-block pt-8 text-black/60 hover:text-ink">← All models</Link>
      <PageTitle eyebrow={`${model.id} · Version ${v.version}`} title={v.data.displayName}>
        <Chip size="sm" color={v.status === "active" ? "success" : "default"}>{v.status}</Chip>
      </PageTitle>

      <div className="grid lg:grid-cols-[1fr_320px] gap-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {refsOf(v).map((r) => (
            <button key={r.key} type="button" className="text-left" onClick={() => setViewer({ hash: r.hash, label: r.label })}>
              <Tile src={assetUrl(r.hash, 480)} alt={r.label} fit={r.key === "characterSheet" ? "contain" : "cover"} />
              <div className="ow-eyebrow mt-2">{r.label}</div>
            </button>
          ))}
        </div>
        <dl className="border-t border-line text-sm self-start">
          {rows.filter(([, val]) => val).map(([k, val]) => (
            <div key={k} className="py-3 border-b border-line grid grid-cols-[96px_1fr] gap-3">
              <dt className="ow-eyebrow pt-0.5">{k}</dt>
              <dd className="min-w-0 break-words">{val}</dd>
            </div>
          ))}
        </dl>
      </div>

      {earlier.length > 0 && (
        <details className="mt-14 border-t border-line pt-6">
          <summary className="ow-nav cursor-pointer">Earlier versions ({earlier.length})</summary>
          <div className="flex flex-col gap-8 mt-6">
            {earlier.map((e) => (
              <div key={e.version}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="ow-nav">Version {e.version}</span>
                  <Chip size="sm">{e.status}</Chip>
                  <span className="text-sm text-black/50">{new Date(e.createdAt + "Z").toLocaleDateString()}</span>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {refsOf(e).map((r) => (
                    <button key={r.key} type="button" onClick={() => setViewer({ hash: r.hash, label: `${r.label} · version ${e.version}` })}>
                      <Tile src={assetUrl(r.hash, 240)} alt={r.label} fit={r.key === "characterSheet" ? "contain" : "cover"} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-black/60 mt-6 max-w-2xl">Versions are immutable. A new look or new references create a new version; productions keep the version they were made with.</p>
        </details>
      )}

      <Modal.Backdrop isOpen={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
        <Modal.Container size="full">
          <Modal.Dialog className="bg-white">
            <Modal.CloseTrigger />
            {viewer && (
              <>
                <Modal.Header><Modal.Heading className="ow-display text-2xl">{v.data.displayName} · {viewer.label}</Modal.Heading></Modal.Header>
                <Modal.Body>
                  <div className="bg-canvas flex justify-center">
                    <img src={assetUrl(viewer.hash, 1200)} alt={viewer.label} className="block max-w-full w-auto h-auto max-h-[80vh]" />
                  </div>
                </Modal.Body>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
