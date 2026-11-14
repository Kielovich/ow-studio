import { Suspense } from "react";
import { ModelDetail } from "@/components/model-library";

export default function ModelPage() {
  return (
    <Suspense fallback={<div className="pt-12 h-96" />}>
      <ModelDetail />
    </Suspense>
  );
}
