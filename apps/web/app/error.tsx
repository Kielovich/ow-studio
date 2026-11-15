"use client";

import { useEffect } from "react";
import { Button } from "@heroui/react";
import { LinkButton } from "@/components/link-button";

/** Shown when a page fails unexpectedly: what happened, and two ways on. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="pt-24 pb-12 max-w-lg" role="alert">
      <div className="ow-eyebrow mb-3">Error</div>
      <h1 className="ow-display text-4xl md:text-5xl mb-4">Something went wrong</h1>
      <p className="text-black/60 mb-8">The page could not be shown. Try again, or go back to the studio.</p>
      <div className="flex flex-wrap gap-3">
        <Button onPress={() => retry()}>Try again</Button>
        <LinkButton href="/" variant="secondary">Back to the studio</LinkButton>
      </div>
    </div>
  );
}
