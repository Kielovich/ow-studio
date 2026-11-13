import { Suspense } from "react";
import { NewProduction } from "@/components/new-production";

export default function NewProductionPage() {
  return (
    <Suspense>
      <NewProduction />
    </Suspense>
  );
}
