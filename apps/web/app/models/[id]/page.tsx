import type { Metadata } from "next";
import { Suspense } from "react";
import { ModelDetail } from "@/components/model-library";

export const metadata: Metadata = { title: "Model" };

export default function ModelPage() {
  return (
    <Suspense fallback={<div className="pt-12 h-96" />}>
      <ModelDetail />
    </Suspense>
  );
}
