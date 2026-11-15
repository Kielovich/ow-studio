import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { template: "%s · OW Studio", default: "OW Studio" },
  description: "On-model fashion imagery from packshots",
  robots: { index: false, follow: false },
  appleWebApp: { title: "OW Studio", statusBarStyle: "default" },
};

/** Draw edge to edge on notched iPhones; the layout keeps content inside the safe areas (.safe-x, .safe-bottom). */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<div className="h-20 border-b border-line" />}>
          <SiteHeader />
        </Suspense>
        <main className="flex-1 w-full max-w-[1440px] mx-auto safe-x pb-24">{children}</main>
        <footer className="bg-footer border-t border-line">
          <div className="max-w-[1440px] mx-auto safe-x pt-6 safe-bottom flex justify-between gap-4 ow-eyebrow">
            <span>OW Studio</span>
            <span>Internal production tool</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
