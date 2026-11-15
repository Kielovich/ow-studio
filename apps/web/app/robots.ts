import type { MetadataRoute } from "next";

/** An internal tool behind a password: nothing to index. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
