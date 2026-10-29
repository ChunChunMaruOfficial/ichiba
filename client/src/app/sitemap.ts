import type { MetadataRoute } from "next";
import { landingHref, type LandingEntry } from "@/lib/landing";
import { serverFetch, SITE_URL } from "@/lib/server";

// Rebuilt at most every 15 minutes, so new items reach Google soon; listings and wardrobes come from the API.
export const revalidate = 900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [data, landings] = await Promise.all([
    serverFetch<{ listings: Array<{ id: string; path?: string; updatedAt: string; images?: string[] }>; wardrobes: Array<{ username: string; updatedAt: string | null }> }>("/seo/sitemap", 900),
    serverFetch<LandingEntry[]>("/seo/landings", 900),
  ]);
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "hourly", priority: 1 },
    // /search is not listed: its pages are noindex (search/page.tsx).
    { url: `${SITE_URL}/wardrobes`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/resale`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/brands`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date("2026-10-11"), changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: new Date("2026-10-11"), changeFrequency: "yearly", priority: 0.2 },
    // Brand and category pages: only those with enough live items (the API's whitelist), lastmod = their newest change.
    ...(landings ?? []).map((p) => ({ url: `${SITE_URL}${landingHref(p.path)}`, lastModified: new Date(p.updatedAt), changeFrequency: "daily" as const, priority: p.kind === "category" || p.kind === "brand" ? 0.8 : 0.7 })),
    ...(data?.wardrobes ?? []).map((w) => ({ url: `${SITE_URL}/u/${encodeURIComponent(w.username)}`, lastModified: w.updatedAt ? new Date(w.updatedAt) : now, changeFrequency: "daily" as const, priority: 0.6 })),
    // Items at their /item/<id>-<slug> address, with their photos for image search.
    ...(data?.listings ?? []).map((l) => ({ url: `${SITE_URL}/item/${l.path ?? l.id}`, lastModified: new Date(l.updatedAt), changeFrequency: "daily" as const, priority: 0.8, images: l.images?.length ? l.images : undefined })),
  ];
}
