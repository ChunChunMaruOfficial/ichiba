"use client";

import clsx from "clsx";
import Link from "next/link";
import { itemHref } from "@/lib/item-path";
import { landingHref, type ItemLandings } from "@/lib/landing";
import { searchHref, type Zone } from "@/lib/market";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The way to a page, from the home: «Главная / Обувь / Ботинки / Кожаные ботинки … / Похожее». The last crumb is the
 * page itself. Where a page used to say «← К вещи», this is what stands there now.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Хлебные крошки" className={clsx("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted", className)}>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-x-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {c.href && !last ? (
              <Link href={c.href} className="max-w-[20rem] truncate hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span aria-current={last ? "page" : undefined} className={clsx("max-w-[20rem] truncate", last && "text-ink-2")}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** The crumbs of an item: the home, its category and subcategory pages (the indexed ones when they exist), the item. */
export function itemCrumbs(
  l: { id: string; slug?: string | null; title: string; category: string | null; categoryLabel: string | null; subcategoryLabel: string | null },
  landings: ItemLandings | undefined,
  zone: Zone,
): Crumb[] {
  const out: Crumb[] = [{ label: "Главная", href: "/" }];
  if (l.categoryLabel) out.push({ label: landings?.category?.name ?? l.categoryLabel, href: landings?.category ? landingHref(landings.category.path) : searchHref(`category=${l.category}`, zone) });
  if (l.subcategoryLabel) out.push({ label: landings?.subcategory?.name ?? l.subcategoryLabel, href: landings?.subcategory ? landingHref(landings.subcategory.path) : undefined });
  out.push({ label: l.title || "Без названия", href: itemHref(l) });
  return out;
}
