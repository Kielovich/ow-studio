"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Studio" },
  { href: "/productions/new", label: "New production" },
  { href: "/productions", label: "Productions" },
  { href: "/models", label: "Models" },
  { href: "/coming-soon", label: "Coming soon" },
  { href: "/settings", label: "Settings" },
];

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // Close the mobile menu on navigation and with Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login"); // full load: drop every cached authenticated page
  };
  const active = (href: string) => (href === "/" ? path === "/" : path === href || (href !== "/productions" && path.startsWith(href)) || (href === "/productions" && path.startsWith("/productions") && !path.startsWith("/productions/new")));
  const onLogin = path === "/login";

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
      <div className="max-w-[1440px] mx-auto safe-x h-16 md:h-20 grid grid-cols-[1fr_auto_1fr] items-center">
        {!onLogin && <nav className="hidden md:flex gap-4 lg:gap-7 ow-nav">
          {NAV.slice(0, 3).map((n) => (
            <Link key={n.href} href={n.href} className={`py-1.5 border-b ${active(n.href) ? "border-ink" : "border-transparent text-black/60 hover:text-ink"}`}>
              {n.label}
            </Link>
          ))}
        </nav>}
        <Link href="/" aria-label="OW Studio home" className="flex items-center gap-3 justify-self-center col-start-2 min-h-11 px-2">
          <Image src="/brand/ow-logo-black.png" alt="OW" width={60} height={31} priority />
          <span className="ow-eyebrow hidden sm:inline">Studio</span>
        </Link>
        {!onLogin && <nav className="hidden md:flex gap-4 lg:gap-7 ow-nav justify-self-end col-start-3">
          {NAV.slice(3).map((n) => (
            <Link key={n.href} href={n.href} className={`py-1.5 border-b ${active(n.href) ? "border-ink" : "border-transparent text-black/60 hover:text-ink"}`}>
              {n.label}
            </Link>
          ))}
          <button onClick={logout} className="py-1.5 border-b border-transparent text-black/60 hover:text-ink uppercase">Log out</button>
        </nav>}
        {!onLogin && (
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
            className="md:hidden justify-self-end col-start-3 min-h-11 min-w-11 px-2 -mr-2 flex items-center gap-2 ow-nav"
          >
            <span>{open ? "Close" : "Menu"}</span>
            <span aria-hidden className="relative block w-5 h-3">
              <span className={`absolute left-0 w-5 h-px bg-ink transition-transform ${open ? "top-1.5 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 w-5 h-px bg-ink transition-transform ${open ? "top-1.5 -rotate-45" : "top-3"}`} />
            </span>
          </button>
        )}
      </div>
      {open && (
        <nav id="mobile-menu" className="md:hidden border-t border-line bg-white max-h-[calc(100dvh-4rem)] overflow-y-auto">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} onClick={() => setOpen(false)}
              className={`flex items-center justify-between safe-x h-14 border-b border-line ow-nav text-sm ${active(n.href) ? "text-ink" : "text-black/60"}`}>
              {n.label}
              {active(n.href) && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-ink" />}
            </Link>
          ))}
          <button onClick={logout} className="w-full text-left safe-x h-14 ow-nav text-sm text-black/60 uppercase">Log out</button>
        </nav>
      )}
    </header>
  );
}
