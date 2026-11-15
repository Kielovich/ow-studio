import type { Metadata } from "next";
import { Suspense } from "react";
import { ModelBuilder } from "@/components/model-builder";

export const metadata: Metadata = { title: "Model builder" };

export default function ModelBuilderPage() {
  return (
    <Suspense fallback={<div className="pt-12 min-h-[100svh]" />}>
      <ModelBuilder />
    </Suspense>
  );
}
