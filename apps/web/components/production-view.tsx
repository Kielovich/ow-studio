"use client";

import { AlertDialog, Button, Chip, Modal, ProgressBar, Skeleton, Spinner } from "@heroui/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { getJson, isNotFound } from "@/lib/client";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import type { Attempt, Metrics, StatusView } from "@/lib/outcome";
import { ACTIVE_STATES, assetUrl, BRAND_SET, PRESET_LABELS, STATE_LABEL, usd, type PresetId } from "@/lib/types";

type Img = {
  id: string; sku: string; preset: PresetId; slotIndex: number; state: string; finalAsset: string | null; rawAsset: string | null; dependsOn: string | null;
  prompt: string; refs: { role: string; asset: string }[];
  attempts: Attempt[]; approvedAttempt: number | null; status: StatusView;
  job: { attempt: number; costUsd: number; lastError?: { kind: string; message: string }; awaitingReason?: string; validation?: { ok: boolean; reasons: string[] }; events: { state: string; note?: string }[] };
};
type Prod = { id: string; name: string; createdAt: string; estCost: number; provider: string; images: Img[]; metrics: Metrics; spec: { model: { displayName: string; version: number } } };

const order = (p: PresetId) => { const i = BRAND_SET.indexOf(p); return i < 0 ? 99 : i; };

const REF_NAMES: Record<string, string> = {
  garment_front: "packshot front", garment_back: "packshot back", garment_detail: "packshot detail", garment_side: "packshot side",
  garment_orientation: "packshot front · orientation", identity_primary: "identity portrait", identity_angle: "identity angle",
  character_sheet: "character sheet", facial_detail: "facial detail", body_front: "body front", body_back: "body back",
  expression_sheet: "expression", pose: "pose", session_anchor: "session reference (front)", garment_texture: "fabric crop (surface only)",
};

const OUTCOME_LABEL: Record<Attempt["outcome"], string> = { succeeded: "Finished", needs_review: "Size check", failed: "Failed", unknown: "Unknown outcome" };

/** The attempt a tile shows: the latest one, if it belongs to the current job attempt. */
const current = (img: Img) => { const a = img.attempts.at(-1); return a && a.attempt === img.job.attempt ? a : undefined; };

export function ProductionView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [p, setP] = useState<Prod | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewAttempt, setViewAttempt] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const load = useCallback(() => getJson<Prod>(`/api/productions/${id}`)
    .then((d) => { setOffline(false); if (isNotFound(d)) setMissing(true); else setP(d); })
    .catch(() => setOffline(true)), [id]);
  useEffect(() => {
    void load();
    if (missing) return; // a production that does not exist will not appear: stop polling
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, missing]);

  const bySku = useMemo(() => {
    const m = new Map<string, Img[]>();
    for (const i of p?.images ?? []) m.set(i.sku, [...(m.get(i.sku) ?? []), i]);
    for (const list of m.values()) list.sort((a, b) => order(a.preset) - order(b.preset));
    return [...m.entries()];
  }, [p]);

  if (missing) return (
    <div className="pt-24 max-w-lg">
      <div className="ow-eyebrow mb-3">Production</div>
      <h1 className="ow-display text-4xl mb-4">Not found</h1>
      <p className="text-black/60 mb-8">This production does not exist or has been deleted.</p>
      <LinkButton href="/productions">All productions</LinkButton>
    </div>
  );
  if (!p) return offline
    ? <div className="pt-24 max-w-lg"><h1 className="ow-display text-3xl mb-3">Cannot reach the studio</h1><p className="text-black/60">Retrying every few seconds.</p></div>
    : <div className="pt-12"><Skeleton className="h-12 w-80 mb-10" /><Skeleton className="aspect-[5/1] w-full" /></div>;

  const open = p.images.find((i) => i.id === openId) ?? null;
  const total = p.images.length;
  const finished = p.images.filter((i) => i.state === "succeeded" || i.state === "needs_review").length;
  const running = p.images.filter((i) => ACTIVE_STATES.has(i.state)).length;
  const toReview = p.images.filter((i) => i.status.key === "to_review").length;
  const m = p.metrics;

  const act = async (key: string, url: string, body?: object) => {
    setBusy(key);
    setActionError(null);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json()).catch(() => ({ error: "Network error" }));
    if (r.error) setActionError(r.error);
    setBusy(null);
    void load();
  };
  const review = (img: Img, attempt: number, decision: "approved" | "rejected" | null) => act(`${img.id}:${attempt}:${decision}`, `/api/images/${img.id}/review`, { attempt, decision });
  const retry = (img: Img) => act(`${img.id}:retry`, `/api/images/${img.id}/approve`);
  const remove = async () => {
    const r = await fetch(`/api/productions/${id}`, { method: "DELETE" }).then((r) => r.json());
    if (r.ok) router.push("/productions");
    else setDeleteError(r.error);
  };
  const openImage = (img: Img) => { setShowRaw(false); setCompare(false); setViewAttempt(current(img)?.attempt ?? img.attempts.at(-1)?.attempt ?? null); setOpenId(img.id); };

  return (
    <>
      <PageTitle eyebrow={`${p.spec.model.displayName} v${p.spec.model.version} · ${new Date(p.createdAt + "Z").toLocaleString()}`} title={p.name}>
        <LinkButton href={`/api/productions/${id}/zip`} disabled={m.approved === 0}>Download approved ({m.approved})</LinkButton>
        <LinkButton href={`/api/productions/${id}/zip?all=1`} variant="secondary" disabled={finished === 0}>All finished</LinkButton>
        <AlertDialog>
          <Button variant="ghost">Delete</Button>
          <AlertDialog.Backdrop>
            <AlertDialog.Container>
              <AlertDialog.Dialog>
                <AlertDialog.Header><AlertDialog.Heading>Delete this production?</AlertDialog.Heading></AlertDialog.Header>
                <AlertDialog.Body>
                  <p>It disappears from the history. Images still being generated must finish first. Models and packshots are not affected.</p>
                  {deleteError && <p className="text-danger mt-2">{deleteError}</p>}
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="secondary">Cancel</Button>
                  <Button variant="danger" onPress={remove}>Delete</Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      </PageTitle>

      <div className="border-y border-line py-5 mb-12 flex flex-col gap-5">
        <ProgressBar aria-label="Approved" value={total ? (m.approved / total) * 100 : 0}>
          <div className="flex justify-between ow-eyebrow mb-2">
            <span>{m.approved} of {total} approved · {finished} finished{toReview ? ` · ${toReview} to review` : ""}{running ? ` · ${running} running` : ""}</span>
          </div>
          <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
        </ProgressBar>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><dt className="ow-eyebrow mb-1">Approved first try</dt><dd className="ow-display text-2xl">{m.approved ? `${m.approvedFirstTry} of ${m.approved}` : "–"}</dd></div>
          <div><dt className="ow-eyebrow mb-1">Attempts</dt><dd className="ow-display text-2xl">{m.attempts}</dd></div>
          <div><dt className="ow-eyebrow mb-1">Spent</dt><dd className="ow-display text-2xl">{usd(m.spentUsd)} <span className="text-sm text-black/50">est. {usd(p.estCost)}</span></dd>
            {m.unknownAttempts > 0 && <dd className="text-xs text-warning mt-1">+ {m.unknownAttempts} unknown {m.unknownAttempts === 1 ? "outcome" : "outcomes"}, may have been billed</dd>}</div>
          <div><dt className="ow-eyebrow mb-1">Per approved image</dt><dd className="ow-display text-2xl">{m.costPerApprovedUsd === null ? "–" : usd(m.costPerApprovedUsd)}</dd></div>
        </dl>
        {actionError && !open && <p className="text-danger text-sm" role="alert">{actionError}</p>}
        {offline && <p className="text-warning text-sm" role="status">Connection lost. Showing the last known state; retrying.</p>}
      </div>

      <div className="flex flex-col gap-16">
        {bySku.map(([sku, imgs]) => (
          <section key={sku}>
            <div className="ow-nav mb-4">{sku}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-8">
              {imgs.map((img) => {
                const st = img.status;
                const cur = current(img);
                const reviewable = !!cur?.finalAsset && (img.state === "succeeded" || img.state === "needs_review");
                return (
                  <div key={img.id}>
                    <button className="block w-full text-left" onClick={() => openImage(img)} disabled={!img.attempts.length && !img.job.lastError}>
                      <Tile src={assetUrl(img.finalAsset, 800)} alt={`${sku} ${img.preset}`} className={st.key === "approved" ? "outline outline-1 outline-ink -outline-offset-1" : ""}>
                        {ACTIVE_STATES.has(img.state) && <span className="absolute inset-0 grid place-items-center bg-white/40"><Spinner /></span>}
                        {img.attempts.length > 1 && <span className="absolute top-1.5 left-1.5 bg-white/90 text-[10px] px-1.5 py-0.5 uppercase tracking-wide">{img.attempts.length} attempts</span>}
                      </Tile>
                    </button>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span className="ow-eyebrow">{PRESET_LABELS[img.preset]}</span>
                      <Chip size="sm" color={st.color}>{st.label}</Chip>
                    </div>
                    {st.hint && <p className="text-xs text-black/60 mt-2 line-clamp-3">{st.hint}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {reviewable && st.key !== "approved" && (
                        <Button size="sm" isPending={busy === `${img.id}:${cur!.attempt}:approved`} onPress={() => review(img, cur!.attempt, "approved")}>Approve</Button>
                      )}
                      {reviewable && st.key !== "rejected" && (
                        <Button size="sm" variant="secondary" isPending={busy === `${img.id}:${cur!.attempt}:rejected`} onPress={() => review(img, cur!.attempt, "rejected")}>Reject</Button>
                      )}
                      {st.canRetry && (
                        <Button size="sm" variant={st.key === "rejected" ? "primary" : "secondary"} isPending={busy === `${img.id}:retry`} onPress={() => retry(img)}>
                          {st.key === "unknown" ? "New attempt (may cost again)" : "New attempt (paid)"}
                        </Button>
                      )}
                      {img.approvedAttempt !== null && st.key !== "approved" && (
                        <span className="text-xs text-black/60 self-center">Attempt {img.approvedAttempt} approved</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Modal.Backdrop isOpen={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <Modal.Container size="full">
          <Modal.Dialog className="bg-white">
            <Modal.CloseTrigger />
            {open && (() => {
              const shown = open.attempts.find((a) => a.attempt === viewAttempt) ?? open.attempts.at(-1);
              const other = compare ? [...open.attempts].reverse().find((a) => a.finalAsset && a.attempt !== shown?.attempt) : undefined;
              const pane = (a: Attempt | undefined, label?: string) => {
                const src = a ? (showRaw ? a.rawAsset : a.finalAsset) : null;
                return (
                  <div className="bg-canvas relative">
                    {label && <div className="absolute top-2 left-2 bg-white/90 text-xs px-2 py-1 ow-eyebrow">{label}</div>}
                    {src ? <img src={assetUrl(src)} alt="" className="w-full h-auto max-h-[78vh] object-contain mx-auto" />
                      : <div className="aspect-square grid place-items-center text-black/50 text-sm px-6 text-center">{a?.outcome === "unknown" ? "Unknown outcome: no image came back. It may have been billed." : a?.error ?? "No image"}</div>}
                  </div>
                );
              };
              return (
                <>
                  <Modal.Header>
                    <Modal.Heading className="ow-display text-2xl">{open.sku} · {PRESET_LABELS[open.preset]}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <div className="grid lg:grid-cols-[1fr_340px] gap-8">
                      <div className={`grid gap-3 ${other ? "grid-cols-2" : ""}`}>
                        {pane(shown, other ? `Attempt ${shown?.attempt}` : undefined)}
                        {other && pane(other, `Attempt ${other.attempt}`)}
                      </div>
                      <div className="flex flex-col gap-6 text-sm">
                        {open.attempts.length > 0 && (
                          <div>
                            <div className="ow-eyebrow mb-2">Attempts</div>
                            <div className="grid grid-cols-4 gap-2">
                              {open.attempts.map((a) => (
                                <button key={a.attempt} onClick={() => setViewAttempt(a.attempt)} className={`text-left ${a.attempt === shown?.attempt ? "" : "opacity-60 hover:opacity-100"}`}>
                                  <Tile src={assetUrl(a.finalAsset, 240)} alt={`Attempt ${a.attempt}`} className={a.attempt === shown?.attempt ? "outline outline-1 outline-ink outline-offset-2" : ""} />
                                  <div className="text-[10px] mt-1 leading-tight">
                                    #{a.attempt} · {a.review === "approved" ? "approved" : a.review === "rejected" ? "rejected" : OUTCOME_LABEL[a.outcome].toLowerCase()}
                                    <br /><span className="text-black/50">{usd(a.costUsd)}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {shown && (
                          <div className="flex flex-wrap gap-2">
                            {shown.finalAsset && shown.review !== "approved" && (
                              <Button size="sm" isPending={busy === `${open.id}:${shown.attempt}:approved`} onPress={() => review(open, shown.attempt, "approved")}>Approve #{shown.attempt}</Button>
                            )}
                            {shown.finalAsset && shown.review !== "rejected" && (
                              <Button size="sm" variant="secondary" isPending={busy === `${open.id}:${shown.attempt}:rejected`} onPress={() => review(open, shown.attempt, "rejected")}>Reject #{shown.attempt}</Button>
                            )}
                            {shown.review && <Button size="sm" variant="ghost" onPress={() => review(open, shown.attempt, null)}>Clear review</Button>}
                            {open.status.canRetry && (
                              <Button size="sm" variant="secondary" isPending={busy === `${open.id}:retry`} onPress={() => retry(open)}>
                                {open.status.key === "unknown" ? "New attempt (may cost again)" : "New attempt (paid)"}
                              </Button>
                            )}
                          </div>
                        )}
                        {actionError && <p className="text-danger text-sm" role="alert">{actionError}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant={showRaw ? "secondary" : "primary"} onPress={() => setShowRaw(false)}>Final</Button>
                          <Button size="sm" variant={showRaw ? "primary" : "secondary"} onPress={() => setShowRaw(true)} isDisabled={!shown?.rawAsset}>Raw output</Button>
                          <Button size="sm" variant={compare ? "primary" : "secondary"} onPress={() => setCompare((c) => !c)} isDisabled={open.attempts.filter((a) => a.finalAsset).length < 2}>Compare</Button>
                          {shown?.finalAsset && <LinkButton href={`/api/images/${open.id}/download?attempt=${shown.attempt}`} size="sm" variant="ghost">Download 2000 px</LinkButton>}
                        </div>
                        <div>
                          <div className="ow-eyebrow mb-2">References sent</div>
                          <div className="grid grid-cols-4 gap-2">
                            {open.refs.map((r) => (
                              <div key={r.role + r.asset}><Tile src={assetUrl(r.asset, 240)} alt={r.role} /><div className="text-[10px] mt-1 text-black/60">{REF_NAMES[r.role] ?? r.role.replace(/_/g, " ")}</div></div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="ow-eyebrow mb-2">History</div>
                          <ol className="text-black/70">{open.job.events.map((e, i) => <li key={i}>{STATE_LABEL[e.state]?.label ?? e.state}{e.note ? ` – ${e.note}` : ""}</li>)}</ol>
                        </div>
                        <details>
                          <summary className="ow-eyebrow cursor-pointer">Compiled prompt</summary>
                          <pre className="whitespace-pre-wrap text-xs mt-3 text-black/70 max-h-80 overflow-auto">{open.prompt}</pre>
                        </details>
                      </div>
                    </div>
                  </Modal.Body>
                </>
              );
            })()}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
