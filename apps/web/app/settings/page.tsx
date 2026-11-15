import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { ResetTipsButton } from "@/components/help";
import { DEFAULT_PROFILE, MONTHLY_BUDGET_USD, spentThisMonthUsd } from "@/lib/server/repo";

export const metadata: Metadata = { title: "Settings" };

/** Values come from the runtime environment (budget), so they are read per request, not frozen at build time. */
async function SettingsRows() {
  await connection();
  const p = DEFAULT_PROFILE;
  const rows: [string, string][] = [
    ["Cost per image", `About $${p.estimatedCostUsd.toFixed(2)}. A new attempt of a rejected image costs the same.`],
    ["Monthly budget", `$${MONTHLY_BUDGET_USD.toFixed(2)}, spent this month $${spentThisMonthUsd().toFixed(2)}. Runs that would go over the budget are stopped.`],
    ["Delivery", "2000 x 2000 px JPEG (sRGB), approved images only, as a ZIP per production"],
    ["Background", "Light grey studio background (RGB 241) on every image"],
  ];
  return (
    <dl className="border-t border-line max-w-3xl">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-1 sm:grid-cols-[240px_1fr] sm:gap-0 py-4 border-b border-line">
          <dt className="ow-eyebrow pt-0.5">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageTitle eyebrow="Configuration" title="Settings" />
      <Suspense fallback={<div className="h-80" />}>
        <SettingsRows />
      </Suspense>
      <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-3 max-w-3xl">
        <p className="text-sm text-black/60 flex-1">Closed a tip box by mistake? Bring all the tips back.</p>
        <ResetTipsButton />
      </div>
    </>
  );
}
