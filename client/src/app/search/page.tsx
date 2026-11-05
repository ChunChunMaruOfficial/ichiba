import { permanentRedirect } from "next/navigation";

/**
 * Search lives on the home page (brands) and on «Вторичка» now (components/search-view.tsx): the old /search links
 * (bookmarks, shares, search engines) land there with the same query. A search started on «Вторичка» carried
 * market=resale; the page itself says that now.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value != null && k !== "market") q.set(k, value);
  }
  const resale = params.market === "resale";
  if (params.market === "all") q.set("market", "all");
  const query = q.toString();
  permanentRedirect(`${resale ? "/resale" : "/"}${query ? `?${query}` : ""}`);
}
