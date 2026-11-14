/** Square product-image tile on the brand canvas colour (RGB 241). `contain` shows a wide image (a character sheet) whole. */
export function Tile({ src, alt, className = "", fit = "cover", children }: { src?: string; alt: string; className?: string; fit?: "cover" | "contain"; children?: React.ReactNode }) {
  return (
    <div className={`relative aspect-square bg-canvas overflow-hidden ${className}`}>
      {src ? <img src={src} alt={alt} loading="lazy" className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`} /> : null}
      {children}
    </div>
  );
}
