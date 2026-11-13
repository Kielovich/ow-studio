import { connection } from "next/server";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { DEFAULT_PROFILE, MONTHLY_BUDGET_USD } from "@/lib/server/repo";

/** Values come from the runtime environment (budget), so they are read per request, not frozen at build time. */
async function SettingsRows() {
  await connection();
  const p = DEFAULT_PROFILE;
  const rows: [string, string][] = [
    ["Provider", `${p.id} (Nano Banana Pro)`],
    ["Profile version", `${p.version}${p.verified ? "" : " · not yet capability-tested"}`],
    ["Reference images", `up to ${p.maxRefs}, of which ${p.maxIdentityRefs} of the person`],
    ["Concurrent generations", String(p.concurrency)],
    ["Estimated cost per image", `$${p.estimatedCostUsd.toFixed(2)}`],
    ["Monthly budget", `$${MONTHLY_BUDGET_USD.toFixed(2)} (OW_BUDGET_USD)`],
    ["Delivery", "2000 x 2000 px JPEG, sRGB, from the 2048 px 2K output"],
    ["Background", "Normalised to RGB 241 after generation"],
    ["Retries", "Automatic only for non-billable errors; paid retries need approval"],
  ];
  return (
    <dl className="border-t border-line max-w-3xl">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[240px_1fr] py-4 border-b border-line">
          <dt className="ow-eyebrow pt-0.5">{k}</dt>
          <dd>{v}</dd>
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
    </>
  );
}
