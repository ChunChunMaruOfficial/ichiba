import clsx from "clsx";
import Link from "next/link";
import type { Faq as FaqItem } from "@/lib/journal";
import { ButtonLink } from "../ui";

/**
 * The building blocks of an article, all plain HTML with no scripts: the text and every number in it must be in the
 * page as served, because search engines' and AI assistants' crawlers read the HTML, not the hydrated app.
 */

/** «Коротко»: the answer to the article's question in 3–5 sentences, before the text (front matter `summary`). */
export function Brief({ points }: { points: string[] }) {
  if (!points.length) return null;
  return (
    <section id="korotko" aria-labelledby="korotko-title" className="rounded-3xl bg-kraft/50 p-5 md:p-6">
      <h2 id="korotko-title" className="text-base font-semibold">
        Коротко
      </h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[16px] leading-relaxed text-ink-2 marker:text-shu">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

/** Questions and answers at the end (front matter `faq`): open on click, but all of it in the HTML. */
export function Faq({ items }: { items: FaqItem[] }) {
  if (!items.length) return null;
  return (
    <section id="faq" aria-labelledby="faq-title" className="mt-12">
      <h2 id="faq-title" className="text-2xl font-semibold tracking-tight">
        Вопросы и ответы
      </h2>
      <div className="mt-4 flex flex-col gap-2">
        {items.map((f) => (
          <details key={f.q} className="group rounded-2xl bg-surface px-5 py-4 open:shadow-paper" data-faq>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              <span>{f.q}</span>
              <span className="mt-1 shrink-0 text-muted transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** A number with its source: the kind of fact AI answers quote. Several in a row go inside <Stats>. */
export function Stat({ value, label, source }: { value: string; label: string; source?: string }) {
  return (
    <figure className="my-6 rounded-2xl border border-line bg-surface p-5 first:mt-0 last:mb-0">
      <div className="text-4xl font-semibold leading-none tracking-tight">{value}</div>
      <figcaption className="mt-2 text-[15px] leading-snug text-ink-2">
        {label}
        {source && <span className="mt-1 block text-xs text-muted">Источник: {source}</span>}
      </figcaption>
    </figure>
  );
}

export function Stats({ children }: { children: React.ReactNode }) {
  return <div className="my-6 grid gap-3 sm:grid-cols-2 [&>figure]:my-0">{children}</div>;
}

/** A quotation with a named author and their role: expert words, attributed. */
export function Quote({ author, role, children }: { author: string; role?: string; children: React.ReactNode }) {
  return (
    <figure className="my-8 border-l-2 border-shu pl-5">
      <blockquote className="text-[19px] font-medium leading-snug tracking-tight text-ink [&>p]:m-0">{children}</blockquote>
      <figcaption className="mt-3 text-sm text-muted">
        <span className="font-medium text-ink-2">{author}</span>
        {role && <>, {role}</>}
      </figcaption>
    </figure>
  );
}

/** An aside: a warning, a tip, a legal note. */
export function Callout({ title, tone = "note", children }: { title?: string; tone?: "note" | "warn"; children: React.ReactNode }) {
  return (
    <aside className={clsx("my-6 rounded-2xl p-5 text-[16px] leading-relaxed [&>p]:m-0 [&>p+p]:mt-2", tone === "warn" ? "bg-warn-soft text-warn" : "bg-indigo-soft/60 text-ink-2")}>
      {title && <p className="mb-1.5 font-semibold text-ink">{title}</p>}
      {children}
    </aside>
  );
}

/** A comparison table from data: the head row and the rows; the first column is the row's name. */
export function Compare({ head, rows, caption }: { head: string[]; rows: string[][]; caption?: string }) {
  return (
    <figure className="my-6 overflow-hidden rounded-2xl bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-[15px]">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted">
              {head.map((h, i) => (
                <th key={i} scope="col" className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-4 py-3 text-left font-medium text-ink">
                      {c}
                    </th>
                  ) : (
                    <td key={j} className="px-4 py-3 text-ink-2">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <figcaption className="px-4 pb-3 text-xs text-muted">{caption}</figcaption>}
    </figure>
  );
}

/** The call to the shop inside the reading column: short, once, after the text has answered the question. */
export function CtaSell({ title = "Продайте то, что не носите", text = "Сфотографируйте вещь — ИИ заполнит описание и подскажет цену. Объявление увидят покупатели по всей Беларуси.", href = "/sell", label = "Выставить вещь" }: { title?: string; text?: string; href?: string; label?: string }) {
  return (
    <aside className="my-10 flex flex-col gap-4 rounded-3xl bg-ink p-6 text-accent-ink sm:flex-row sm:items-center sm:justify-between md:p-7">
      <div>
        <p className="text-xl font-semibold tracking-tight">{title}</p>
        <p className="mt-1 max-w-md text-[15px] leading-relaxed text-accent-ink/80">{text}</p>
      </div>
      <span data-track="article_cta_sell" className="shrink-0">
        <ButtonLink href={href} variant="secondary">
          {label}
        </ButtonLink>
      </span>
    </aside>
  );
}

/** Chips to the catalogue pages a section or an article is about. */
export function CatalogLinks({ title = "В каталоге", links }: { title?: string; links: Array<{ path: string; name: string }> }) {
  if (!links.length) return null;
  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.path}>
            <Link href={`/${l.path}`} className="chip inline-flex h-9 items-center px-4 text-sm font-medium">
              {l.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
