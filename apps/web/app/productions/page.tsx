"use client";

import { Chip, Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { getJson, isNotFound } from "@/lib/client";
import { assetUrl, usd } from "@/lib/types";

type Row = { id: string; name: string; created_at: string; est_cost: number; total: number; done: number; attention: number; active: number; approved: number; to_review: number; cover: string | null };

export default function ProductionsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const load = () => getJson<{ productions: Row[] }>("/api/productions")
      .then((d) => { if (!isNotFound(d)) { setRows(d.productions); setFailed(false); } })
      .catch(() => setFailed(true));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageTitle eyebrow="History" title="Productions">
        <LinkButton href="/productions/new">New production</LinkButton>
      </PageTitle>
      {failed && !rows ? (
        <p className="text-danger" role="alert">Could not load productions. Retrying…</p>
      ) : rows && rows.length === 0 ? (
        <div className="bg-meta py-20 text-center">
          <p className="ow-display text-2xl mb-2">No productions yet</p>
          <p className="text-black/60 mb-6">Import a folder of packshots, pick a model and run.</p>
          <LinkButton href="/productions/new">Start a production</LinkButton>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-10">
          {(rows ?? Array.from({ length: 8 }, () => null)).map((p, i) =>
            p ? (
              <Link key={p.id} href={`/productions/${p.id}`} className="group">
                <Tile src={assetUrl(p.cover, 480)} alt={p.name} className="mb-3 group-hover:opacity-90 transition-opacity" />
                <div className="flex items-center gap-2 mb-1">
                  <span className="ow-nav truncate">{p.name}</span>
                  {p.active > 0 && <Chip size="sm" color="accent">Running</Chip>}
                  {p.attention > 0 && <Chip size="sm" color="warning">{p.attention} to check</Chip>}
                </div>
                <div className="text-sm text-black/60">
                  {new Date(p.created_at + "Z").toLocaleDateString()} · {p.approved}/{p.total} approved{p.to_review ? ` · ${p.to_review} to review` : ""}{p.active ? ` · ${p.active} running` : ""}
                </div>
              </Link>
            ) : (
              <div key={i}><Skeleton className="aspect-square w-full mb-3" /><Skeleton className="h-4 w-32" /></div>
            ),
          )}
        </div>
      )}
    </>
  );
}
