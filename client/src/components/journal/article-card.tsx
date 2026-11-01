import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { articleHref, formatDate, rubricHref, type ArticleMeta } from "@/lib/journal";

/** The cover, or the section's brush kanji on kraft when there is none yet. */
export function Cover({ a, sizes, priority, className }: { a: ArticleMeta; sizes: string; priority?: boolean; className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden bg-kraft/60", className)}>
      {a.cover ? (
        <Image src={a.cover} alt={a.coverAlt ?? a.title} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center font-brush text-5xl text-shu/70" aria-hidden>
          {a.rubric.kanji}
        </span>
      )}
    </div>
  );
}

/** Section · date · reading time: the line under every title. */
export function Meta({ a, className }: { a: ArticleMeta; className?: string }) {
  return (
    <p className={clsx("flex flex-wrap items-center gap-x-2 text-sm text-muted", className)}>
      <Link href={rubricHref(a.rubric.slug)} className="font-medium text-indigo hover:underline">
        {a.rubric.name}
      </Link>
      <span aria-hidden>·</span>
      <time dateTime={a.publishedAt}>{formatDate(a.publishedAt)}</time>
      <span aria-hidden>·</span>
      <span>{a.minutes} мин</span>
    </p>
  );
}

/** A card in the index and the «Читать дальше» row: cover 3:2, the section, the title, one line of the lead. */
export function ArticleCard({ a, eager }: { a: ArticleMeta; eager?: boolean }) {
  return (
    <article className="group flex flex-col">
      <Link href={articleHref(a.slug)} className="block overflow-hidden rounded-2xl" aria-label={a.title}>
        <Cover a={a} sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw" priority={eager} className="aspect-[3/2] transition-transform duration-500 group-hover:scale-[1.02]" />
      </Link>
      <Meta a={a} className="mt-3" />
      <h3 className="mt-1.5 text-xl font-semibold leading-snug tracking-tight [text-wrap:balance]">
        <Link href={articleHref(a.slug)} className="hover:underline hover:underline-offset-4">
          {a.title}
        </Link>
      </h3>
      <p className="mt-1.5 line-clamp-2 text-[15px] leading-relaxed text-ink-2">{a.description}</p>
    </article>
  );
}

/** The newest article, on the whole width: the cover beside the title, the lead and the author. */
export function ArticleHero({ a }: { a: ArticleMeta }) {
  return (
    <article className="group grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-center md:gap-10">
      <Link href={articleHref(a.slug)} className="block overflow-hidden rounded-3xl" aria-label={a.title}>
        <Cover a={a} sizes="(min-width: 768px) 55vw, 100vw" priority className="aspect-[3/2] transition-transform duration-500 group-hover:scale-[1.02]" />
      </Link>
      <div>
        <Meta a={a} />
        <h2 className="mt-2 text-3xl font-semibold leading-[1.1] tracking-tight [text-wrap:balance] md:text-[2.5rem]">
          <Link href={articleHref(a.slug)} className="hover:underline hover:underline-offset-4">
            {a.title}
          </Link>
        </h2>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{a.description}</p>
        <p className="mt-4 text-sm text-muted">
          {a.author.name} · {a.author.role}
        </p>
      </div>
    </article>
  );
}
