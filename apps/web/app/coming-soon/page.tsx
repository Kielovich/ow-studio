import type { Metadata } from "next";
import { Chip } from "@heroui/react";
import { PageTitle } from "@/components/page-title";
import { COMING_SOON } from "@/lib/coming-soon";

export const metadata: Metadata = { title: "Coming soon" };

export default function ComingSoonPage() {
  return (
    <>
      <PageTitle eyebrow="What's next" title="Coming soon" />
      <p className="text-black/70 max-w-2xl mb-12">New tools for the same models and the same studio standard. They are not available yet.</p>
      <div className="grid md:grid-cols-3 gap-x-8 gap-y-12">
        {COMING_SOON.map((f) => (
          <section key={f.id} id={f.id} className="border-t border-ink pt-6" data-testid="coming-soon-item">
            <div className="mb-6">
              <Chip size="sm">Coming soon</Chip>
            </div>
            <h2 className="ow-display text-3xl mb-3">{f.title}</h2>
            <p className="ow-nav mb-4">{f.line}</p>
            <p className="text-black/70 leading-relaxed">{f.body}</p>
          </section>
        ))}
      </div>
    </>
  );
}
