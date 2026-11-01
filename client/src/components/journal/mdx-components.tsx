import Image from "next/image";
import Link from "next/link";
import type { MDXComponents } from "mdx/types";
import { Callout, Compare, CtaSell, Quote, Stat, Stats } from "./blocks";
import { Items } from "./items-strip";

/**
 * What an author can write in an article besides Markdown (docs/journal/author-checklist.md):
 *   <Stat value="…" label="…" source="…"/>  <Stats>…</Stats>  <Quote author="…" role="…">…</Quote>
 *   <Callout title="…" tone="note|warn">…</Callout>  <Compare head={[…]} rows={[[…]]} caption="…"/>
 *   <Items path="c/jeans" market="resale" limit={4}/>  <CtaSell/>
 * Links inside the site go through next/link; pictures through next/image when their size is known.
 */
export const mdxComponents: MDXComponents = {
  Stat,
  Stats,
  Quote,
  Callout,
  Compare,
  Items,
  CtaSell,
  a: ({ href = "", children, ...rest }) =>
    href.startsWith("/") || href.startsWith("#") ? (
      <Link href={href} {...rest}>
        {children}
      </Link>
    ) : (
      <a href={href} rel="noopener" target={href.startsWith("http") ? "_blank" : undefined} {...rest}>
        {children}
      </a>
    ),
  img: ({ src = "", alt = "", width, height, title }) => {
    const w = Number(width);
    const h = Number(height);
    const source = typeof src === "string" ? src : "";
    if (source.startsWith("/") && w && h) {
      return (
        <figure className="my-8">
          <Image src={source} alt={alt} width={w} height={h} sizes="(min-width: 1024px) 672px, 100vw" className="h-auto w-full rounded-2xl" />
          {title && <figcaption className="mt-2 text-sm text-muted">{title}</figcaption>}
        </figure>
      );
    }
    return (
      <figure className="my-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- the author gave no size; the browser lays it out */}
        <img src={source} alt={alt} loading="lazy" className="h-auto w-full rounded-2xl" />
        {title && <figcaption className="mt-2 text-sm text-muted">{title}</figcaption>}
      </figure>
    );
  },
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-2xl bg-surface">
      <table className="w-full border-collapse text-[15px]">{children}</table>
    </div>
  ),
};
