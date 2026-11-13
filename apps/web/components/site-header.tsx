"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Studio" },
  { href: "/productions/new", label: "New production" },
  { href: "/productions", label: "Productions" },
  { href: "/models", label: "Models" },
  { href: "/settings", label: "Settings" },
];

export function SiteHeader() {
  const path = usePathname();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login"); // full load: drop every cached authenticated page
  };
  const active = (href: string) => (href === "/" ? path === "/" : path === href || (href !== "/productions" && path.startsWith(href)) || (href === "/productions" && path.startsWith("/productions") && !path.startsWith("/productions/new")));
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 h-20 grid grid-cols-[1fr_auto_1fr] items-center">
        <nav className="hidden md:flex gap-7 ow-nav">
          {NAV.slice(0, 3).map((n) => (
            <Link key={n.href} href={n.href} className={`pb-0.5 border-b ${active(n.href) ? "border-ink" : "border-transparent text-black/60 hover:text-ink"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/" aria-label="OW Studio home" className="flex items-center gap-3 justify-self-center col-start-2">
          <Image src="/brand/ow-logo-black.png" alt="OW" width={60} height={31} priority />
          <span className="ow-eyebrow hidden sm:inline">Studio</span>
        </Link>
        <nav className="hidden md:flex gap-7 ow-nav justify-self-end col-start-3">
          {NAV.slice(3).map((n) => (
            <Link key={n.href} href={n.href} className={`pb-0.5 border-b ${active(n.href) ? "border-ink" : "border-transparent text-black/60 hover:text-ink"}`}>
              {n.label}
            </Link>
          ))}
          {path !== "/login" && <button onClick={logout} className="pb-0.5 border-b border-transparent text-black/60 hover:text-ink uppercase">Log out</button>}
        </nav>
      </div>
      <nav className="md:hidden flex gap-5 overflow-x-auto px-6 pb-3 ow-nav whitespace-nowrap">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={active(n.href) ? "text-ink" : "text-black/50"}>{n.label}</Link>
        ))}
      </nav>
    </header>
  );
}
