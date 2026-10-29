import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { itemHref } from "@/lib/item-path";
import { landingHref, type LandingData } from "@/lib/landing";
import { jsonLd, serverFetch, SITE_URL } from "@/lib/server";
import { Masonry } from "./masonry";

/**
 * A brand or category page (lib/landing.ts): the H1, a paragraph of real numbers, the items new and second-hand apart,
 * and links to the pages next to it. Everything is in the server HTML: these pages exist to be found by search.
 */

type Params = Promise<{ path: string[] }>;
type Root = "c" | "brands";

const load = (path: string) => serverFetch<LandingData>(`/seo/landing?path=${encodeURIComponent(path)}`, 600);

async function pathOf(root: Root, params: Params) {
  const segments = (await params).path.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      notFound();
    }
  });
  return [root, ...segments].join("/");
}

export async function landingMetadata(root: Root, params: Params): Promise<Metadata> {
  const d = await load(await pathOf(root, params));
  if (d === null) notFound();
  if (!d) return {};
  const url = `${SITE_URL}${landingHref(d.path)}`;
  const cover = d.sections.flatMap((s) => s.items).find((c) => c.cover)?.cover;
  return {
    title: d.title,
    description: d.description,
    alternates: { canonical: url },
    // Too few items to be worth a search result: the page still opens, its items are still followed.
    robots: d.indexable ? undefined : { index: false, follow: true },
    openGraph: { type: "website", url, title: d.name, description: d.description, images: cover ? [{ url: cover.urls.l, width: cover.width, height: cover.height }] : undefined },
  };
}

/** The same items in search, where they can be filtered further. */
function searchHref(d: LandingData, market: "brands" | "resale") {
  const q = new URLSearchParams();
  if (d.category) q.set("category", d.category);
  if (d.subcategory) q.set("subcategory", d.subcategory);
  if (d.brand) q.set("brand", d.brand);
  if (market === "resale") q.set("market", "resale");
  return `/search?${q}`;
}

const SECTION_TITLE = { brands: "Новое — каталог брендов", resale: "Вторичка" } as const;

export async function LandingPage({ root, params }: { root: Root; params: Params }) {
  const asked = await pathOf(root, params);
  const d = await load(asked);
  if (d === null) notFound();
  // API trouble: the error boundary offers a retry, and nothing broken is cached.
  if (!d) throw new Error("Страница временно недоступна");
  // One address per page: «/c/Jeans/» goes to «/c/jeans».
  if (asked !== d.path) permanentRedirect(landingHref(d.path));

  const url = `${SITE_URL}${landingHref(d.path)}`;
  const items = d.sections.flatMap((s) => s.items);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: d.name,
      url,
      numberOfItems: d.total,
      itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}${itemHref(c)}`, name: c.title })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [{ name: "ichiba", path: "" }, ...d.crumbs].map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE_URL}${c.path ? landingHref(c.path) : ""}` })),
    },
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-muted">
        <Link href="/" className="hover:text-ink">Главная</Link>
        {d.crumbs.map((c, i) =>
          i < d.crumbs.length - 1 ? (
            <span key={c.path}>
              {" / "}
              <Link href={landingHref(c.path)} className="hover:text-ink">{c.name}</Link>
            </span>
          ) : (
            <span key={c.path}> / <span className="text-ink-2">{c.name}</span></span>
          ),
        )}
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{d.name}</h1>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">{d.intro.join(" ")}</p>

      {d.links.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          {d.links.map((g) => (
            <div key={g.title}>
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{g.title}</h2>
              <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
                {g.links.map((l) => (
                  <li key={l.path}>
                    <Link href={landingHref(l.path)} className="chip inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium">
                      {l.name} <span className="text-muted">{l.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {d.sections.map((s) => (
        <section key={s.market} className="mt-8" aria-labelledby={`section-${s.market}`}>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id={`section-${s.market}`} className="text-xl font-semibold tracking-tight">
              {SECTION_TITLE[s.market]} <span className="text-base font-normal text-muted">{s.total}</span>
            </h2>
            {s.total > s.items.length && (
              <Link href={searchHref(d, s.market)} className="shrink-0 text-sm font-medium text-ink-2 underline underline-offset-4 hover:text-ink">
                Смотреть все {s.total}
              </Link>
            )}
          </div>
          <Masonry items={s.items} />
        </section>
      ))}
    </div>
  );
}
