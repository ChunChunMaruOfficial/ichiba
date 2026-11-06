"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { conditionLabel, formatPrice, PRICE_ON_REQUEST, shownSize } from "@/lib/labels";
import { itemHref } from "@/lib/item-path";
import type { Card } from "@/lib/types";
import { auctionPrice } from "./auction";
import { editHref, OwnerStatsRow } from "./owner-stats";
import { scheduleLabel } from "./schedule-picker";
import { IconPencil, StatusBadge } from "./ui";

/**
 * A wardrobe as a detailed list, the way a classifieds site shows a seller their items: the photo with its count,
 * the title, the price, size and condition, the status, and — for the owner — the numbers of each item and
 * «Редактировать» with the item's menu. Visitors get the same rows without the numbers.
 */

export type WardrobeView = "grid" | "list";
const KEY = "ichiba:wardrobe-view";
const EVENT = "ichiba:wardrobe-view";

const readView = (): WardrobeView => {
  try {
    return localStorage.getItem(KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

/** Grid or list, remembered on this device. */
export function useWardrobeView(): [WardrobeView, (v: WardrobeView) => void] {
  const view = useSyncExternalStore(subscribe, readView, () => "grid" as WardrobeView);
  const set = (v: WardrobeView) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Storage blocked: the choice lasts until the page is left.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [view, set];
}

/** Two icons side by side: the grid of photos or the detailed list. */
export function ViewSwitch({ view, onChange }: { view: WardrobeView; onChange: (v: WardrobeView) => void }) {
  const options: Array<[WardrobeView, string, React.ReactNode]> = [
    ["grid", "Плиткой", <path key="g" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />],
    ["list", "Списком", <path key="l" d="M4 5h4v4H4zM11 6h9M11 8.5h6M4 15h4v4H4zM11 16h9M11 18.5h6" />],
  ];
  return (
    <div role="radiogroup" aria-label="Вид" className="flex shrink-0 rounded-full bg-surface p-0.5 shadow-[inset_0_0_0_1px_var(--line-strong)]">
      {options.map(([v, label, path]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          aria-label={label}
          title={label}
          onClick={() => onChange(v)}
          className={clsx("grid size-9 place-items-center rounded-full transition-colors", view === v ? "bg-ink text-accent-ink" : "text-ink-2 hover:text-ink")}
        >
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {path}
          </svg>
        </button>
      ))}
    </div>
  );
}

function Row({ card, owner, menu }: { card: Card; owner: boolean; menu?: (c: Card) => React.ReactNode }) {
  const higher = !card.auction && card.price ? Math.max(card.originalPrice ?? 0, card.previousPrice ?? 0) : 0;
  const reference = card.price && higher > card.price ? higher : null;
  const negotiable = !card.auction && !!card.priceNegotiable;
  const price = card.auction ? auctionPrice(card.auction) : negotiable ? PRICE_ON_REQUEST : card.price == null ? "Без цены" : formatPrice(card.price);
  const href = card.status === "DRAFT" ? editHref(card) : itemHref(card);
  const details = [shownSize(card.size), card.condition && conditionLabel(card.condition, card.hasTags), card.brand].filter(Boolean).join(" · ");
  const status = card.status === "PUBLISHED" ? null : card.status;
  return (
    <li className="flex gap-4 py-4 md:gap-6">
      <Link href={href} className="relative block size-24 shrink-0 overflow-hidden rounded-2xl bg-skeleton md:size-32">
        {card.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP from our own storage
          <img src={card.cover.urls.s} alt={card.title} loading="lazy" className={clsx("size-full object-cover", card.status === "SOLD" && "opacity-60 grayscale-[30%]")} />
        ) : (
          <span className="grid size-full place-items-center text-xs text-ink-2">Нет фото</span>
        )}
        {owner && card.stats && card.stats.photos > 1 && <span className="absolute bottom-1.5 left-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-black/55 px-1.5 text-[11px] font-semibold text-white">{card.stats.photos}</span>}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:gap-6">
        <div className="min-w-0 flex-1">
          <Link href={href} className="line-clamp-2 text-[15px] font-semibold leading-snug hover:text-indigo md:text-base">
            {card.title || "Без названия"}
          </Link>
          <p className="tabular mt-1 text-lg font-bold">
            {negotiable ? <span className="text-sm font-medium text-ink-2">{price}</span> : <span className={reference ? "text-shu" : undefined}>{price}</span>}
            {reference && <s className="ml-2 text-sm font-normal text-muted">{formatPrice(reference)}</s>}
          </p>
          {details && <p className="mt-0.5 truncate text-sm text-ink-2">{details}</p>}
          {(status || card.scheduledAt) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {status && <StatusBadge status={status} />}
              {card.scheduledAt && <span className="text-xs font-medium text-indigo">Опубликуется {scheduleLabel(card.scheduledAt)}</span>}
            </div>
          )}
        </div>
        {owner && (
          <div className="flex flex-col gap-3 md:w-72 md:shrink-0">
            {card.stats && <OwnerStatsRow stats={card.stats} size="md" />}
            <div className="flex items-center gap-2">
              <Link href={editHref(card)} className="btn-wa btn-wa-ink flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold md:flex-none md:px-4">
                <IconPencil className="size-4" /> Редактировать
              </Link>
              {menu?.(card)}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function WardrobeList({ items, owner, menu }: { items: Card[]; owner: boolean; menu?: (c: Card) => React.ReactNode }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((c) => (
        <Row key={c.id} card={c} owner={owner} menu={menu} />
      ))}
    </ul>
  );
}
