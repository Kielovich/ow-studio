import Link from "next/link";

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  download?: string;
  disabled?: boolean;
};

/** A link styled with HeroUI's button classes, so navigation stays a real link (no button nested in an anchor). */
export function LinkButton({ href, children, variant = "primary", size = "md", download, disabled }: Props) {
  const className = `button button--${variant} button--${size} inline-flex items-center justify-center ${disabled ? "pointer-events-none opacity-50" : ""}`;
  if (download !== undefined || href.startsWith("/api/")) {
    return <a href={href} download={download} className={className} aria-disabled={disabled}>{children}</a>;
  }
  return <Link href={href} className={className} aria-disabled={disabled}>{children}</Link>;
}
