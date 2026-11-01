import type { Metadata } from "next";
import Link from "next/link";
import { ArticleCard, ArticleHero } from "@/components/journal/article-card";
import { SellBand, TitleWithKanji } from "@/components/sections";
import { EmptyState } from "@/components/ui";
import { allArticles, articleHref, rubricHref } from "@/lib/journal";
import { RUBRICS } from "@/lib/journal-rubrics";
import { jsonLd, SITE_URL } from "@/lib/server";

/**
 * The journal's front page: the newest article on the whole width, the rest in a grid, the six sections as cards.
 * Everything is in the server HTML. Built once and refreshed every 10 minutes (the item strips inside articles
 * change; the list changes only with a deploy).
 */
export const revalidate = 600;

const DESCRIPTION = "Как покупать и продавать вещи из гардеробов: гиды по продаже и покупке б/у одежды, белорусские бренды, винтаж, уход за вещами и цены по данным ichiba.";

export async function generateMetadata(): Promise<Metadata> {
  const n = (await allArticles()).length;
  return {
    title: "Журнал ichiba — как покупать и продавать вещи из гардеробов",
    description: DESCRIPTION,
    alternates: { canonical: `${SITE_URL}/journal`, types: { "application/rss+xml": `${SITE_URL}/journal/feed.xml` } },
    // An empty journal is not a search result yet.
    robots: n ? undefined : { index: false, follow: true },
    openGraph: { type: "website", url: `${SITE_URL}/journal`, title: "Журнал ichiba", description: DESCRIPTION },
  };
}

export default async function JournalPage() {
  const all = await allArticles();
  const [first, ...rest] = all;
  const counts = new Map(RUBRICS.map((r) => [r.slug, all.filter((a) => a.rubric.slug === r.slug).length]));
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Журнал ichiba",
      url: `${SITE_URL}/journal`,
      description: DESCRIPTION,
      inLanguage: "ru",
      isPartOf: { "@type": "WebSite", name: "ichiba", url: SITE_URL },
      hasPart: all.slice(0, 20).map((a) => ({ "@type": "Article", headline: a.title, url: `${SITE_URL}${articleHref(a.slug)}`, datePublished: a.publishedAt })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ichiba", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Журнал", item: `${SITE_URL}/journal` },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-muted">
        <Link href="/" className="hover:text-ink">Главная</Link> / <span className="text-ink-2">Журнал</span>
      </nav>
      <header className="max-w-3xl">
        <TitleWithKanji kanji="読物">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Журнал</h1>
        </TitleWithKanji>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-2">Как покупать и продавать вещи из гардеробов: гиды, цены, бренды Беларуси. Без воды — с цифрами с площадки и ответами на вопросы, которые задают нам продавцы и покупатели.</p>
      </header>

      <nav aria-label="Рубрики" className="mt-6">
        <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {RUBRICS.map((r) => (
            <li key={r.slug}>
              <Link href={rubricHref(r.slug)} className="chip inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium">
                {r.name}
                {counts.get(r.slug) ? <span className="text-muted">{counts.get(r.slug)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {first ? (
        <section className="mt-8" aria-label="Новое">
          <ArticleHero a={first} />
        </section>
      ) : (
        <EmptyState kanji="読物" title="Первые статьи уже пишутся" hint="Скоро здесь появятся гиды по продаже и покупке вещей, обзоры белорусских брендов и цены по данным площадки.">
          <Link href="/resale" className="btn-wa btn-wa-ink inline-flex h-11 items-center px-5 text-sm font-medium">
            Пока — на Вторичку
          </Link>
        </EmptyState>
      )}

      {rest.length > 0 && (
        <section className="mt-10" aria-label="Статьи">
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((a, i) => (
              <ArticleCard key={a.slug} a={a} eager={i < 3} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-14" aria-labelledby="rubrics-title">
        <h2 id="rubrics-title" className="text-2xl font-bold leading-tight md:text-[28px]">
          Рубрики
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RUBRICS.map((r) => (
            <Link key={r.slug} href={rubricHref(r.slug)} className="group flex gap-4 rounded-3xl bg-surface p-5 transition-shadow hover:shadow-paper">
              <span className="shrink-0 font-brush text-[15px] leading-none tracking-[0.15em] text-shu [writing-mode:vertical-rl]" aria-hidden>
                {r.kanji}
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold leading-snug tracking-tight group-hover:underline group-hover:underline-offset-4">{r.name}</span>
                <span className="mt-1.5 line-clamp-3 block text-[15px] leading-relaxed text-ink-2">{r.description}</span>
                {counts.get(r.slug) ? <span className="mt-2 block text-sm text-muted">{counts.get(r.slug)} ст.</span> : null}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-14">
        <SellBand />
      </div>
    </div>
  );
}
