"use client";

import { Chip, Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { assetUrl, usd } from "@/lib/types";

type Row = { id: string; name: string; created_at: string; est_cost: number; total: number; done: number; attention: number; active: number; approved: number; to_review: number; cover: string | null };

export default function ProductionsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/productions").then((r) => r.json()).then((d) => setRows(d.productions)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageTitle eyebrow="History" title="Productions">
        <LinkButton href="/productions/new">New production</LinkButton>
      </PageTitle>
      {rows && rows.length === 0 ? (
        <p className="text-black/60">No productions yet.</p>
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
