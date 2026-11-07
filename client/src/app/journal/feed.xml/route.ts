import { allArticles, articleHref, coverUrl } from "@/lib/journal";
import { SITE_URL } from "@/lib/server";

/** RSS of the journal for readers, Дзен and aggregators; linked from the journal's <head>. Built with the site. */
export const dynamic = "force-static";
export const revalidate = 3600;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET() {
  const all = (await allArticles()).filter((a) => !a.draft);
  const items = all
    .map(
      (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE_URL}${articleHref(a.slug)}</link>
      <guid isPermaLink="true">${SITE_URL}${articleHref(a.slug)}</guid>
      <description>${esc(a.description)}</description>
      <category>${esc(a.rubric.name)}</category>
      <author>${esc(a.author.name)}</author>
      <pubDate>${new Date(`${a.publishedAt}T09:00:00+03:00`).toUTCString()}</pubDate>${a.cover ? `\n      <enclosure url="${coverUrl(a.cover)}" type="image/${a.cover.endsWith(".png") ? "png" : a.cover.endsWith(".webp") ? "webp" : "jpeg"}" length="0"/>` : ""}
    </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Журнал ichiba</title>
    <link>${SITE_URL}/journal</link>
    <atom:link href="${SITE_URL}/journal/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Как покупать и продавать вещи из гардеробов: гиды, белорусские бренды, винтаж, уход, цены по данным ichiba.</description>
    <language>ru</language>
    <lastBuildDate>${(all[0] ? new Date(`${all[0].updatedAt}T09:00:00+03:00`) : new Date()).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
