import Link from "next/link";
import type { LandingData } from "@/lib/landing";
import { serverFetch } from "@/lib/server";
import { ItemCard } from "../item-card";

/**
 * «Сейчас на ichiba»: live items from a brand or category page inside an article, so the text leads into the shop.
 * `path` is a landing path (c/jeans, c/women/outerwear, brands/mirarwear); `market` picks new or second-hand.
 * Rendered on the server from the landing cache and refreshed with the page; nothing when the page has no items.
 */
export async function Items({ path, market, limit = 4, title = "Сейчас на ichiba" }: { path: string; market?: "brands" | "resale"; limit?: number; title?: string }) {
  const d = await serverFetch<LandingData>(`/seo/landing?path=${encodeURIComponent(path.replace(/^\//, ""))}`, 600);
  if (!d) return null;
  const sections = market ? d.sections.filter((s) => s.market === market) : d.sections;
  const items = sections.flatMap((s) => s.items).slice(0, limit);
  if (!items.length) return null;
  const total = sections.reduce((n, s) => n + s.total, 0);
  return (
    <section className="not-prose my-8" aria-label={`${title}: ${d.name}`} data-track="article_item_click">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold tracking-tight">
          {title} <span className="font-normal text-muted">· {d.name}</span>
        </h3>
        <Link href={`/${d.path}`} className="shrink-0 text-sm font-medium text-indigo hover:underline">
          Все {total}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((c) => (
          <ItemCard key={c.id} card={c} />
        ))}
      </div>
    </section>
  );
}
