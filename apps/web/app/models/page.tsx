import type { Metadata } from "next";
import { ModelOverview } from "@/components/model-library";

export const metadata: Metadata = { title: "Models" };

export default function ModelsPage() {
  return <ModelOverview />;
}
