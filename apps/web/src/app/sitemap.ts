import type { MetadataRoute } from "next";
import { serverFetch, SITE_URL } from "@/lib/server";

// Rebuilt at most once an hour; listings and wardrobes come from the API.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await serverFetch<{ listings: Array<{ id: string; updatedAt: string }>; wardrobes: Array<{ username: string; updatedAt: string | null }> }>("/seo/sitemap", 3600);
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: now, changeFrequency: "hourly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date("2026-10-05"), changeFrequency: "yearly", priority: 0.2 },
    ...(data?.wardrobes ?? []).map((w) => ({ url: `${SITE_URL}/u/${encodeURIComponent(w.username)}`, lastModified: w.updatedAt ? new Date(w.updatedAt) : now, changeFrequency: "daily" as const, priority: 0.6 })),
    ...(data?.listings ?? []).map((l) => ({ url: `${SITE_URL}/item/${l.id}`, lastModified: new Date(l.updatedAt), changeFrequency: "daily" as const, priority: 0.8 })),
  ];
}
