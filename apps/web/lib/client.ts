"use client";

/**
 * Client-side JSON fetch used by every page: an expired session sends the user to the login (and back here afterwards),
 * a missing resource resolves to { notFound: true }, any other failure throws so the page can show an error state.
 */
export async function getJson<T>(url: string): Promise<T | { notFound: true }> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    return new Promise<never>(() => {}); // navigation in progress
  }
  if (r.status === 404) return { notFound: true };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const isNotFound = (x: unknown): x is { notFound: true } => !!x && typeof x === "object" && (x as { notFound?: boolean }).notFound === true;
