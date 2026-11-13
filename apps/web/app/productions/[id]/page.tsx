import { Suspense } from "react";
import { ProductionView } from "@/components/production-view";

export default function ProductionPage() {
  return (
    <Suspense fallback={<div className="pt-12 h-96" />}>
      <ProductionView />
    </Suspense>
  );
}
