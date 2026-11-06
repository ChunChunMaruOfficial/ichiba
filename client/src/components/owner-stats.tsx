"use client";

import clsx from "clsx";
import Link from "next/link";
import { plural } from "@/lib/labels";
import type { Card } from "@/lib/types";
import { IconHeart, IconMessage, IconPencil } from "./ui";

/** Where the owner edits an item: a draft goes back to the sell form, anything else to its edit page. */
export const editHref = (card: Pick<Card, "id" | "status">) => (card.status === "DRAFT" ? `/sell?draft=${card.id}` : `/item/${card.id}/edit`);

const IconEye = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconCalendar = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </svg>
);

const daysLabel = (d: number) => (d === 0 ? "сегодня" : `${d} ${plural(d, "день", "дня", "дней")}`);

/**
 * An item's numbers for its owner, as icons in a row: views, ♡, contacts (wrote, offered a price, asked to buy) and
 * the days on sale. Each says in full what it counts on hover and to a screen reader.
 */
export function OwnerStatsRow({ stats, className, size = "sm" }: { stats: NonNullable<Card["stats"]>; className?: string; size?: "sm" | "md" }) {
  const items: Array<[string, React.ReactNode, string, string]> = [
    ["views", <IconEye key="v" className="size-full" />, String(stats.views), `Просмотры: ${stats.views}`],
    ["favorites", <IconHeart key="f" className="size-full" />, String(stats.favorites), `В избранном: ${stats.favorites}`],
    ["contacts", <IconMessage key="c" className="size-full" />, String(stats.contacts), `Обращения — написали, предложили цену или запросили покупку: ${stats.contacts}`],
  ];
  if (stats.days != null) items.push(["days", <IconCalendar key="d" className="size-full" />, daysLabel(stats.days), stats.days === 0 ? "На ichiba с сегодняшнего дня" : `На ichiba ${daysLabel(stats.days)}`]);
  return (
    <ul className={clsx("flex flex-wrap items-center text-ink-2", size === "md" ? "gap-x-4 gap-y-1 text-sm" : "gap-x-3 gap-y-0.5 text-xs", className)}>
      {items.map(([key, icon, value, title]) => (
        <li key={key} title={title} className="flex items-center gap-1">
          <span className={clsx("shrink-0 text-muted", size === "md" ? "size-[18px]" : "size-[15px]")}>{icon}</span>
          <span className="tabular">{value}</span>
          <span className="sr-only">{title}</span>
        </li>
      ))}
    </ul>
  );
}

/** «Редактировать» and, under it, the item's numbers: what the owner's own card has instead of «Купить». */
export function OwnerActions({ card, className }: { card: Card; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <Link href={editHref(card)} className="btn-wa btn-wa-ink flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold">
        <IconPencil className="size-4" /> Редактировать
      </Link>
      {card.stats && <OwnerStatsRow stats={card.stats} className="justify-center" />}
    </div>
  );
}
