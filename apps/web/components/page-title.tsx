export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="pt-12 pb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
      <div>
        {eyebrow ? <div className="ow-eyebrow mb-3">{eyebrow}</div> : null}
        <h1 className="ow-display text-4xl md:text-5xl">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap gap-3">{children}</div> : null}
    </div>
  );
}
