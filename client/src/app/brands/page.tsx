import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { landingHref, type LandingEntry } from "@/lib/landing";
import { jsonLd, serverFetch, SITE_URL } from "@/lib/server";

/**
 * Every brand with a page of its own (enough live items, see seo/landing.ts), A to Я: the way into the brand pages
 * for people who look for a brand and for search engines that follow the links.
 */

const load = async () => {
  // Rendered per request (from cached API data): a build-time copy would fail the build whenever the API being deployed
  // alongside doesn't answer yet, and an empty one would stay cached.
  await connection();
  const all = await serverFetch<LandingEntry[]>("/seo/landings", 600);
  return all && all.filter((e) => e.kind === "brand" && e.brand).sort((a, b) => a.brand!.localeCompare(b.brand!, "ru", { sensitivity: "base" }));
};

const countWord = (n: number) => (n % 100 >= 11 && n % 100 <= 14 ? "брендов" : n % 10 === 1 ? "бренд" : n % 10 >= 2 && n % 10 <= 4 ? "бренда" : "брендов");

export async function generateMetadata(): Promise<Metadata> {
  const brands = await load();
  const top = [...(brands ?? [])].sort((a, b) => b.count - a.count).slice(0, 4).map((b) => b.brand);
  return {
    title: "Бренды одежды — купить новые и б/у вещи в Беларуси",
    description: brands?.length
      ? `${brands.length} ${countWord(brands.length)} одежды, обуви и аксессуаров в продаже на ichiba: ${top.join(", ")} и другие. Новые вещи и б/у с доставкой по Беларуси.`
      : "Бренды одежды, обуви и аксессуаров на ichiba: новые вещи и б/у в Беларуси.",
    alternates: { canonical: `${SITE_URL}/brands` },
    robots: brands?.length ? undefined : { index: false, follow: true },
  };
}

/** «A», «Б», «#»: the brand's first letter for the index. */
const letterOf = (name: string) => {
  const c = name.trim()[0]?.toUpperCase() ?? "#";
  return /[A-ZА-ЯЁ]/.test(c) ? c : "#";
};

export default async function BrandsPage() {
  const brands = await load();
  // API trouble: the error boundary offers a retry, and nothing broken is cached.
  if (!brands) throw new Error("Страница временно недоступна");
  const popular = [...brands].sort((a, b) => b.count - a.count).slice(0, 12);
  const letters = new Map<string, LandingEntry[]>();
  for (const b of brands) letters.set(letterOf(b.brand!), [...(letters.get(letterOf(b.brand!)) ?? []), b]);

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Бренды на ichiba",
      url: `${SITE_URL}/brands`,
      numberOfItems: brands.length,
      itemListElement: brands.map((b, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}${landingHref(b.path)}`, name: b.brand })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ichiba", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Бренды", item: `${SITE_URL}/brands` },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-muted">
        <Link href="/" className="hover:text-ink">Главная</Link> / <span className="text-ink-2">Бренды</span>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Бренды</h1>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">
        {brands.length
          ? `${brands.length} ${countWord(brands.length)}, у которых сейчас есть вещи в продаже: новые в каталоге брендов и б/у на «Вторичке». На странице бренда — все его вещи, цены и разделы.`
          : "Скоро здесь появятся бренды, у которых есть вещи в продаже."}
      </p>

      {popular.length > 0 && (
        <section className="mt-6" aria-labelledby="popular">
          <h2 id="popular" className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Больше всего вещей</h2>
          <ul className="flex flex-wrap gap-2">
            {popular.map((b) => (
              <li key={b.path}>
                <Link href={landingHref(b.path)} className="chip inline-flex h-9 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium">
                  {b.brand} <span className="text-muted">{b.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {letters.size > 1 && (
        <nav aria-label="Алфавит" className="mt-8 flex flex-wrap gap-1 text-sm">
          {[...letters.keys()].map((l) => (
            <a key={l} href={`#letter-${l}`} className="grid size-8 place-items-center rounded-lg font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
              {l}
            </a>
          ))}
        </nav>
      )}

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
        {[...letters].map(([l, list]) => (
          <section key={l} id={`letter-${l}`} className="scroll-mt-24" aria-label={l}>
            <h2 className="mb-2 font-display text-2xl font-semibold text-ink">{l}</h2>
            <ul className="flex flex-col gap-1.5">
              {list.map((b) => (
                <li key={b.path}>
                  <Link href={landingHref(b.path)} className="text-[15px] text-ink-2 hover:text-ink hover:underline">
                    {b.brand} <span className="text-sm text-muted">{b.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
