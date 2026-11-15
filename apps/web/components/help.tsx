"use client";

import { Button, Popover } from "@heroui/react";
import { useEffect, useState } from "react";

const KEY = (id: string) => `ow-tip-dismissed:${id}`;
const EVENT = "ow-tips-reset";

/**
 * A short "how this page works" box at the top of a page. "Got it" hides it for this browser; Settings can bring every
 * tip back. Browser storage is only a convenience here: without it the tip simply shows again.
 */
export function TipBox({ id, title, steps }: { id: string; title: string; steps: React.ReactNode[] }) {
  const [hidden, setHidden] = useState(true); // render nothing until storage is read, so a dismissed tip never flashes
  useEffect(() => {
    const read = () => { try { setHidden(localStorage.getItem(KEY(id)) === "1"); } catch { setHidden(false); } };
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, [id]);
  if (hidden) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY(id), "1"); } catch {}
    setHidden(true);
  };
  return (
    <aside role="note" aria-label={title} data-testid={`tip-${id}`} className="bg-meta border border-line px-5 py-4 mb-10 flex flex-col sm:flex-row gap-4 sm:items-start sm:justify-between">
      <div>
        <div className="ow-eyebrow mb-2">Tip · {title}</div>
        <ol className="text-sm text-black/80 flex flex-col gap-1.5 list-decimal pl-4">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0 self-start" onPress={dismiss}>Got it</Button>
    </aside>
  );
}

/** Brings every dismissed tip back (Settings). */
export function ResetTipsButton() {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="secondary" onPress={() => {
      try { for (const k of Object.keys(localStorage)) if (k.startsWith("ow-tip-dismissed:")) localStorage.removeItem(k); } catch {}
      window.dispatchEvent(new Event(EVENT));
      setDone(true);
    }}>{done ? "Tips are back" : "Show all tips again"}</Button>
  );
}

/** A small (i) next to a term; opens a short explanation. */
export function InfoTip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Popover>
      <Popover.Trigger aria-label={`About: ${title}`} className="group inline-grid place-items-center shrink-0 w-11 h-11 -my-3 -mx-2.5 [@media(pointer:fine)]:w-6 [@media(pointer:fine)]:h-6 [@media(pointer:fine)]:m-0 cursor-pointer align-middle normal-case tracking-normal font-normal select-none">
        <span aria-hidden className="grid place-items-center w-5 h-5 rounded-full border border-black/50 text-[0.75rem] leading-none text-black/70 group-hover:border-ink group-hover:text-ink">i</span>
      </Popover.Trigger>
      <Popover.Content placement="top" className="max-w-xs">
        <Popover.Dialog className="p-4">
          <Popover.Heading className="ow-eyebrow mb-2">{title}</Popover.Heading>
          <div className="text-sm text-black/80 leading-relaxed normal-case tracking-normal">{children}</div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
