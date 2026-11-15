"use client";

import { Button, Input, Label, Spinner, TextField } from "@heroui/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUILDER_AGES, BUILDER_HEIGHTS, BUILDER_OPTIONS, BUILDER_SIZES, builderSummary, DEFAULT_BUILDER_SPEC, hairStyleAllowed,
  MODEL_NAME_RULE, PORTRAITS_PER_ROUND, REFERENCE_KINDS, REFERENCE_LABELS, type BuilderSpec, type ReferenceKind,
} from "@ow-studio/core/src/modelBuilder";
import { Choices } from "@/components/choices";
import { TipBox } from "@/components/help";
import { LinkButton } from "@/components/link-button";
import { PageTitle } from "@/components/page-title";
import { getJson, isNotFound } from "@/lib/client";
import type { BuilderDraft, BuilderImage } from "@/lib/server/builder";
import { assetUrl, usd } from "@/lib/types";

type OpenDraft = { id: string; summarySpec: BuilderSpec; portrait: string | null; updatedAt: string };
type Info = { drafts: OpenDraft[]; imageCostUsd: number; budgetRemainingUsd: number };

const STEPS = ["Look", "Portraits", "References", "Add to models"] as const;
/** One even grid: square tiles, the character sheet over two columns. Body and sheet are shown whole (contained). */
const REF_TILE: Record<ReferenceKind, { aspect: string; fit: "cover" | "contain" }> = {
  threeQuarter: { aspect: "aspect-square", fit: "cover" }, profile: { aspect: "aspect-square", fit: "cover" },
  bodyFront: { aspect: "aspect-square", fit: "contain" }, bodyBack: { aspect: "aspect-square", fit: "contain" },
  characterSheet: { aspect: "aspect-[2/1]", fit: "contain" },
};

const refsDone = (d: BuilderDraft | null) => !!d && REFERENCE_KINDS.every((k) => d.references[k]?.state === "succeeded");
const refsStarted = (d: BuilderDraft | null) => !!d && Object.keys(d.references).length > 0;
const working = (i?: BuilderImage | null) => !!i && (i.state === "queued" || i.state === "running");
/** Where a draft continues: the first step that is not finished. */
const stepFor = (d: BuilderDraft) => (d.status === "registered" || refsDone(d) ? 4 : refsStarted(d) || d.portrait ? 3 : d.portraits.length ? 2 : 1);

async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  if (!r) return { ok: false, data: { error: "No connection to the studio. Try again." } };
  if (r.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return new Promise(() => {}); }
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-8 grid md:grid-cols-[240px_1fr] gap-6 md:gap-8">
      <div>
        <h2 className="ow-display text-2xl mb-2">{title}</h2>
        {hint && <p className="text-sm text-black/60 leading-relaxed">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** One generated image: the picture, or its progress or failure, on the studio canvas. */
function Picture({ img, label, aspect = "aspect-square", fit = "cover" }: { img?: BuilderImage | null; label: string; aspect?: string; fit?: "cover" | "contain" }) {
  return (
    <div className={`relative ${aspect} bg-canvas overflow-hidden`}>
      {img?.state === "succeeded" && img.asset ? <img src={assetUrl(img.asset, 800)} alt={label} className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`} />
        : working(img) ? <span className="absolute inset-0 grid place-items-center text-sm text-black/60"><span className="flex flex-col items-center gap-2"><Spinner size="sm" />Making…</span></span>
          : img?.state === "failed" ? <span className="absolute inset-0 grid place-items-center p-3 text-center text-sm text-danger">{img.error ?? "Failed"}</span>
            : <span className="absolute inset-0 grid place-items-center text-sm text-black/60">Not made yet</span>}
    </div>
  );
}

export function ModelBuilder() {
  const router = useRouter();
  const draftId = useSearchParams().get("draft");
  const [info, setInfo] = useState<Info | null>(null);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [missing, setMissing] = useState(false);
  const [spec, setSpec] = useState<BuilderSpec>(DEFAULT_BUILDER_SPEC);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<string | null>(null);

  const goTo = (n: number) => { setStep(n); setError(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const cost = info?.imageCostUsd ?? draft?.imageCostUsd ?? 0.16;

  useEffect(() => {
    getJson<Info>("/api/model-builder").then((d) => { if (!isNotFound(d)) setInfo(d); }).catch(() => {});
  }, [draftId, draft?.status]);

  const load = useCallback(async () => {
    if (!draftId) return;
    const d = await getJson<BuilderDraft>(`/api/model-builder/${draftId}`).catch(() => null);
    if (!d) return;
    if (isNotFound(d)) { setMissing(true); return; }
    setDraft(d);
  }, [draftId]);
  useEffect(() => {
    setMissing(false);
    if (!draftId) { setDraft(null); seen.current = null; return; }
    void load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [draftId, load]);

  // A draft opened (or just created): continue where it stands.
  useEffect(() => {
    if (!draft || seen.current === draft.id) return;
    seen.current = draft.id;
    setSpec(draft.spec);
    setStep(stepFor(draft));
    setSelected(draft.portraits.find((p) => p.asset === draft.portrait)?.id ?? null);
  }, [draft]);

  const locked = refsStarted(draft) || (draft !== null && draft.status !== "open");
  const portraitsWorking = !!draft?.portraits.some(working);
  const refsWorking = REFERENCE_KINDS.some((k) => working(draft?.references[k]));
  const reachable = (n: number) => n === 1 || (n === 2 && !!draft?.portraits.length) || (n === 3 && !!draft?.portrait) || (n === 4 && refsDone(draft));
  const stepDone = (n: number) => n === 1 ? !!draft?.portraits.length : n === 2 ? !!draft?.portrait : n === 3 ? refsDone(draft) : draft?.status === "registered";
  const set = <K extends keyof BuilderSpec>(k: K, v: BuilderSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));

  const act = async (key: string, fn: () => Promise<boolean>) => {
    setPending(key);
    setError(null);
    try { await fn(); } finally { setPending(null); }
  };
  const fail = (data: any) => { setError(data?.error ?? "Something went wrong. Try again."); return false; };

  const makePortraits = () => act("portraits", async () => {
    let id = draftId;
    if (!id) {
      const r = await send("POST", "/api/model-builder", { spec });
      if (!r.ok) return fail(r.data);
      id = r.data.id as string;
    } else if (JSON.stringify(spec) !== JSON.stringify(draft?.spec)) {
      const r = await send("PATCH", `/api/model-builder/${id}`, { spec });
      if (!r.ok) return fail(r.data);
    }
    const r = await send("POST", `/api/model-builder/${id}`, { action: "portraits" });
    if (!r.ok) return fail(r.data);
    setDraft(r.data);
    seen.current = id;
    setSelected(null);
    if (id !== draftId) router.replace(`/models/new?draft=${id}`);
    goTo(2);
    return true;
  });
  const usePortrait = () => act("choose", async () => {
    const r = await send("POST", `/api/model-builder/${draftId}`, { action: "choose", imageId: selected });
    if (!r.ok) return fail(r.data);
    setDraft(r.data);
    goTo(3);
    return true;
  });
  const makeReferences = () => act("references", async () => {
    const r = await send("POST", `/api/model-builder/${draftId}`, { action: "references" });
    if (!r.ok) return fail(r.data);
    setDraft(r.data);
    return true;
  });
  const redo = (kind: ReferenceKind) => act(`redo:${kind}`, async () => {
    const r = await send("POST", `/api/model-builder/${draftId}`, { action: "redo", kind });
    if (!r.ok) return fail(r.data);
    setDraft(r.data);
    return true;
  });
  const register = () => act("register", async () => {
    const r = await send("POST", `/api/model-builder/${draftId}`, { action: "register", name });
    if (!r.ok) return fail(r.data);
    await load();
    return true;
  });
  const discard = () => act("discard", async () => {
    const r = await send("DELETE", `/api/model-builder/${draftId}`);
    if (!r.ok) return fail(r.data);
    setDraft(null);
    setSpec(DEFAULT_BUILDER_SPEC);
    router.replace("/models/new");
    goTo(1);
    return true;
  });

  if (missing) return (
    <div className="pt-24 max-w-lg">
      <div className="ow-eyebrow mb-3">Model builder</div>
      <h1 className="ow-display text-4xl mb-4">Not found</h1>
      <p className="text-black/60 mb-8">This model draft does not exist.</p>
      <LinkButton href="/models/new">Build a model</LinkButton>
    </div>
  );

  const missingRefs = REFERENCE_KINDS.filter((k) => draft?.references[k]?.state !== "succeeded").length;
  const nameOk = MODEL_NAME_RULE.test(name.trim().replace(/\s+/g, " "));
  const readyPortraits = draft?.portraits.filter((p) => p.state === "succeeded").length ?? 0;
  const roundSize = Math.min(PORTRAITS_PER_ROUND, draft?.portraits.length ?? 0);
  const readyRefs = REFERENCE_KINDS.filter((k) => draft?.references[k]?.state === "succeeded").length;
  const registeredId = draft?.status === "registered" ? draft.modelId : null;

  const status = error ?? (
    step === 1 ? (locked ? "Her look is set: the reference set is made from her portrait." : `${PORTRAITS_PER_ROUND} portraits · about ${usd(PORTRAITS_PER_ROUND * cost)}${info ? ` · ${usd(info.budgetRemainingUsd)} left this month` : ""}`)
    : step === 2 ? (portraitsWorking ? `Making portraits… ${draft!.portraits.slice(0, roundSize).filter((p) => p.state === "succeeded").length} of ${roundSize} ready` : selected ? "Portrait chosen" : readyPortraits ? "Choose the portrait you like" : "No portrait yet")
    : step === 3 ? (refsWorking ? `Making the reference set… ${readyRefs} of ${REFERENCE_KINDS.length} ready` : refsDone(draft) ? "Reference set complete" : `${missingRefs} images · about ${usd(missingRefs * cost)}`)
    : registeredId ? "Added to the models" : nameOk ? "Ready to add" : "Give her a name"
  );

  return (
    <>
      <PageTitle eyebrow="Models" title="Model builder" />
      <TipBox id="model-builder" title="Build a model" steps={[
        <><b>Choose her look.</b> Only choices, no photos: every model is an original, fictional adult.</>,
        <><b>Make 3 portraits</b> (about {usd(PORTRAITS_PER_ROUND * cost)}) and choose the one you like. Not right? Change the look or make 3 new.</>,
        <><b>Make the reference set</b> from her portrait: 5 images, about {usd(REFERENCE_KINDS.length * cost)}.</>,
        <><b>Name her and add her</b> to the models. She can be chosen in New production right away.</>,
      ]} />

      <nav aria-label="Steps" className="sticky top-16 md:top-20 z-30 bg-white/95 backdrop-blur grid grid-cols-4 gap-2 sm:gap-4 pt-1 pb-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = stepDone(n);
          return (
            <button key={label} type="button" onClick={() => reachable(n) && goTo(n)} aria-current={active ? "step" : undefined} aria-disabled={!reachable(n)}
              className={`text-left min-h-11 pt-2 flex flex-col justify-start border-t-2 ${active ? "border-t-[#111111]" : done ? "border-t-[#8a8a8a]" : "border-t-[#e8e8e8]"} ${reachable(n) ? "" : "cursor-default"}`}>
              <span className="ow-eyebrow block">{done && !active ? "✓ " : ""}{n}</span>
              <span className={`text-sm leading-tight block ${active ? "text-ink font-medium" : reachable(n) ? "text-black/60" : "text-black/60"}`}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 1 · Look */}
      <div hidden={step !== 1}>
        {!draftId && !!info?.drafts.length && (
          <section className="pt-6" aria-label="Unfinished models">
            <div className="ow-eyebrow mb-3">Continue an unfinished model</div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {info.drafts.map((d) => (
                <Link key={d.id} href={`/models/new?draft=${d.id}`} className="shrink-0 w-28 group">
                  <div className="relative aspect-square bg-canvas overflow-hidden">
                    {d.portrait && <img src={assetUrl(d.portrait, 240)} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:opacity-90" />}
                  </div>
                  <span className="text-sm text-black/70 line-clamp-2 mt-1">{builderSummary(d.summarySpec).split(" · ").slice(0, 2).join(" · ")}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        <Section title="Her look" hint={locked ? "The reference set is made from her portrait, so her look is set. Start a new model for another look." : "Choose, then make 3 portraits. Every model is an original, fictional adult."}>
          <fieldset disabled={locked} className="flex flex-wrap gap-x-12 gap-y-7">
            <Choices label="Heritage" options={BUILDER_OPTIONS.heritage} value={spec.heritage} onChange={(v) => set("heritage", v as string)} />
            <Choices label="Skin tone" options={BUILDER_OPTIONS.skin} value={spec.skin} onChange={(v) => set("skin", v as string)} />
            <Choices label="Eyes" options={BUILDER_OPTIONS.eyes} value={spec.eyes} onChange={(v) => set("eyes", v as string)} />
            <Choices label="Freckles" options={[["no", "No"], ["yes", "Yes"]]} value={spec.freckles ? "yes" : "no"} onChange={(v) => set("freckles", v === "yes")} />
            <Choices label="Hair colour" options={BUILDER_OPTIONS.hairColour} value={spec.hairColour} onChange={(v) => set("hairColour", v as string)} />
            <Choices label="Hair texture" options={BUILDER_OPTIONS.hairTexture} value={spec.hairTexture} onChange={(v) => set("hairTexture", v as string)} />
            <Choices label="Hair length" options={BUILDER_OPTIONS.hairLength} value={spec.hairLength}
              onChange={(v) => setSpec((s) => ({ ...s, hairLength: v as string, ...(v === "short" ? { hairStyle: "down" } : {}) }))} />
            <Choices label="Hairstyle" hint={spec.hairLength === "short" ? "Short hair is worn as cut." : undefined} options={BUILDER_OPTIONS.hairStyle} value={spec.hairStyle}
              disabled={(v) => !hairStyleAllowed(spec, v)} onChange={(v) => set("hairStyle", v as string)} />
            <Choices label="Age" options={BUILDER_AGES.map((a) => [String(a), String(a)] as const)} value={String(spec.ageYears)} onChange={(v) => set("ageYears", Number(v))} />
            <Choices label="Height" options={BUILDER_HEIGHTS.map((h) => [String(h), `${h} cm`] as const)} value={String(spec.heightCm)} onChange={(v) => set("heightCm", Number(v))} />
            <Choices label="EU size" options={BUILDER_SIZES.map((s) => [String(s), String(s)] as const)} value={String(spec.euSize)} onChange={(v) => set("euSize", Number(v))} />
          </fieldset>
        </Section>
      </div>

      {/* 2 · Portraits */}
      <div hidden={step !== 2}>
        <Section title="Portraits" hint={refsStarted(draft) ? "The reference set is made from the portrait you chose." : "Choose the one you like. Not right? Change her look, or make 3 new."}>
          {draft && (
            <div className="flex flex-col gap-10">
              {[...new Set(draft.portraits.map((p) => p.round))].map((round, ri) => (
                <div key={round}>
                  {ri > 0 && <div className="ow-eyebrow mb-3">Earlier portraits</div>}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {draft.portraits.filter((p) => p.round === round).map((p, i) => {
                      const choosable = p.state === "succeeded" && !refsStarted(draft);
                      const isSel = selected === p.id;
                      return (
                        <button key={p.id} type="button" disabled={!choosable} aria-pressed={isSel} aria-label={`Portrait ${i + 1}${ri > 0 ? `, earlier round` : ""}`}
                          onClick={() => setSelected(p.id)}
                          className={`text-left block ${isSel ? "outline outline-2 outline-ink outline-offset-2" : ""} ${choosable ? "cursor-pointer" : "cursor-default"}`}>
                          <Picture img={p} label={`Portrait ${i + 1}`} />
                          <span className="flex items-center justify-between mt-2 text-sm min-h-6">
                            <span className={isSel ? "font-medium" : "text-black/60"}>{isSel ? "Chosen" : p.asset === draft.portrait ? "Her portrait" : `Portrait ${i + 1}`}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!refsStarted(draft) && (
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" isDisabled={portraitsWorking} isPending={pending === "portraits"} onPress={makePortraits}>Make 3 new · {usd(PORTRAITS_PER_ROUND * cost)}</Button>
                  <Button variant="ghost" onPress={() => goTo(1)}>Change her look</Button>
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* 3 · References */}
      <div hidden={step !== 3}>
        <Section title="Reference set" hint="Made from her portrait: the same face, hair and skin from every side. The productions use these.">
          {draft?.portrait && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-6 items-start">
              <div>
                <div className="relative aspect-square bg-canvas overflow-hidden"><img src={assetUrl(draft.portrait, 800)} alt="Identity portrait" className="absolute inset-0 w-full h-full object-cover" /></div>
                <div className="ow-eyebrow mt-2 flex items-center min-h-11 [@media(pointer:fine)]:min-h-7">{REFERENCE_LABELS.portrait}</div>
              </div>
              {REFERENCE_KINDS.map((k) => {
                const img = draft.references[k];
                return (
                  <div key={k} className={k === "characterSheet" ? "col-span-2" : ""}>
                    <Picture img={img} label={REFERENCE_LABELS[k]} aspect={REF_TILE[k].aspect} fit={REF_TILE[k].fit} />
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className="ow-eyebrow">{REFERENCE_LABELS[k]}{img && img.round > 1 ? ` · attempt ${img.round}` : ""}</span>
                      {img && !working(img) && !registeredId && (
                        <button type="button" disabled={!!pending} onClick={() => redo(k)}
                          className="text-sm underline underline-offset-4 decoration-1 inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-7 shrink-0">
                          {pending === `redo:${k}` ? "Starting…" : `Make again · ${usd(cost)}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      {/* 4 · Add to models */}
      <div hidden={step !== 4}>
        <Section title={registeredId ? "Added" : "Add to models"} hint={registeredId ? undefined : "Her name is only for you: it is never sent to the image service."}>
          {draft && (
            <div className="grid sm:grid-cols-[200px_1fr] gap-6 max-w-3xl items-start">
              {draft.portrait && <div className="relative aspect-square bg-canvas overflow-hidden"><img src={assetUrl(draft.portrait, 480)} alt="Her portrait" className="absolute inset-0 w-full h-full object-cover" /></div>}
              <div className="flex flex-col gap-5">
                <p className="text-sm text-black/70">{builderSummary(draft.spec)}</p>
                {registeredId ? (
                  <div className="flex flex-col gap-4" role="status">
                    <p className="ow-display text-2xl">She is in the models.</p>
                    <div className="flex flex-wrap gap-3">
                      <LinkButton href="/productions/new" variant="secondary">New production with her</LinkButton>
                    </div>
                  </div>
                ) : (
                  <TextField value={name} onChange={setName} className="max-w-sm" isRequired>
                    <Label className="ow-eyebrow">Name</Label>
                    <Input placeholder="e.g. Hana" maxLength={24} />
                  </TextField>
                )}
              </div>
            </div>
          )}
        </Section>
      </div>

      {draft && draft.status === "open" && (
        <div className="pb-4">
          <Button variant="ghost" className="-ml-4" isPending={pending === "discard"} onPress={discard}>Discard this model</Button>
        </div>
      )}

      {/* Always in view: where things stand, back, and the next action with its price. */}
      <div className="h-32" aria-hidden />
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line">
        <div className="max-w-[1440px] mx-auto safe-x pt-3 safe-bottom sm:pb-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <p className={`text-sm ${error ? "text-danger" : "text-black/70"}`} role="status">{status}</p>
          <div className="flex gap-2 items-center">
            {step > 1 && <Button variant="ghost" onPress={() => goTo(step - 1)}>Back</Button>}
            {step === 1 && (locked
              ? <Button className="flex-1 sm:flex-none" onPress={() => goTo(2)}>Next: Portraits</Button>
              : <Button className="flex-1 sm:flex-none" isDisabled={portraitsWorking} isPending={pending === "portraits"} onPress={makePortraits}>Make {PORTRAITS_PER_ROUND} portraits · {usd(PORTRAITS_PER_ROUND * cost)}</Button>)}
            {step === 2 && (refsStarted(draft)
              ? <Button className="flex-1 sm:flex-none" onPress={() => goTo(3)}>Next: References</Button>
              : <Button className="flex-1 sm:flex-none" isDisabled={!selected} isPending={pending === "choose"} onPress={usePortrait}>Use this portrait</Button>)}
            {step === 3 && (refsDone(draft)
              ? <Button className="flex-1 sm:flex-none" onPress={() => goTo(4)}>Next: Add to models</Button>
              : <Button className="flex-1 sm:flex-none" isDisabled={refsWorking || !draft?.portrait} isPending={pending === "references"} onPress={makeReferences}>Make the reference set · {usd(missingRefs * cost)}</Button>)}
            {step === 4 && (registeredId
              ? <LinkButton href={`/models/${registeredId}`}>Open her page</LinkButton>
              : <Button className="flex-1 sm:flex-none" isDisabled={!nameOk || !refsDone(draft)} isPending={pending === "register"} onPress={register}>Add to models</Button>)}
          </div>
        </div>
      </div>
    </>
  );
}
