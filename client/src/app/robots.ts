import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW } from "@/lib/private-routes";
import { SITE_URL } from "@/lib/server";

/**
 * Personal and transactional pages stay out of search; catalog, items and wardrobes are open.
 * robots.txt is only a hint: those pages are closed by the API's auth and carry X-Robots-Tag: noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ROBOTS_DISALLOW,
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
