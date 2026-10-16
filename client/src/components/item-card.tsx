"use client";

import { BlurBackdrop } from "./blur-backdrop";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFavorite } from "@/lib/hooks";
import { conditionLabel, formatPrice } from "@/lib/labels";
import type { Card } from "@/lib/types";
import { AuctionTimer, auctionPrice } from "./auction";
import { scheduleLabel } from "./schedule-picker";
import { useSession } from "./session";
import { Nefuda } from "./shop/nefuda";
import { Hanko, IconHeart, Seal, StatusBadge } from "./ui";

/** Photo that fades in when loaded and keeps its real aspect ratio (no forced crop). */
function ItemPhoto({ card, sizes = "(min-width: 1024px) 25vw, 50vw", className, eager, uniform }: { card: Pick<Card, "cover" | "title" | "status">; sizes?: string; className?: string; eager?: boolean; uniform?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // A server-rendered photo can finish loading before React attaches onLoad: it would then stay invisible.
  useEffect(() => {
    const el = img.current;
    if (!el?.complete) return;
    const t = setTimeout(() => (el.naturalWidth ? setLoaded(true) : setFailed(true)), 0);
    return () => clearTimeout(t);
  }, []);
  // Masonry keeps each photo's own shape; rows (`uniform`: the row's height-to-width) use one frame, as tall as
  // the row's tallest photo, and fit the whole photo inside it.
  const ratio = uniform ? `1 / ${uniform}` : card.cover ? `${card.cover.width} / ${card.cover.height}` : "4 / 5";
  return (
    <div className={clsx("relative overflow-hidden bg-skeleton", className)} style={{ aspectRatio: ratio }}>
      {/* A fixed frame (rows) leaves bands around the photo: they get its own blurred colours. Masonry keeps the
          photo's shape, so there is nothing to fill. */}
      {uniform && card.cover && !failed && <BlurBackdrop src={card.cover.urls.s} />}
      {card.cover && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- variants are pre-sized WebP from our own storage
        <img
          ref={img}
          src={card.cover.urls.m}
          srcSet={`${card.cover.urls.s} 320w, ${card.cover.urls.m} 640w, ${card.cover.urls.l} 1280w`}
          sizes={sizes}
          alt={card.title}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={clsx(
            "absolute inset-0 size-full object-contain transition-[opacity,transform] duration-300",
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
  if (me?.id === card.seller.id) return <span className={clsx("rounded-xl bg-ink/5 px-3 py-2 text-center text-sm text-ink-2", className)}>Ваша вещь</span>;
  if (card.status === "SOLD") return null;
  if (card.auction) {
    return (
      <Link href={`/item/${card.id}`} className={clsx("btn-wa btn-wa-ink rounded-xl px-3 py-2 text-center text-sm font-semibold", className)}>
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
        // A negotiable price or a size to pick is settled on the item page (offer, chat, size picker), not in the buy form.
        if (card.priceNegotiable || card.multiSize) router.push(`/item/${card.id}`);
        else requireAuth(() => router.push(`/buy/${card.id}`));
      }}
      className={clsx("btn-wa btn-wa-ink rounded-xl px-3 py-2 text-sm font-semibold disabled:bg-ink/10 disabled:text-ink-2", className)}
    >
      Купить
    </button>
  );
}

/** Round «Нравится» on the photo; the heart lands like a stamp and fills with cinnabar. */
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
      className={clsx("on-photo grid size-10 place-items-center rounded-full transition-transform duration-200 hover:scale-105", isFavorite ? "text-heart" : "text-ink", className)}
    >
      <IconHeart key={String(isFavorite)} className={clsx("size-5", isFavorite && "stamp")} filled={isFavorite} />
    </button>
  );
}

/** Seal on the photo for sold/reserved items; other non-live statuses keep the word badge. */
function StatusMark({ card, className }: { card: Card; className?: string }) {
  if (card.status === "SOLD") return <Hanko kind="sold" className={className} />;
  if (card.status === "RESERVED") return <Hanko kind="reserved" className={className} />;
  if (card.status !== "PUBLISHED") return <StatusBadge status={card.status} className={className} />;
  if (card.auction) return <AuctionTimer endsAt={card.auction.endsAt} className={className} />;
  return null;
}

const seals = (card: Card) => (card.status === "PUBLISHED" && !card.auction ? (card.labels ?? []) : []);
const hasSeal = (card: Card) => seals(card).length > 0;
/** Each seal in a row leans its own way, like stamps pressed one after another. */
const TILTS = [7, -4, 5, -6];

/**
 * The seals the brand chose, in a row. In rows (`grid`) they are pressed over the photo's bottom-right corner and
 * hang past it; in the home feed they stay inside its top-right corner (clear of the price tag), stuck on askew with
 * faint tape. They step aside while the desktop hover panel / «Купить» covers the photo.
 */
function CardSeal({ card, stuck }: { card: Card; stuck?: boolean }) {
  const list = seals(card);
  return list.length ? (
    <span className={clsx("pointer-events-none absolute z-10 flex flex-row-reverse items-start gap-1 transition-opacity md:group-focus-within:opacity-0 md:group-hover:opacity-0", stuck ? "right-3 top-3.5" : "-bottom-3 -right-2 items-end")}>
      {list.map((kind, i) => (
        <Seal key={kind} kind={kind} stuck={stuck} tilt={stuck ? TILTS[i % TILTS.length] : -TILTS[i % TILTS.length]} />
      ))}
    </span>
  ) : null;
}

/** Price on a paper tag tied on with a cinnabar thread (値札); a price cut shows the new price in cinnabar and the old one struck. */
function PriceTag({ price, previous, className }: { price: string; previous?: number | null; className?: string }) {
  return (
    <span className={clsx("pl-1.5 drop-shadow-[0_2px_5px_rgb(0_0_0/0.28)]", className)}>
      <Nefuda className="tabular text-[15px] font-bold leading-6">
        <span className={previous ? "text-shu" : undefined}>{price}</span>
        {previous && <s className="ml-1.5 text-xs font-medium opacity-70">{previous}</s>}
      </Nefuda>
    </span>
  );
}

/**
 * Item card. `feed` (Home) keeps the photo clean — only a price tag — and reveals details on hover
 * (frame 06). `grid` (Search, Favorites, Wardrobe) always shows price, size, title, condition, seller (frame 07).
 */
/** "−70%" against the shop price, and a play mark when the listing has a video. */
function CardMarks({ card, discount, sealsBelow }: { card: Card; discount: number; sealsBelow?: boolean }) {
  if (!discount && !card.hasVideo) return null;
  return (
    // Where the seals take the bottom-right corner (rows), the marks move to the left one.
    <span className={clsx("pointer-events-none absolute bottom-2.5 flex gap-1", sealsBelow && hasSeal(card) ? "left-2.5" : "right-2.5")}>
      {card.hasVideo && (
        <span className="on-photo grid size-7 place-items-center rounded-full text-ink" title="Есть видео">
          <svg viewBox="0 0 24 24" className="ml-0.5 size-3.5" fill="currentColor" aria-label="Есть видео">
            <path d="M7 4.5v15l12-7.5Z" />
          </svg>
        </span>
      )}
      {discount > 0 && <span className="on-photo rounded-full px-2 py-1 text-[11px] font-bold leading-none text-shu">−{discount}%</span>}
    </span>
  );
}

export function ItemCard({ card, variant = "grid", source = "search", eager, uniform }: { card: Card; variant?: "feed" | "grid"; source?: "feed" | "search" | "wardrobe"; eager?: boolean; uniform?: number }) {
  const discounted = !card.auction && card.previousPrice && card.price && card.price < card.previousPrice;
  const shopDiscount = !card.auction && card.originalPrice && card.price && card.originalPrice > card.price ? Math.round((1 - card.price / card.originalPrice) * 100) : 0;
  const price = card.auction ? auctionPrice(card.auction) : card.priceNegotiable ? "Договорная" : card.price == null ? "Без цены" : formatPrice(card.price);
  const { me } = useSession();
  // One's own items (drafts included) can't be liked, and only live items have «Похожие».
  const mine = me?.id === card.seller.id;
  const live = card.status === "PUBLISHED" || card.status === "RESERVED" || card.status === "SOLD";

  if (variant === "feed") {
    return (
      <article className="reveal group relative">
        {/* relative: the tag and marks sit on the photo, not on the photo + caption below it (phones). */}
        <Link href={`/item/${card.id}`} className="relative block overflow-hidden rounded-[18px]">
          <ItemPhoto card={card} eager={eager} uniform={uniform} className="rounded-[18px] transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.03]" />
          <PriceTag price={price} previous={discounted ? card.previousPrice : null} className="absolute bottom-2.5 left-0 transition-opacity md:group-hover:opacity-0" />
          <span className="transition-opacity md:group-hover:opacity-0">
            <CardMarks card={card} discount={shopDiscount} />
          </span>
          <StatusMark card={card} className="absolute left-3 top-3" />
          <CardSeal card={card} stuck />
        </Link>
        {/* Desktop hover / keyboard focus panel */}
        <div className="panel pointer-events-none absolute inset-x-2 bottom-2 hidden translate-y-1 rounded-[20px] p-3 opacity-0 transition-[opacity,transform] duration-200 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 md:block">
          <p className="truncate text-sm font-medium">{card.title}</p>
          <p className="tabular mt-0.5 text-lg font-bold">
            <span className={discounted ? "text-shu" : undefined}>{price}</span>
            {discounted && <s className="ml-2 text-sm font-normal text-muted">{card.previousPrice}</s>}
          </p>
          <p className="truncate text-xs text-ink-2">
            {[card.size, card.condition && conditionLabel(card.condition, card.hasTags)].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <BuyButton card={card} className="flex-1" />
            {!mine && <HeartButton card={card} source={source === "search" ? "feed" : source} className="!bg-surface !shadow-[inset_0_0_0_1px_var(--line-strong)]" />}
          </div>
          {live && (
            <Link href={`/item/${card.id}/similar`} className="mt-2 block text-center text-xs font-medium text-ink-2 hover:text-ink">
              Похожие
            </Link>
          )}
        </div>
        <p className="card-info -mx-1 mt-1 truncate rounded-lg px-1.5 py-0.5 text-[13px] text-ink-2 md:hidden">
          {card.title}
          {card.size && <span className="text-muted"> · {card.size}</span>}
        </p>
      </article>
    );
  }

  return (
    <article className="reveal group relative">
      <div className="relative">
        <Link href={`/item/${card.id}`} className="block overflow-hidden rounded-[18px]" tabIndex={-1} aria-hidden>
          <ItemPhoto card={card} eager={eager} uniform={uniform} className="rounded-[18px] transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.03]" />
        </Link>
        <StatusMark card={card} className="absolute left-3 top-3" />
        <CardSeal card={card} />
        {!mine && <HeartButton card={card} source={source} className="absolute right-2.5 top-2.5" />}
        <span className="transition-opacity md:group-hover:opacity-0">
          <CardMarks card={card} discount={shopDiscount} sealsBelow />
        </span>
        {!mine && (
          <div className="absolute inset-x-2.5 bottom-2.5 hidden translate-y-1 opacity-0 transition-[opacity,transform] group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 md:flex">
            <BuyButton card={card} className="flex-1 shadow-md" />
          </div>
        )}
      </div>
      {/* Frosted so the text stays readable over the footer's sakura (and anything else behind the page). */}
      <div className="card-info -mx-1 mt-1.5 rounded-xl px-1.5 pb-1 pt-0.5">
        <Link href={`/item/${card.id}`} className="block">
          <div className={clsx("px-0.5", hasSeal(card) && "pr-10")}>
            <p className="tabular text-[15px] font-bold">
              <span className={discounted ? "text-shu" : undefined}>{price}</span>
              {discounted && <s className="ml-1.5 text-sm font-normal text-muted">{card.previousPrice}</s>}
              {card.size && <span className="ml-2 text-sm font-normal text-ink-2">{card.size}</span>}
            </p>
            <p className="truncate text-sm">{card.title}</p>
            {card.scheduledAt ? (
              <p className="truncate text-xs font-medium text-indigo">Опубликуется {scheduleLabel(card.scheduledAt)}</p>
            ) : (
              card.condition && <p className="truncate text-xs text-muted">{conditionLabel(card.condition, card.hasTags)}</p>
            )}
          </div>
        </Link>
        {!mine && (
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Link href={`/u/${card.seller.username}`} className="truncate text-xs text-muted hover:text-ink">
              @{card.seller.username}
            </Link>
            {/* "Похожие" as on Wildberries: the closest matches to this card. */}
            {live && (
              <Link href={`/item/${card.id}/similar`} className="shrink-0 text-xs font-medium text-ink-2 hover:text-ink">
                Похожие
              </Link>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
