"use client";

import { Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { assetUrl, usd } from "@/lib/types";

type Overview = {
  active: number; attention: number; done: number; toReview: number; approved: number; spentUsd: number; budgetUsd: number; models: number;
  recent: { id: string; name: string; created_at: string; total: number; done: number; attention: number; active: number; approved: number; to_review: number; cover: string | null }[];
};

export default function StudioPage() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/overview").then((r) => r.json()).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const stats = data
    ? [
        { label: "To review", value: String(data.toReview), href: "/productions" },
        { label: "Approved", value: String(data.approved) },
        { label: "In progress", value: data.attention ? `${data.active} · ${data.attention} need attention` : String(data.active) },
        { label: "Spend this month", value: `${usd(data.spentUsd)} / ${usd(data.budgetUsd)}` },
      ]
    : [];

  return (
    <>
      <PageTitle eyebrow="OW Studio" title="Studio overview">
        <LinkButton href="/productions/new">New production</LinkButton>
      </PageTitle>

      <section className="grid grid-cols-2 md:grid-cols-4 border-y border-line">
        {(data ? stats : Array.from({ length: 4 }, () => null)).map((s, i) => (
          <div key={i} className={`py-8 px-1 md:px-6 ${i > 0 ? "md:border-l border-line" : ""}`}>
            {s ? (
              "href" in s && s.href && s.value !== "0" ? (
                <Link href={s.href} className="block group">
                  <div className="ow-eyebrow mb-2">{s.label}</div>
                  <div className="ow-display text-3xl border-b border-ink inline-block group-hover:opacity-70">{s.value}</div>
                </Link>
              ) : (
                <>
                  <div className="ow-eyebrow mb-2">{s.label}</div>
                  <div className="ow-display text-3xl">{s.value}</div>
                </>
              )
            ) : (
              <Skeleton className="h-14 w-32" />
            )}
          </div>
        ))}
      </section>

      <section className="pt-14">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="ow-display text-2xl">Recent productions</h2>
          <Link href="/productions" className="ow-nav border-b border-ink">View all</Link>
        </div>
        {data && data.recent.length === 0 ? (
          <div className="bg-meta py-20 text-center">
            <p className="ow-display text-2xl mb-2">No productions yet</p>
            <p className="text-black/60 mb-6">Upload packshots, pick a model and the shots, then run.</p>
            <LinkButton href="/productions/new">Start a production</LinkButton>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-8">
            {(data?.recent ?? Array.from({ length: 6 }, () => null)).map((p, i) =>
              p ? (
                <Link key={p.id} href={`/productions/${p.id}`} className="group">
                  <Tile src={assetUrl(p.cover, 480)} alt={p.name} className="mb-3 group-hover:opacity-90 transition-opacity" />
                  <div className="ow-nav truncate">{p.name}</div>
                  <div className="text-sm text-black/60">
                    {p.approved}/{p.total} approved{p.to_review ? ` · ${p.to_review} to review` : ""}{p.active ? ` · ${p.active} running` : ""}
                  </div>
                </Link>
              ) : (
                <div key={i}><Skeleton className="aspect-square w-full mb-3" /><Skeleton className="h-4 w-24" /></div>
              ),
            )}
          </div>
        )}
      </section>
    </>
  );
}
