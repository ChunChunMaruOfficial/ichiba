"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFavorite } from "@/lib/hooks";
import { CONDITION_LABEL, formatPrice } from "@/lib/labels";
import type { Card } from "@/lib/types";
import { AuctionTimer, auctionPrice } from "./auction";
import { scheduleLabel } from "./schedule-picker";
import { useSession } from "./session";
import { IconHeart, StatusBadge } from "./ui";

/** Photo that fades in when loaded and keeps its real aspect ratio (no forced crop). */
function ItemPhoto({ card, sizes = "(min-width: 1024px) 25vw, 50vw", className, eager }: { card: Pick<Card, "cover" | "title" | "status">; sizes?: string; className?: string; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ratio = card.cover ? `${card.cover.width} / ${card.cover.height}` : "4 / 5";
  return (
    <div className={clsx("relative overflow-hidden bg-skeleton", className)} style={{ aspectRatio: ratio }}>
      {card.cover && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- variants are pre-sized WebP from our own storage
        <img
          src={card.cover.urls.m}
          srcSet={`${card.cover.urls.s} 320w, ${card.cover.urls.m} 640w, ${card.cover.urls.l} 1280w`}
          sizes={sizes}
          alt={card.title}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={clsx(
            "absolute inset-0 size-full object-cover transition-[opacity,transform] duration-300",
            loaded ? "opacity-100" : "opacity-0",
            card.status === "SOLD" && "opacity-60 grayscale-[30%]",
          )}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-ink-2">Нет фото</div>
      )}
    </div>
  );
}

function BuyButton({ card, className }: { card: Card; className?: string }) {
  const router = useRouter();
  const { me, requireAuth } = useSession();
  if (me?.id === card.seller.id) return <span className={clsx("rounded-lg bg-black/5 px-3 py-2 text-center text-sm text-ink-2", className)}>Ваша вещь</span>;
  if (card.status === "SOLD") return null;
  if (card.auction) {
    return (
      <Link href={`/item/${card.id}`} className={clsx("rounded-lg bg-accent px-3 py-2 text-center text-sm font-semibold text-accent-ink hover:bg-accent-hover", className)}>
        Сделать ставку
      </Link>
    );
  }
  const reserved = card.status === "RESERVED";
  return (
    <button
      disabled={reserved}
      onClick={(e) => {
        e.preventDefault();
        requireAuth(() => router.push(`/buy/${card.id}`), { reason: `чтобы купить «${card.title}»` });
      }}
      className={clsx("rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:bg-black/10 disabled:text-ink-2", className)}
    >
      Купить
    </button>
  );
}

function HeartButton({ card, source, className }: { card: Card; source: "feed" | "search" | "wardrobe"; className?: string }) {
  const { isFavorite, toggle } = useFavorite(card, source);
  return (
    <button
      aria-label={isFavorite ? "Убрать из избранного" : "В избранное"}
      aria-pressed={isFavorite}
      onClick={(e) => {
        e.preventDefault();
        toggle();
      }}
      className={clsx("grid size-9 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105", isFavorite ? "text-heart" : "text-ink", className)}
    >
      <IconHeart className="size-5" filled={isFavorite} />
    </button>
  );
}

/**
 * Item card. `feed` (Home) keeps the photo clean — only a price tag — and reveals details on hover
 * (frame 06). `grid` (Search, Favorites, Wardrobe) always shows price, size, title, condition, seller (frame 07).
 */
/** "−70%" against the shop price, and a play mark when the listing has a video. */
function CardMarks({ card, discount }: { card: Card; discount: number }) {
  if (!discount && !card.hasVideo) return null;
  return (
    <span className="pointer-events-none absolute bottom-2.5 right-2.5 flex gap-1">
      {card.hasVideo && <span className="grid size-6 place-items-center rounded-full bg-black/55 text-[10px] text-white" title="Есть видео">▶</span>}
      {discount > 0 && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ok shadow-sm">−{discount}%</span>}
    </span>
  );
}

export function ItemCard({ card, variant = "grid", source = "search", eager }: { card: Card; variant?: "feed" | "grid"; source?: "feed" | "search" | "wardrobe"; eager?: boolean }) {
  const discounted = !card.auction && card.previousPrice && card.price && card.price < card.previousPrice;
  const shopDiscount = !card.auction && card.originalPrice && card.price && card.originalPrice > card.price ? Math.round((1 - card.price / card.originalPrice) * 100) : 0;
  const price = card.auction ? auctionPrice(card.auction) : formatPrice(card.price);

  if (variant === "feed") {
    return (
      <article className="group relative">
        <Link href={`/item/${card.id}`} className="block overflow-hidden rounded-2xl">
          <ItemPhoto card={card} eager={eager} className="rounded-2xl transition-transform duration-300 group-hover:scale-[1.02]" />
          <span className="hang-tag absolute bottom-3 left-2 text-[13px] transition-opacity md:group-hover:opacity-0">{price}</span>
          <span className="transition-opacity md:group-hover:opacity-0">
            <CardMarks card={card} discount={shopDiscount} />
          </span>
          {card.status !== "PUBLISHED" ? <StatusBadge status={card.status} className="absolute left-2.5 top-2.5" /> : card.auction && <AuctionTimer endsAt={card.auction.endsAt} className="absolute left-2.5 top-2.5" />}
        </Link>
        {/* Desktop hover / keyboard focus panel */}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 hidden translate-y-1 rounded-xl bg-white/95 p-3 opacity-0 shadow-lg backdrop-blur transition-[opacity,transform] duration-200 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 md:block">
          <p className="truncate text-sm font-medium">{card.title}</p>
          <p className="tabular mt-0.5 text-lg font-semibold">
            {price}
            {discounted && <s className="ml-2 text-sm font-normal text-muted">{card.previousPrice}</s>}
          </p>
          <p className="truncate text-xs text-ink-2">
            {[card.size, card.condition && CONDITION_LABEL[card.condition]].filter(Boolean).join(" · ")}
          </p>
          <Link href={`/u/${card.seller.username}`} className="text-xs text-muted hover:text-ink">
            @{card.seller.username}
          </Link>
          <div className="mt-2.5 flex items-center gap-2">
            <BuyButton card={card} className="flex-1" />
            <HeartButton card={card} source={source === "search" ? "feed" : source} className="bg-paper shadow-none" />
          </div>
        </div>
        <p className="tabular mt-1.5 text-xs text-ink-2 md:hidden">
          {price}
          {card.size && <span className="text-muted"> · {card.size}</span>}
        </p>
      </article>
    );
  }

  return (
    <article className="group relative">
      <div className="relative">
        <Link href={`/item/${card.id}`} className="block overflow-hidden rounded-2xl" tabIndex={-1} aria-hidden>
          <ItemPhoto card={card} eager={eager} className="rounded-2xl transition-transform duration-300 group-hover:scale-[1.03]" />
        </Link>
        {card.status !== "PUBLISHED" ? <StatusBadge status={card.status} className="absolute left-2.5 top-2.5" /> : card.auction && <AuctionTimer endsAt={card.auction.endsAt} className="absolute left-2.5 top-2.5" />}
        <HeartButton card={card} source={source} className="absolute right-2.5 top-2.5" />
        <span className="transition-opacity md:group-hover:opacity-0">
          <CardMarks card={card} discount={shopDiscount} />
        </span>
        <div className="absolute inset-x-2.5 bottom-2.5 hidden translate-y-1 opacity-0 transition-[opacity,transform] group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 md:flex">
          <BuyButton card={card} className="flex-1 shadow-md" />
        </div>
      </div>
      <Link href={`/item/${card.id}`} className="block">
        <div className="mt-2 px-0.5">
          <p className="tabular text-[15px] font-semibold">
            {price}
            {discounted && <s className="ml-1.5 text-sm font-normal text-muted">{card.previousPrice}</s>}
            {card.size && <span className="ml-2 text-sm font-normal text-ink-2">{card.size}</span>}
          </p>
          <p className="truncate text-sm">{card.title}</p>
          {card.scheduledAt ? (
            <p className="truncate text-xs font-medium text-accent">Опубликуется {scheduleLabel(card.scheduledAt)}</p>
          ) : (
            card.condition && <p className="truncate text-xs text-muted">{CONDITION_LABEL[card.condition]}</p>
          )}
        </div>
      </Link>
      <Link href={`/u/${card.seller.username}`} className="px-0.5 text-xs text-muted hover:text-ink">
        @{card.seller.username}
      </Link>
    </article>
  );
}
