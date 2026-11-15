import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductionView } from "@/components/production-view";

export const metadata: Metadata = { title: "Production" };

export default function ProductionPage() {
  return (
    <Suspense fallback={<div className="pt-12 h-96" />}>
      <ProductionView />
    </Suspense>
  );
}
