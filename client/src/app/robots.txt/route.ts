import { ROBOTS_DISALLOW } from "@/lib/private-routes";
import { SITE_URL } from "@/lib/server";

/**
 * robots.txt, written by hand rather than by Next's robots() so it can carry Yandex's Clean-param, which Next's
 * format has no field for. Personal and transactional pages stay out of search; catalog, items, wardrobes and the
 * journal are open. robots.txt is only a hint: those pages are also closed by the API's auth and carry
 * X-Robots-Tag: noindex (next.config.ts).
 *
 * No «Host:» line: Yandex dropped it in 2018 and takes the main mirror from the 301 redirects (www and the Railway
 * host go to ichiba.by). Clean-param tells Yandex that ad and tracking tags never change a page, so a link shared
 * with ?utm_source=… is not crawled and indexed as a page of its own; Google ignores the line and relies on the
 * canonical link, which every public page has.
 */
export const dynamic = "force-static";

const TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "yclid", "ysclid", "gclid", "fbclid", "_openstat", "from"];

export function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
    "",
    `Clean-param: ${TRACKING.join("&")}`,
    "",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
