import type { Metadata } from "next";
import { LinkButton } from "@/components/link-button";

export const metadata: Metadata = { title: "Page not found" };

/** Branded 404, in the studio's own layout. */
export default function NotFound() {
  return (
    <div className="pt-24 pb-12 max-w-lg">
      <div className="ow-eyebrow mb-3">404</div>
      <h1 className="ow-display text-4xl md:text-5xl mb-4">This page does not exist</h1>
      <p className="text-black/60 mb-8">The link may be old, or the page has moved.</p>
      <LinkButton href="/">Back to the studio</LinkButton>
    </div>
  );
}
