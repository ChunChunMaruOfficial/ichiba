import type { MetadataRoute } from "next";
import { allArticles, articleHref, rubricHref } from "@/lib/journal";
import { RUBRICS } from "@/lib/journal-rubrics";
import { landingHref, type LandingEntry } from "@/lib/landing";
import { serverFetch, SITE_URL } from "@/lib/server";

// Built on each request from the API's answers, which are cached for 15 minutes (serverFetch), so new items reach
// Google soon. Not prerendered: at build time the API isn't reachable from the build, so the deploy's own copy listed
// only the 8 static pages and search engines got that near-empty map until the first refresh after every deploy.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [data, landings, articles] = await Promise.all([
    serverFetch<{ listings: Array<{ id: string; path?: string; updatedAt: string; images?: string[] }>; wardrobes: Array<{ username: string; updatedAt: string | null }> }>("/seo/sitemap", 900),
    serverFetch<LandingEntry[]>("/seo/landings", 900),
    allArticles(),
  ]);
  const published = articles.filter((a) => !a.draft);
  const now = new Date();
  // lastmod is the newest change the page actually shows, not «now»: a date that moves on every fetch tells search
  // engines nothing, and Google stops trusting a sitemap's lastmod once it learns that.
  const newest = (dates: Array<string | null | undefined>) => {
    const t = dates.reduce((m, d) => Math.max(m, d ? Date.parse(d) || 0 : 0), 0);
    return t ? new Date(t) : now;
  };
  const listingsAt = newest((data?.listings ?? []).map((l) => l.updatedAt));
  const wardrobesAt = newest((data?.wardrobes ?? []).map((w) => w.updatedAt));
  const brandsAt = newest((landings ?? []).filter((p) => p.kind === "brand").map((p) => p.updatedAt));
  // The journal: the front page and the sections only once they have articles (empty ones are noindex), lastmod = the
  // newest article's change; each article at its own date of writing or honest update.
  const journal: MetadataRoute.Sitemap = published.length
    ? [
        { url: `${SITE_URL}/journal`, lastModified: new Date(published[0].updatedAt), changeFrequency: "weekly", priority: 0.7 },
        ...RUBRICS.flatMap((r) => {
          const own = published.filter((a) => a.rubric.slug === r.slug);
          return own.length ? [{ url: `${SITE_URL}${rubricHref(r.slug)}`, lastModified: new Date(own[0].updatedAt), changeFrequency: "weekly" as const, priority: 0.6 }] : [];
        }),
        ...published.map((a) => ({ url: `${SITE_URL}${articleHref(a.slug)}`, lastModified: new Date(a.updatedAt), changeFrequency: "monthly" as const, priority: 0.7, images: a.cover ? [`${SITE_URL}${a.cover}`] : undefined })),
      ]
    : [];
  return [
    ...journal,
    { url: SITE_URL, lastModified: listingsAt, changeFrequency: "hourly", priority: 1 },
    // /search is not listed: its pages are noindex (search/page.tsx).
    { url: `${SITE_URL}/wardrobes`, lastModified: wardrobesAt, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/resale`, lastModified: listingsAt, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/brands`, lastModified: brandsAt, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/contacts`, lastModified: new Date("2026-11-05"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/presentation`, lastModified: new Date("2026-11-03"), changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date("2026-11-05"), changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: new Date("2026-11-05"), changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/rules`, lastModified: new Date("2026-11-05"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/complaint`, lastModified: new Date("2026-11-05"), changeFrequency: "yearly", priority: 0.2 },
    // Brand and category pages: only those with enough live items (the API's whitelist), lastmod = their newest change.
    ...(landings ?? []).map((p) => ({ url: `${SITE_URL}${landingHref(p.path)}`, lastModified: new Date(p.updatedAt), changeFrequency: "daily" as const, priority: p.kind === "category" || p.kind === "brand" ? 0.8 : 0.7 })),
    ...(data?.wardrobes ?? []).map((w) => ({ url: `${SITE_URL}/u/${encodeURIComponent(w.username)}`, lastModified: w.updatedAt ? new Date(w.updatedAt) : now, changeFrequency: "daily" as const, priority: 0.6 })),
    // Items at their /item/<id>-<slug> address, with their photos for image search.
    ...(data?.listings ?? []).map((l) => ({ url: `${SITE_URL}/item/${l.path ?? l.id}`, lastModified: new Date(l.updatedAt), changeFrequency: "daily" as const, priority: 0.8, images: l.images?.length ? l.images : undefined })),
  ];
}
