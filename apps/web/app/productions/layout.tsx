import type { Metadata } from "next";

/** Title for the productions list (a client page); the pages below it set their own, with the same suffix. */
export const metadata: Metadata = { title: { default: "Productions", template: "%s · OW Studio" } };

export default function ProductionsLayout({ children }: LayoutProps<"/productions">) {
  return children;
}
