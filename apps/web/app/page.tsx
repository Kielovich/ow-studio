"use client";

import { Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { TipBox } from "@/components/help";
import { getJson, isNotFound } from "@/lib/client";
import { COMING_SOON } from "@/lib/coming-soon";
import { assetUrl } from "@/lib/types";

type Face = { id: string; name: string; portrait: string };

/**
 * The models' portraits as one editorial block: one large, four small. Only the curated portraits, never generated
 * images. The large one changes from day to day, so every model gets her turn.
 */
function Portraits({ faces }: { faces: Face[] | null }) {
  const start = faces?.length ? new Date().getDate() % faces.length : 0;
  const tiles = faces ? [...faces.slice(start), ...faces.slice(0, start)].slice(0, 5) : [];
  return (
    <div className="grid grid-cols-4 grid-rows-2 gap-1.5 md:gap-2 aspect-[2/1]">
      {Array.from({ length: 5 }, (_, i) => {
        const f = tiles[i];
        const big = i === 0 ? "col-span-2 row-span-2" : "";
        if (!faces) return <Skeleton key={i} className={`${big} w-full h-full`} />;
        if (!f) return <div key={i} className={`${big} bg-canvas`} />;
        return (
          <Link key={f.id} href={`/models/${f.id}`} aria-label={f.name} className={`${big} group relative overflow-hidden bg-canvas`}>
            <img src={assetUrl(f.portrait, i === 0 ? 1200 : 480)} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
          </Link>
        );
      })}
    </div>
  );
}

export default function StudioPage() {
  const [faces, setFaces] = useState<Face[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getJson<{ faces: Face[] }>("/api/overview").then((d) => { if (!isNotFound(d)) setFaces(d.faces); }).catch(() => setFailed(true));
  }, []);

  return (
    <>
      {/* A calm first screen: what the studio does, one way in, and the models. */}
      <section className="pt-8 md:pt-14 pb-12 lg:pb-14 lg:min-h-[calc(100svh-5rem)] grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-10 lg:gap-14 items-center content-center">
        <div className="min-w-0">
          <div className="ow-eyebrow mb-5">OW Studio</div>
          <h1 className="ow-display text-[2.6rem] sm:text-6xl lg:text-[3.4rem] xl:text-6xl leading-[1.04] mb-6">On-model images from your packshots</h1>
          <p className="text-base sm:text-lg text-black/70 max-w-md mb-9">Choose a model and the shots. Ready for the webshop in minutes.</p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <LinkButton href="/productions/new" size="lg">New production</LinkButton>
            <Link href="/productions" className="ow-nav inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-6"><span className="border-b border-ink">Your productions</span></Link>
          </div>
          {failed && <p className="text-danger text-sm mt-6" role="alert">Could not reach the studio. Reload to try again.</p>}
        </div>
        <Portraits faces={faces} />
      </section>

      <TipBox id="home" title="How OW Studio works" steps={[
        <><b>New production:</b> drop a folder of packshots for each look. Nothing is paid until you press Run.</>,
        <><b>Pick a model and the shots</b>, check the summary and press Run. The images arrive in a few minutes.</>,
        <><b>Review:</b> approve the good images and reject the rest. A rejected image can be made again.</>,
        <><b>Download</b> the approved images as a ZIP, ready for the webshop (2000 x 2000 px JPEG).</>,
      ]} />

      {/* What is coming next. */}
      <section className="pt-10 lg:pt-4">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="ow-display text-3xl">Coming soon</h2>
          <Link href="/coming-soon" className="ow-nav inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-6"><span className="border-b border-ink">What&apos;s next</span></Link>
        </div>
        <div className="grid md:grid-cols-3 gap-px bg-[#2a2a2a]">
          {COMING_SOON.map((f, i) => (
            <Link key={f.id} href={`/coming-soon#${f.id}`} className="group bg-ink text-white p-5 md:p-8 md:min-h-56 flex flex-col justify-between gap-4">
              <span className="ow-nav text-white/70">0{i + 1} · Coming soon</span>
              <span>
                <span className="ow-display text-2xl md:text-3xl block mb-2 group-hover:opacity-80">{f.title}</span>
                <span className="text-sm text-white/75 block">{f.line}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
