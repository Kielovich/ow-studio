/** Square product-image tile on the brand canvas colour (RGB 241). */
export function Tile({ src, alt, className = "", children }: { src?: string; alt: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`relative aspect-square bg-canvas overflow-hidden ${className}`}>
      {src ? <img src={src} alt={alt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : null}
      {children}
    </div>
  );
}
