import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/server";

/** Personal and transactional pages stay out of search; catalog, items and wardrobes are open. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/sell", "/settings", "/cart", "/messages", "/deals", "/buy", "/purchases", "/sales", "/notifications", "/welcome", "/favorites", "/following", "/wardrobe", "/item/*/edit"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
