"use client";

import { Furoshiki } from "@/components/shop/furoshiki";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { DealCard } from "@/components/deal-actions";
import { OfferCard } from "@/components/offer";
import { RequireAuth } from "@/components/require-auth";
import { ButtonLink, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { AuctionTimer } from "@/components/auction";
import { Badge } from "@/components/ui";
import { formatPrice } from "@/lib/labels";
import type { AuctionView, Card, Deal, Offer } from "@/lib/types";

type Filter = "active" | "offers" | "bids" | "completed" | "cancelled";
const FILTERS: Array<[Filter, string]> = [
  ["active", "Активные"],
  ["offers", "Предложения"],
  ["bids", "Ставки"],
  ["completed", "Завершённые"],
  ["cancelled", "Отменённые"],
];
type DealFilter = Exclude<Filter, "offers" | "bids">;

export default function PurchasesPage() {
  return <RequireAuth reason="чтобы увидеть свои покупки">{() => (
        <Suspense>
          <Purchases />
        </Suspense>
      )}</RequireAuth>;
}

/**
 * Everything I buy in one list. The chips are filters, not tabs: none is on at first (all deals, offers and bids),
 * a tap narrows the list, a second tap on the same chip shows everything again.
 */
function Purchases() {
  const router = useRouter();
  const params = useSearchParams();
  const filter = (FILTERS.find(([k]) => k === params.get("tab"))?.[0] ?? null) as Filter | null;
  const toggle = (f: Filter) => router.replace(filter === f ? "?" : `?tab=${f}`, { scroll: false });
  const dealFilter = filter === "offers" || filter === "bids" ? null : (filter as DealFilter | null);
  const { data, error, mutate } = useSWR<{ items: Deal[]; counts: Record<DealFilter, number> }>(filter === "offers" || filter === "bids" ? null : `/purchases?tab=${dealFilter ?? "all"}`);
  // Counts for every chip, even while another one is on.
  const counts = useSWR<{ counts: Record<DealFilter, number> }>("/purchases?tab=active");
  const bids = useSWR<{ items: Array<{ listing: Card; auction: AuctionView }> }>("/auctions/mine");
  const offers = useSWR<{ items: Offer[] }>("/offers?role=buyer");
  const count = (k: Filter) => (k === "offers" ? offers.data?.items.length : k === "bids" ? bids.data?.items.length : (data ?? counts.data)?.counts[k]);

  const showDeals = filter !== "offers" && filter !== "bids";
  const showOffers = filter === null || filter === "offers";
  const showBids = filter === null || filter === "bids";
  const loading = (showDeals && !data && !error) || (showOffers && !offers.data) || (showBids && !bids.data);
  const empty = !loading && (!showDeals || !data?.items.length) && (!showOffers || !offers.data?.items.length) && (!showBids || !bids.data?.items.length);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Мои покупки</h1>
      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto" role="group" aria-label="Показать только">
        {FILTERS.map(([key, label]) => {
          const n = count(key);
          return (
            <Chip key={key} active={filter === key} onClick={() => toggle(key)}>
              {label}
              {n != null && <span className={filter === key ? "text-accent-ink/70" : "text-muted"}>{n}</span>}
            </Chip>
          );
        })}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0 lg:[&>*:only-child]:col-span-2">
        {showDeals && error ? (
          <ErrorState message="Не удалось загрузить сделки" onRetry={() => mutate()} />
        ) : loading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : empty ? (
          filter === "bids" ? (
            <EmptyState title="Здесь появятся аукционы, в которых вы участвуете">
              <ButtonLink href="/?chip=auctions">Смотреть аукционы</ButtonLink>
            </EmptyState>
          ) : filter === "offers" ? (
            <EmptyState title="Здесь появятся ваши предложения цены" hint="Нажмите «Предложить цену» на странице вещи" />
          ) : (
            <EmptyState art={<Furoshiki className="mb-2 h-36" />} title={filter ? "Пока пусто" : "Здесь появятся ваши покупки"}>
              <ButtonLink href="/">Смотреть вещи</ButtonLink>
            </EmptyState>
          )
        ) : (
          <>
            {showDeals && data?.items.map((d) => <DealCard key={d.id} deal={d} onChange={() => mutate()} />)}
            {showOffers && offers.data?.items.map((o) => <OfferCard key={o.id} offer={o} onChange={() => offers.mutate()} />)}
            {showBids && bids.data?.items.map(({ listing, auction }) => <BidRow key={auction.id} listing={listing} auction={auction} />)}
          </>
        )}
      </div>
    </div>
  );
}

/** One auction I bid on: my position and what to do next. */
function BidRow({ listing, auction: a }: { listing: Card; auction: AuctionView }) {
  const router = useRouter();
  const state =
    a.status === "ACTIVE"
      ? a.leaderIsMe
        ? { tone: "ok" as const, text: "Вы лидируете" }
        : { tone: "warn" as const, text: "Вашу ставку перебили" }
      : a.winnerIsMe
        ? { tone: "ok" as const, text: "Вы выиграли" }
        : { tone: "muted" as const, text: a.status === "NO_SALE" ? "Без продажи" : "Аукцион завершён" };
  // The whole card is the link: won → choose how to receive it, otherwise the item with its auction.
  const href = a.winnerIsMe && a.requestId ? `/buy/${listing.id}?request=${a.requestId}` : `/item/${listing.id}`;
  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`${listing.title} — ${state.text}`}
      onClick={() => router.push(href)}
      onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), router.push(href))}
      className={`rise flex cursor-pointer gap-4 rounded-3xl bg-surface p-4 shadow-[var(--shadow-paper)] outline-none transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-indigo/40 md:p-5 ${a.status === "ACTIVE" && !a.leaderIsMe ? "border-l-4 border-l-amber" : ""}`}
    >
      <div className="w-20 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {listing.cover && <img src={listing.cover.urls.s} alt="" width={80} height={100} className="size-full object-cover" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.text}</Badge>
          {a.status === "ACTIVE" && <AuctionTimer endsAt={a.endsAt} />}
        </div>
        <p className="truncate font-medium">{listing.title}</p>
        <p className="text-sm text-ink-2">
          Текущая ставка <b className="tabular text-ink">{formatPrice(a.currentBid)}</b> · ваша {formatPrice(a.myMaxBid)}
        </p>
        {a.winnerIsMe && a.requestId && <span className="text-sm font-semibold underline underline-offset-4">Выбрать способ получения</span>}
        {a.status === "ACTIVE" && !a.leaderIsMe && <span className="text-sm font-semibold underline underline-offset-4">Перебить — от {formatPrice(a.minBid)}</span>}
      </div>
    </article>
  );
}
