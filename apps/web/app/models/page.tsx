"use client";

import { Chip, Skeleton } from "@heroui/react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { assetUrl } from "@/lib/types";

type ModelRow = {
  modelId: string; version: number; status: string; createdAt: string;
  data: { displayName: string; ageYears: number; heightCm: number; euSize: number; look: Record<string, string>; refs: Record<string, string | string[]> };
};

const REF_LABELS: Record<string, string> = {
  primaryPortrait: "Identity portrait", fullBodyFront: "Body, front", fullBodyBack: "Body, back", characterSheet: "Character sheet", facialDetailSheet: "Facial detail",
};

export default function ModelsPage() {
  const [models, setModels] = useState<ModelRow[] | null>(null);
  useEffect(() => { fetch("/api/models").then((r) => r.json()).then((d) => setModels(d.models)); }, []);

  const groups = new Map<string, ModelRow[]>();
  for (const m of models ?? []) groups.set(m.modelId, [...(groups.get(m.modelId) ?? []), m]);

  return (
    <>
      <PageTitle eyebrow="Library" title="Models" />
      {!models ? <Skeleton className="h-96 w-full" /> : [...groups.entries()].map(([id, versions]) => (
        <section key={id} className="border-t border-line py-10">
          <div className="flex items-baseline gap-4 mb-8">
            <h2 className="ow-display text-3xl">{versions[0]!.data.displayName}</h2>
            <span className="ow-eyebrow">{id} · {versions[0]!.data.ageYears} · {versions[0]!.data.heightCm} cm · EU {versions[0]!.data.euSize}</span>
          </div>
          <div className="flex flex-col gap-10">
            {versions.map((v) => (
              <div key={v.version}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="ow-nav">Version {v.version}</span>
                  <Chip size="sm" color={v.status === "active" ? "success" : "default"}>{v.status}</Chip>
                  <span className="text-sm text-black/50">{new Date(v.createdAt + "Z").toLocaleDateString()}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {[
                    ...Object.entries(REF_LABELS)
                      .filter(([k]) => k === "primaryPortrait" || v.data.refs[k] !== v.data.refs.primaryPortrait)
                      .map(([k, label]) => ({ key: k, label, hash: v.data.refs[k] as string })),
                    ...((v.data.refs.identityAngles as string[]) ?? []).map((h, i) => ({ key: `angle${i}`, label: i === 0 ? "Three-quarter" : "Profile", hash: h })),
                  ].map((r) => (
                    <div key={r.key}>
                      <Tile src={assetUrl(r.hash, 480)} alt={r.label} />
                      <div className="ow-eyebrow mt-2">{r.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-black/60 mt-8 max-w-2xl">
            Versions are immutable. A new look (makeup, hair) or new references create a new version; productions always keep the version they were made with.
          </p>
        </section>
      ))}
    </>
  );
}
