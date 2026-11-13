import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "OW Studio",
  description: "On-model fashion imagery from packshots",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<div className="h-20 border-b border-line" />}>
          <SiteHeader />
        </Suspense>
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 md:px-10 pb-24">{children}</main>
        <footer className="bg-footer border-t border-line">
          <div className="max-w-[1440px] mx-auto px-6 md:px-10 py-6 flex justify-between ow-eyebrow">
            <span>OW Studio</span>
            <span>Internal production tool</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
