"use client";

import { AlertDialog, Button, Chip, Modal, ProgressBar, Skeleton, Spinner } from "@heroui/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LinkButton } from "@/components/link-button";
import { PageTitle } from "@/components/page-title";
import { Tile } from "@/components/tile";
import { ACTIVE_STATES, assetUrl, BRAND_SET, PRESET_LABELS, STATE_LABEL, usd, type PresetId } from "@/lib/types";

type Img = {
  id: string; sku: string; preset: PresetId; slotIndex: number; state: string; finalAsset: string | null; rawAsset: string | null;
  prompt: string; refs: { role: string; asset: string }[];
  job: { attempt: number; costUsd: number; lastError?: { kind: string; message: string }; awaitingReason?: string; validation?: { ok: boolean; reasons: string[] }; events: { state: string; note?: string }[] };
};
type Prod = { id: string; name: string; createdAt: string; estCost: number; provider: string; images: Img[]; spec: { model: { displayName: string; version: number } } };

const order = (p: PresetId) => { const i = BRAND_SET.indexOf(p); return i < 0 ? 99 : i; };

export function ProductionView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [p, setP] = useState<Prod | null>(null);
  const [open, setOpen] = useState<Img | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(() => fetch(`/api/productions/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setP(d)), [id]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const bySku = useMemo(() => {
    const m = new Map<string, Img[]>();
    for (const i of p?.images ?? []) m.set(i.sku, [...(m.get(i.sku) ?? []), i]);
    for (const list of m.values()) list.sort((a, b) => order(a.preset) - order(b.preset));
    return [...m.entries()];
  }, [p]);

  if (!p) return <div className="pt-12"><Skeleton className="h-12 w-80 mb-10" /><Skeleton className="aspect-[5/1] w-full" /></div>;

  const total = p.images.length;
  const done = p.images.filter((i) => i.state === "succeeded").length;
  const running = p.images.filter((i) => ACTIVE_STATES.has(i.state)).length;
  const spent = p.images.reduce((s, i) => s + (i.job.costUsd ?? 0), 0);

  const approve = async (img: Img) => {
    setBusy(img.id);
    await fetch(`/api/images/${img.id}/approve`, { method: "POST" });
    setBusy(null);
    void load();
  };
  const remove = async () => {
    const r = await fetch(`/api/productions/${id}`, { method: "DELETE" }).then((r) => r.json());
    if (r.ok) router.push("/productions");
    else setDeleteError(r.error);
  };

  return (
    <>
      <PageTitle eyebrow={`${p.spec.model.displayName} v${p.spec.model.version} · ${new Date(p.createdAt + "Z").toLocaleString()}`} title={p.name}>
        <LinkButton href={`/api/productions/${id}/zip`} variant="secondary" disabled={done === 0}>Download ZIP</LinkButton>
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

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-center border-y border-line py-5 mb-12">
        <ProgressBar aria-label="Progress" value={total ? (done / total) * 100 : 0}>
          <div className="flex justify-between ow-eyebrow mb-2">
            <span>{done} of {total} finished{running ? ` · ${running} running` : ""}</span>
          </div>
          <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
        </ProgressBar>
        <div className="text-sm text-black/60">Spent {usd(spent)} · estimate {usd(p.estCost)}</div>
      </div>

      <div className="flex flex-col gap-16">
        {bySku.map(([sku, imgs]) => (
          <section key={sku}>
            <div className="ow-nav mb-4">{sku}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {imgs.map((img) => {
                const st = STATE_LABEL[img.state] ?? { label: img.state, color: "default" as const };
                return (
                  <div key={img.id}>
                    <button className="block w-full text-left" onClick={() => { setShowRaw(false); setOpen(img); }} disabled={!img.finalAsset && !img.job.lastError}>
                      <Tile src={assetUrl(img.finalAsset, 800)} alt={`${sku} ${img.preset}`}>
                        {ACTIVE_STATES.has(img.state) && <span className="absolute inset-0 grid place-items-center"><Spinner /></span>}
                      </Tile>
                    </button>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span className="ow-eyebrow">{PRESET_LABELS[img.preset]}</span>
                      <Chip size="sm" color={st.color}>{st.label}</Chip>
                    </div>
                    {(img.state === "awaiting_approval" || img.state === "failed" || img.state === "needs_review") && (
                      <div className="mt-2">
                        <p className="text-xs text-black/60 mb-2 line-clamp-2">{img.job.validation?.reasons[0] ?? img.job.lastError?.message ?? img.job.awaitingReason}</p>
                        <Button size="sm" variant="secondary" isPending={busy === img.id} onPress={() => approve(img)}>Retry (paid)</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Modal.Backdrop isOpen={!!open} onOpenChange={(o) => !o && setOpen(null)}>
          <Modal.Container size="full">
            <Modal.Dialog className="bg-white">
              <Modal.CloseTrigger />
              {open && (
                <>
                  <Modal.Header>
                    <Modal.Heading className="ow-display text-2xl">{open.sku} · {PRESET_LABELS[open.preset]}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <div className="grid lg:grid-cols-[1fr_340px] gap-8">
                      <div className="bg-canvas">
                        {(showRaw ? open.rawAsset : open.finalAsset) ? (
                          <img src={assetUrl(showRaw ? open.rawAsset : open.finalAsset)} alt="" className="w-full h-auto max-h-[80vh] object-contain mx-auto" />
                        ) : <div className="aspect-square grid place-items-center text-black/50">No image</div>}
                      </div>
                      <div className="flex flex-col gap-6 text-sm">
                        <div className="flex gap-2">
                          <Button size="sm" variant={showRaw ? "secondary" : "primary"} onPress={() => setShowRaw(false)}>Final</Button>
                          <Button size="sm" variant={showRaw ? "primary" : "secondary"} onPress={() => setShowRaw(true)} isDisabled={!open.rawAsset}>Raw output</Button>
                          {open.finalAsset && <LinkButton href={assetUrl(open.finalAsset)} download={`${open.sku}_${open.preset}.jpg`} size="sm" variant="ghost">Download</LinkButton>}
                        </div>
                        <div>
                          <div className="ow-eyebrow mb-2">References sent</div>
                          <div className="grid grid-cols-4 gap-2">
                            {open.refs.map((r) => (
                              <div key={r.role + r.asset}><Tile src={assetUrl(r.asset, 240)} alt={r.role} /><div className="text-[10px] mt-1 text-black/60">{r.role.replace(/_/g, " ")}</div></div>
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
              )}
            </Modal.Dialog>
          </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
