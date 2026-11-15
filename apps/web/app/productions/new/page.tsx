import type { Metadata } from "next";
import { Suspense } from "react";
import { NewProduction } from "@/components/new-production";

export const metadata: Metadata = { title: "New production" };

export default function NewProductionPage() {
  return (
    <Suspense>
      <NewProduction />
    </Suspense>
  );
}
