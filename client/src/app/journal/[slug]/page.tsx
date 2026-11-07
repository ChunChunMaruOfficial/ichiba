import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { MDXComponents } from "mdx/types";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { ArticleCard, Cover } from "@/components/journal/article-card";
import { ArticleTracker } from "@/components/journal/article-tracker";
import { AuthorCard, Byline } from "@/components/journal/author-card";
import { Brief, CatalogLinks, CtaSell, Faq } from "@/components/journal/blocks";
import { mdxComponents } from "@/components/journal/mdx-components";
import { Toc, TocMobile } from "@/components/journal/toc";
import { SellBand, TitleWithKanji } from "@/components/sections";
import { EmptyState } from "@/components/ui";
import { allArticles, article, articleHref, articlesIn, coverUrl, formatDate, relatedTo, rubricHref, type Article } from "@/lib/journal";
import { authorHref } from "@/lib/journal-authors";
import { isRubric, rubricBySlug, RUBRICS, type Rubric } from "@/lib/journal-rubrics";
import { og } from "@/lib/og";
import { jsonLd, SITE_URL, truncate } from "@/lib/server";

/**
 * /journal/<slug> is either a section's hub (slug in RUBRICS) or an article: a file in content/journal, or a reader's
 * article from the API. The files are built at deploy time; a reader's article published later is rendered on its
 * first visit (dynamicParams). Everything is refreshed every 10 minutes; an unknown slug is 404.
 */
export const revalidate = 600;
export const dynamicParams = true;

/**
 * A reader's article is plain Markdown: no MDX components, no HTML (every «<» is shown as typed), no pictures in the
 * text (the cover is the one picture), and links only to http(s) or the site itself, marked as user content.
 */
const communityComponents: MDXComponents = {
  a: ({ href = "", children }) => {
    if (href.startsWith("/") && !href.startsWith("//")) return <Link href={href}>{children}</Link>;
    if (!/^https?:\/\//i.test(href)) return <>{children}</>;
    return (
      <a href={href} rel="ugc nofollow noopener" target="_blank">
        {children}
      </a>
    );
  },
  img: () => null,
};

const compileBody = (a: Article) =>
  a.community
    ? compileMDX({ source: a.body.replace(/</g, "&lt;"), components: communityComponents, options: { mdxOptions: { format: "md", remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] } } })
    : compileMDX({ source: a.body, components: mdxComponents, options: { mdxOptions: { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] } } });

type Params = Promise<{ slug: string }>;

export async function generateStaticParams() {
  const articles = await allArticles();
  return [...RUBRICS.map((r) => ({ slug: r.slug })), ...articles.map((a) => ({ slug: a.slug }))];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const rubric = rubricBySlug(slug);
  if (rubric) {
    const n = (await articlesIn(slug)).length;
    const url = `${SITE_URL}${rubricHref(slug)}`;
    return {
      title: rubric.title,
      description: rubric.description,
      alternates: { canonical: url },
      robots: n ? undefined : { index: false, follow: true },
      openGraph: og(rubricHref(slug), { title: `${rubric.name} — Журнал ichiba`, description: rubric.description }),
    };
  }
  const a = await article(slug);
  if (!a) return {};
  const url = `${SITE_URL}${articleHref(a.slug)}`;
  return {
    title: truncate(a.title, 60),
    description: truncate(a.description, 158),
    alternates: { canonical: url },
    robots: a.draft ? { index: false, follow: false } : undefined,
    authors: [{ name: a.author.name, url: `${SITE_URL}${authorHref(a.author)}` }],
    openGraph: og(articleHref(a.slug), {
      type: "article",
      title: a.title,
      description: a.description,
      publishedTime: a.publishedAt,
      modifiedTime: a.updatedAt,
      section: a.rubric.name,
      tags: a.tags,
      authors: [a.author.name],
      images: a.cover ? [{ url: coverUrl(a.cover), alt: a.coverAlt ?? a.title }] : undefined,
    }),
  };
}

const crumbs = (items: Array<{ name: string; href?: string }>) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [{ name: "ichiba", href: "/" }, { name: "Журнал", href: "/journal" }, ...items].map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.href ? `${SITE_URL}${c.href === "/" ? "" : c.href}` : undefined })),
});

async function RubricPage({ rubric }: { rubric: Rubric }) {
  const list = await articlesIn(rubric.slug);
  const url = `${SITE_URL}${rubricHref(rubric.slug)}`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: rubric.name,
      url,
      description: rubric.description,
      inLanguage: "ru",
      isPartOf: { "@type": "WebSite", name: "ichiba", url: SITE_URL },
      hasPart: list.map((a) => ({ "@type": "Article", headline: a.title, url: `${SITE_URL}${articleHref(a.slug)}`, datePublished: a.publishedAt })),
    },
    crumbs([{ name: rubric.name }]),
  ];
  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-muted">
        <Link href="/" className="hover:text-ink">Главная</Link> / <Link href="/journal" className="hover:text-ink">Журнал</Link> / <span className="text-ink-2">{rubric.name}</span>
      </nav>
      <header className="max-w-3xl">
        <TitleWithKanji kanji={rubric.kanji}>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{rubric.name}</h1>
        </TitleWithKanji>
        <div className="mt-3 flex flex-col gap-3 text-[17px] leading-relaxed text-ink-2">
          {rubric.intro.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </header>

      <nav aria-label="Другие рубрики" className="mt-6">
        <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {RUBRICS.map((r) => (
            <li key={r.slug}>
              <Link href={rubricHref(r.slug)} aria-current={r.slug === rubric.slug ? "page" : undefined} className="chip inline-flex h-9 shrink-0 items-center whitespace-nowrap px-4 text-sm font-medium aria-[current=page]:bg-ink aria-[current=page]:text-accent-ink">
                {r.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {list.length ? (
        <section className="mt-10" aria-label="Статьи рубрики">
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((a, i) => (
              <ArticleCard key={a.slug} a={a} eager={i < 3} />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState kanji={rubric.kanji} title="Статьи этой рубрики ещё пишутся" hint="Загляните позже или посмотрите, что уже есть в журнале.">
          <Link href="/journal" className="btn-wa btn-wa-ink inline-flex h-11 items-center px-5 text-sm font-medium">
            В журнал
          </Link>
        </EmptyState>
      )}

      <div className="mt-12">
        <CatalogLinks title="Разделы каталога" links={rubric.catalog} />
      </div>
      <div className="mt-14">
        <SellBand />
      </div>
    </div>
  );
}

async function ArticlePage({ a }: { a: Article }) {
  const [{ content }, related] = await Promise.all([compileBody(a), relatedTo(a)]);
  const url = `${SITE_URL}${articleHref(a.slug)}`;
  const authorLd =
    a.author.kind === "person"
      ? { "@type": "Person", name: a.author.name, jobTitle: a.author.role, url: `${SITE_URL}${authorHref(a.author)}` }
      : { "@type": "Organization", name: a.author.name, url: `${SITE_URL}${authorHref(a.author)}` };
  const ld: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.title,
      description: a.description,
      image: a.cover ? [coverUrl(a.cover)] : undefined,
      datePublished: a.publishedAt,
      dateModified: a.updatedAt,
      author: authorLd,
      publisher: { "@type": "Organization", name: "ichiba", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.svg` } },
      mainEntityOfPage: url,
      inLanguage: "ru",
      articleSection: a.rubric.name,
      keywords: a.tags.join(", ") || undefined,
      wordCount: a.words,
    },
    crumbs([{ name: a.rubric.name, href: rubricHref(a.rubric.slug) }, { name: a.title }]),
  ];
  if (a.faq.length) {
    ld.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    });
  }
  const updated = a.updatedAt !== a.publishedAt;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <ArticleTracker slug={a.slug} rubric={a.rubric.slug} />
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,42rem)] lg:justify-center lg:gap-x-14">
        <div className="mx-auto max-w-[42rem] lg:col-start-2 lg:mx-0 lg:max-w-none">
          <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-muted">
            <Link href="/journal" className="hover:text-ink">Журнал</Link> / <Link href={rubricHref(a.rubric.slug)} className="hover:text-ink">{a.rubric.name}</Link>
          </nav>
          <header>
            {a.draft && <p className="mb-3 inline-flex rounded-full bg-warn-soft px-3 py-1 text-xs font-medium text-warn">Черновик — виден только в разработке</p>}
            {a.community && (
              <p className="mb-3 inline-flex rounded-full bg-kraft/70 px-3 py-1 text-xs font-medium text-kraft-ink">
                Колонка читателя ·{" "}
                <Link href="/journal/write" className="ml-1 underline underline-offset-2">
                  написать свою
                </Link>
              </p>
            )}
            <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight [text-wrap:balance] md:text-[2.75rem]">{a.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-2 md:text-[19px]">{a.description}</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Byline author={a.author} />
              <p className="text-sm text-muted">
                <time dateTime={a.publishedAt}>{formatDate(a.publishedAt)}</time>
                {updated && (
                  <>
                    {" "}
                    · обновлено <time dateTime={a.updatedAt}>{formatDate(a.updatedAt)}</time>
                  </>
                )}{" "}
                · {a.minutes} мин чтения
              </p>
            </div>
          </header>
          {a.cover && (
            <figure className="mt-8">
              <Cover a={a} sizes="(min-width: 1024px) 672px, 100vw" priority className="aspect-[3/2] rounded-3xl" />
              {a.coverAlt && <figcaption className="mt-2 text-sm text-muted">{a.coverAlt}</figcaption>}
            </figure>
          )}
          <div className="mt-8 flex flex-col gap-4">
            <Brief points={a.summary} />
            <TocMobile headings={a.headings} />
          </div>
        </div>

        <aside className="hidden lg:col-start-1 lg:row-start-2 lg:block">
          <Toc headings={a.headings} className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2" />
        </aside>

        <div className="mx-auto mt-6 max-w-[42rem] lg:col-start-2 lg:row-start-2 lg:mx-0 lg:mt-8 lg:max-w-none">
          <div className="journal-body">{content}</div>
          <CtaSell />
          <Faq items={a.faq} />
          {a.catalog.length > 0 && (
            <div className="mt-10">
              <CatalogLinks title="Смотреть в каталоге" links={a.catalog.map((p) => ({ path: p, name: catalogName(p) }))} />
            </div>
          )}
          <AuthorCard author={a.author} />
          <p className="mt-6 text-sm text-muted">
            Нашли неточность? Напишите нам на странице <Link href="/contacts" className="text-indigo hover:underline">контактов</Link> — мы проверим и обновим статью, указав дату правки.
          </p>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="related-title">
          <h2 id="related-title" className="text-2xl font-bold leading-tight md:text-[28px]">
            Читать дальше
          </h2>
          <div className="mt-5 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <ArticleCard key={r.slug} a={r} />
            ))}
          </div>
        </section>
      )}
      <div className="mt-14">
        <SellBand />
      </div>
    </div>
  );
}

/** A readable name for a catalogue path an article names: «c/jeans» → «Джинсы», «brands/mirarwear» → «mirarwear». */
function catalogName(path: string) {
  const known: Record<string, string> = {
    outerwear: "Верхняя одежда", tshirts: "Футболки", shirts: "Рубашки", knitwear: "Свитера и худи", trousers: "Брюки", jeans: "Джинсы", shorts: "Шорты",
    skirts: "Юбки", dresses: "Платья", suits: "Костюмы", swimwear: "Купальники и домашнее", shoes: "Обувь", bags: "Сумки", accessories: "Аксессуары",
    resale: "Вторичка", brands: "Все бренды", sell: "Продать вещь", wardrobes: "Гардеробы",
  };
  const parts = path.split("/");
  const last = parts.at(-1) ?? path;
  const gender = parts[1] === "women" ? "женские " : parts[1] === "men" ? "мужские " : "";
  if (parts[0] === "brands" && parts[1]) return parts[1];
  const name = known[last] ?? last;
  return gender ? `${gender}${name.toLowerCase()}` : name;
}

export default async function Page({ params }: { params: Params }) {
  const { slug } = await params;
  if (isRubric(slug)) return <RubricPage rubric={rubricBySlug(slug)!} />;
  const a = await article(slug);
  if (!a) notFound();
  return <ArticlePage a={a} />;
}
