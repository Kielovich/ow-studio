"use client";

import { Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
    <div className="grid grid-cols-4 grid-rows-2 gap-1 aspect-[2/1]">
      {Array.from({ length: 5 }, (_, i) => {
        const f = tiles[i];
        const big = i === 0 ? "col-span-2 row-span-2" : "";
        if (!faces) return <Skeleton key={i} className={`${big} w-full h-full rounded-none`} />;
        return (
          <div key={f?.id ?? i} className={`${big} relative overflow-hidden bg-canvas`}>
            {f ? <img src={assetUrl(f.portrait, i === 0 ? 1200 : 480)} alt=""
              srcSet={i === 0 ? `${assetUrl(f.portrait, 480)} 480w, ${assetUrl(f.portrait, 800)} 800w, ${assetUrl(f.portrait, 1200)} 1200w` : `${assetUrl(f.portrait, 240)} 240w, ${assetUrl(f.portrait, 480)} 480w`}
              sizes={i === 0 ? "(min-width: 1024px) 30vw, 50vw" : "(min-width: 1024px) 15vw, 25vw"}
              fetchPriority={i === 0 ? "high" : "auto"}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" /> : null}
          </div>
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
      {/* The studio's tools: the one that works now, large; the ones on the way, next to it. */}
      <section className="pt-8 md:pt-12 pb-12 lg:min-h-[calc(100svh-5rem)] flex flex-col justify-center">
        <div className="flex items-end justify-between gap-6 mb-7 md:mb-9">
          <div>
            <div className="ow-eyebrow mb-4">OW Studio</div>
            <h1 className="ow-display text-[2.4rem] sm:text-5xl xl:text-6xl leading-[1.04]">What would you like to make?</h1>
          </div>
          <Link href="/productions" className="hidden sm:inline-flex ow-nav items-center min-h-11 [@media(pointer:fine)]:min-h-6 shrink-0"><span className="border-b border-ink">Your productions</span></Link>
        </div>
        {failed && <p className="text-danger text-sm mb-6" role="alert">Could not reach the studio. Reload to try again.</p>}

        <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2">
          <Link href="/productions/new" data-testid="tool" className="group bg-canvas flex flex-col">
            <Portraits faces={faces} />
            <span className="p-5 md:p-7 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 flex-1">
              <span>
                <span className="ow-nav text-black/60 block mb-2">01 · Available</span>
                <span className="ow-display text-3xl md:text-4xl block mb-1">On-model images</span>
                <span className="text-black/70 block">Your packshots on our models, ready for the webshop.</span>
              </span>
              <span className="button button--primary button--lg inline-flex items-center justify-center shrink-0 self-start sm:self-auto">Start</span>
            </span>
          </Link>

          <div className="grid lg:grid-rows-4 gap-2">
            <Link href="/models/new" data-testid="tool" className="group bg-canvas p-5 md:px-7 md:py-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <span>
                <span className="ow-nav text-black/60 block mb-2">02 · Available</span>
                <span className="ow-display text-2xl xl:text-3xl block mb-1">Model builder</span>
                <span className="text-sm text-black/70 block">Your own model, from a few choices.</span>
              </span>
              <span className="button button--secondary button--md inline-flex items-center justify-center shrink-0 self-start sm:self-auto">Build</span>
            </Link>
            {COMING_SOON.map((f, i) => (
              <Link key={f.id} href={`/coming-soon#${f.id}`} data-testid="tool" className="group bg-ink text-white p-5 md:px-7 md:py-5 flex flex-col justify-between gap-3">
                <span className="ow-nav text-white/70">0{i + 3} · Coming soon</span>
                <span>
                  <span className="ow-display text-2xl xl:text-3xl block mb-1 group-hover:opacity-80">{f.title}</span>
                  <span className="text-sm text-white/75 block">{f.line}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <Link href="/productions" className="sm:hidden mt-6 ow-nav inline-flex items-center min-h-11"><span className="border-b border-ink">Your productions</span></Link>
      </section>

      <TipBox id="home" title="How OW Studio works" steps={[
        <><b>New production:</b> drop a folder of packshots for each look. Nothing is paid until you press Run.</>,
        <><b>Pick a model and the shots</b>, check the summary and press Run. The images arrive in a few minutes.</>,
        <><b>Review:</b> approve the good images and reject the rest. A rejected image can be made again.</>,
        <><b>Download</b> the approved images as a ZIP, ready for the webshop (2000 x 2000 px JPEG).</>,
      ]} />
    </>
  );
}
