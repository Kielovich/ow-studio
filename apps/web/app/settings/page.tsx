import { PageTitle } from "@/components/page-title";
import { DEFAULT_PROFILE, MONTHLY_BUDGET_USD } from "@/lib/server/repo";

export default function SettingsPage() {
  const p = DEFAULT_PROFILE;
  const rows: [string, string][] = [
    ["Provider", `${p.id} (Nano Banana Pro)`],
    ["Profile version", `${p.version}${p.verified ? "" : " · not yet capability-tested"}`],
    ["Reference images", `up to ${p.maxRefs}, of which ${p.maxIdentityRefs} of the person`],
    ["Concurrent generations", String(p.concurrency)],
    ["Estimated cost per image", `$${p.estimatedCostUsd.toFixed(2)}`],
    ["Monthly budget", `$${MONTHLY_BUDGET_USD.toFixed(2)} (OW_BUDGET_USD)`],
    ["Background", "Normalised to RGB 241 after generation"],
    ["Retries", "Automatic only for non-billable errors; paid retries need approval"],
  ];
  return (
    <>
      <PageTitle eyebrow="Configuration" title="Settings" />
      <dl className="border-t border-line max-w-3xl">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[240px_1fr] py-4 border-b border-line">
            <dt className="ow-eyebrow pt-0.5">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
