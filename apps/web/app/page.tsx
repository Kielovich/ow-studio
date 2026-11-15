"use client";

import { Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TipBox } from "@/components/help";
import { getJson, isNotFound } from "@/lib/client";
import { COMING_SOON } from "@/lib/coming-soon";
import { assetUrl } from "@/lib/types";

type Face = { id: string; name: string; portrait: string };

/** Short campaign words for the tools on the way (the coming-soon page has the full names). */
const SHORT: Record<string, string> = { "packshot-generator": "Packshots", "lookbook-creator": "Lookbooks", "campaign-shoot": "Campaigns" };

/** A portrait filling its frame. Only the curated model portraits, never generated images. */
function Portrait({ face, big }: { face?: Face; big?: boolean }) {
  if (!face) return null;
  return (
    <img src={assetUrl(face.portrait, big ? 1200 : 800)} alt=""
      srcSet={big ? `${assetUrl(face.portrait, 800)} 800w, ${assetUrl(face.portrait, 1200)} 1200w` : undefined}
      sizes={big ? "(min-width: 1024px) 50vw, 100vw" : undefined}
      fetchPriority={big ? "high" : "auto"}
      className="absolute inset-0 w-full h-full object-cover object-[50%_25%] transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]" />
  );
}

/**
 * One tool as a campaign panel: the picture full height, a big word over it, one line, an arrow. The whole panel is the
 * link. The panel is black under the picture, so the white type always has its contrast.
 */
function Panel({ href, index, word, line, children }: { href: string; index: string; word: string; line: string; children: React.ReactNode }) {
  return (
    <Link href={href} data-testid="tool" aria-label={`${word}: ${line}`}
      className="group relative block overflow-hidden bg-ink text-white aspect-[4/5] sm:aspect-[4/3] lg:aspect-auto lg:h-[calc(100svh-11rem)] lg:min-h-[560px]">
      {children}
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <span aria-hidden className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-black/40 to-transparent" />
      <span className="absolute top-0 inset-x-0 p-5 md:p-8 flex justify-between ow-nav text-white/85">
        <span>{index}</span>
        <span className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden>→</span>
      </span>
      <span className="absolute bottom-0 inset-x-0 p-5 md:p-8">
        <span className="block ow-display uppercase leading-[0.85] tracking-[-0.02em] text-[clamp(3.5rem,8.5vw,9.5rem)]">{word}</span>
        <span className="block mt-4 text-sm md:text-base text-white/85 max-w-md md:min-h-12">{line}</span>
      </span>
    </Link>
  );
}

export default function StudioPage() {
  const [faces, setFaces] = useState<Face[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getJson<{ faces: Face[] }>("/api/overview").then((d) => { if (!isNotFound(d)) setFaces(d.faces); }).catch(() => setFailed(true));
  }, []);
  // Different models from day to day, so every model gets her turn.
  const start = faces?.length ? new Date().getDate() % faces.length : 0;
  const face = (i: number) => (faces?.length ? faces[(start + i) % faces.length] : undefined);
  const loading = <Skeleton className="absolute inset-0 rounded-none" />;

  return (
    <>
      <section className="pt-6 md:pt-8 pb-14">
        <div className="flex items-center justify-between gap-6 mb-4 md:mb-5">
          <h1 className="ow-nav text-black/70">What would you like to make?</h1>
          <Link href="/productions" className="ow-nav inline-flex items-center gap-2 min-h-11 [@media(pointer:fine)]:min-h-6 shrink-0">
            <span className="border-b border-ink">Your productions</span><span aria-hidden>→</span>
          </Link>
        </div>
        {failed && <p className="text-danger text-sm mb-4" role="alert">Could not reach the studio. Reload to try again.</p>}

        <div className="grid lg:grid-cols-2 gap-2">
          <Panel href="/productions/new" index="01" word="Ecom" line="Your packshots on our models, ready for the webshop.">
            {faces ? <Portrait face={face(0)} big /> : loading}
          </Panel>
          <Panel href="/models/new" index="02" word="Casting" line="Build a new model of your own, from a few choices.">
            {faces
              ? <span className="absolute inset-0 grid grid-cols-3 gap-0.5">{[1, 2, 3].map((i) => <span key={i} className="relative overflow-hidden"><Portrait face={face(i)} /></span>)}</span>
              : loading}
          </Panel>
        </div>

        {/* What is on the way: one graphic band. */}
        <div className="mt-2 bg-ink text-white px-5 md:px-8 py-7 md:py-9 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 ow-display uppercase leading-none tracking-[-0.01em] text-[clamp(2rem,4.2vw,4rem)]">
            {COMING_SOON.map((f, i) => (
              <span key={f.id} className="inline-flex items-baseline gap-x-4">
                {i > 0 && <span aria-hidden className="hidden md:inline text-white/30">/</span>}
                <Link href={`/coming-soon#${f.id}`} data-testid="coming-soon-link" className="hover:text-white/70 transition-colors inline-flex items-center min-h-11">{SHORT[f.id] ?? f.title}</Link>
              </span>
            ))}
          </div>
          <Link href="/coming-soon" className="ow-nav text-white/75 hover:text-white shrink-0 inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-6">Coming soon →</Link>
        </div>
      </section>

      <TipBox id="home" title="How OW Studio works" steps={[
        <><b>Ecom:</b> drop a folder of packshots for each look, pick a model and the shots. Nothing is paid until you press Run.</>,
        <><b>Review:</b> approve the good images and reject the rest. A rejected image can be made again.</>,
        <><b>Download</b> the approved images as a ZIP, ready for the webshop (2000 x 2000 px JPEG).</>,
        <><b>Casting:</b> build a new model of your own from a few choices, and use her in Ecom right away.</>,
      ]} />
    </>
  );
}
