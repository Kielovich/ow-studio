"use client";

import { Skeleton } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TipBox } from "@/components/help";
import { getJson, isNotFound } from "@/lib/client";
import { COMING_SOON } from "@/lib/coming-soon";
import { assetUrl } from "@/lib/types";

type Face = { id: string; name: string; portrait: string };

/** A portrait filling its frame. Only the curated model portraits, never generated images. */
function Portrait({ face, big }: { face?: Face; big?: boolean }) {
  if (!face) return <span className="absolute inset-0 bg-canvas" />;
  return (
    <img src={assetUrl(face.portrait, big ? 1200 : 480)} alt=""
      srcSet={big ? `${assetUrl(face.portrait, 800)} 800w, ${assetUrl(face.portrait, 1200)} 1200w` : undefined}
      sizes={big ? "(min-width: 768px) 50vw, 100vw" : undefined}
      fetchPriority={big ? "high" : "auto"}
      className="absolute inset-0 w-full h-full object-cover object-[50%_30%] transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
  );
}

/** One tool: a large picture, its name and one line. The whole card is the link. */
function Tool({ href, title, line, children }: { href: string; title: string; line: string; children: React.ReactNode }) {
  return (
    <Link href={href} data-testid="tool" className="group block">
      <div className="relative aspect-[4/3] md:aspect-[3/2] bg-canvas overflow-hidden">{children}</div>
      <div className="mt-5 flex items-start justify-between gap-6">
        <div>
          <h2 className="ow-display text-3xl md:text-4xl leading-tight">{title}</h2>
          <p className="text-black/60 mt-1">{line}</p>
        </div>
        <span aria-hidden className="text-2xl leading-none mt-2 transition-transform duration-300 group-hover:translate-x-1">→</span>
      </div>
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

  return (
    <>
      <section className="pt-10 md:pt-16 pb-14">
        <div className="flex items-end justify-between gap-6 mb-10 md:mb-12">
          <h1 className="ow-display text-[2.4rem] sm:text-5xl xl:text-6xl leading-[1.04]">What would you like to make?</h1>
          <Link href="/productions" className="hidden sm:inline-flex ow-nav items-center min-h-11 [@media(pointer:fine)]:min-h-6 shrink-0"><span className="border-b border-ink">Your productions</span></Link>
        </div>
        {failed && <p className="text-danger text-sm mb-6" role="alert">Could not reach the studio. Reload to try again.</p>}

        <div className="grid md:grid-cols-2 gap-x-6 gap-y-12">
          <Tool href="/productions/new" title="On-model images" line="Your packshots on our models, ready for the webshop.">
            {faces ? <Portrait face={face(0)} big /> : <Skeleton className="absolute inset-0 rounded-none" />}
          </Tool>
          <Tool href="/models/new" title="Model builder" line="A new model of your own, from a few choices.">
            {faces
              ? <span className="absolute inset-0 grid grid-cols-3 gap-1">{[1, 2, 3].map((i) => <span key={i} className="relative overflow-hidden"><Portrait face={face(i)} /></span>)}</span>
              : <Skeleton className="absolute inset-0 rounded-none" />}
          </Tool>
        </div>

        <Link href="/productions" className="sm:hidden mt-10 ow-nav inline-flex items-center min-h-11"><span className="border-b border-ink">Your productions</span></Link>

        {/* What is on the way: one quiet line. */}
        <div className="mt-14 pt-5 border-t border-line flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="ow-eyebrow mr-2">Coming soon</span>
          {COMING_SOON.map((f) => (
            <Link key={f.id} href={`/coming-soon#${f.id}`} data-testid="coming-soon-link" className="text-sm text-black/60 hover:text-ink inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-7">{f.title}</Link>
          ))}
        </div>
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
