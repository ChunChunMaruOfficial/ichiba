import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "@/components/journal/article-card";
import { Avatar } from "@/components/journal/author-card";
import { EmptyState } from "@/components/ui";
import { articlesBy } from "@/lib/journal";
import { authorById, AUTHORS } from "@/lib/journal-authors";
import { jsonLd, SITE_URL } from "@/lib/server";

/** An author's page: who they are, what confirms it, and everything they wrote. The Person behind each Article. */
export const revalidate = 600;
export const dynamicParams = false;

type Params = Promise<{ id: string }>;

export function generateStaticParams() {
  return AUTHORS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const author = authorById((await params).id);
  if (!author) return {};
  const n = (await articlesBy(author.id)).length;
  return {
    title: `${author.name} — автор журнала ichiba`,
    description: author.bio,
    alternates: { canonical: `${SITE_URL}/journal/authors/${author.id}` },
    robots: n ? undefined : { index: false, follow: true },
  };
}

export default async function AuthorPage({ params }: { params: Params }) {
  const author = authorById((await params).id);
  if (!author) notFound();
  const list = await articlesBy(author.id);
  const url = `${SITE_URL}/journal/authors/${author.id}`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": author.kind === "person" ? "Person" : "Organization",
      name: author.name,
      description: author.bio,
      url,
      ...(author.kind === "person" ? { jobTitle: author.role } : {}),
      sameAs: author.links?.filter((l) => l.href.startsWith("http")).map((l) => l.href),
    },
  };
  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-muted">
        <Link href="/" className="hover:text-ink">Главная</Link> / <Link href="/journal" className="hover:text-ink">Журнал</Link> / <span className="text-ink-2">{author.name}</span>
      </nav>
      <header className="flex max-w-3xl items-start gap-5">
        <Avatar author={author} size={72} />
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{author.name}</h1>
          <p className="mt-1 text-muted">{author.role}</p>
          <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{author.bio}</p>
          {author.links?.length ? (
            <p className="mt-3 flex flex-wrap gap-x-4 text-sm">
              {author.links.map((l) => (
                <a key={l.href} href={l.href} className="text-indigo hover:underline" rel={l.href.startsWith("http") ? "me noopener" : undefined}>
                  {l.label}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      </header>
      {list.length ? (
        <section className="mt-10" aria-label="Статьи автора">
          <h2 className="text-2xl font-bold leading-tight md:text-[28px]">Статьи</h2>
          <div className="mt-5 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((a) => (
              <ArticleCard key={a.slug} a={a} />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState kanji="読物" title="Статей пока нет" />
      )}
    </div>
  );
}
