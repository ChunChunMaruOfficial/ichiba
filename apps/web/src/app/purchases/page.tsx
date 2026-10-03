"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { DealCard } from "@/components/deal-actions";
import { OfferCard } from "@/components/offer";
import { RequireAuth } from "@/components/require-auth";
import { ButtonLink, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import Link from "next/link";
import { AuctionTimer } from "@/components/auction";
import { Badge } from "@/components/ui";
import { formatPrice } from "@/lib/labels";
import type { AuctionView, Card, Deal, Offer } from "@/lib/types";

type Tab = "active" | "offers" | "bids" | "completed" | "cancelled";
const TABS: Array<[Tab, string]> = [
  ["active", "Активные"],
  ["offers", "Предложения"],
  ["bids", "Ставки"],
  ["completed", "Завершённые"],
  ["cancelled", "Отменённые"],
];

export default function PurchasesPage() {
  return <RequireAuth reason="чтобы увидеть свои покупки">{() => (
        <Suspense>
          <Purchases />
        </Suspense>
      )}</RequireAuth>;
}

function Purchases() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "active") as Tab;
  const setTab = (t: Tab) => router.replace(t === "active" ? "?" : `?tab=${t}`, { scroll: false });
  const { data, error, mutate } = useSWR<{ items: Deal[]; counts: Record<Exclude<Tab, "offers" | "bids">, number> }>(tab === "offers" || tab === "bids" ? null : `/purchases?tab=${tab}`);
  const bids = useSWR<{ items: Array<{ listing: Card; auction: AuctionView }> }>(tab === "bids" ? "/auctions/mine" : null);
  const offers = useSWR<{ items: Offer[] }>("/offers?role=buyer");
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Мои покупки</h1>
      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto" role="tablist">
        {TABS.map(([key, label]) => (
          <Chip key={key} role="tab" aria-selected={tab === key} active={tab === key} onClick={() => setTab(key)}>
            {label}
            {key === "offers"
              ? offers.data && <span className={tab === key ? "text-white/70" : "text-muted"}>{offers.data.items.length}</span>
              : key === "bids"
                ? null
                : data && <span className={tab === key ? "text-white/70" : "text-muted"}>{data.counts[key]}</span>}
          </Chip>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {tab === "bids" ? (
          !bids.data ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
          ) : bids.data.items.length === 0 ? (
            <EmptyState title="Здесь появятся аукционы, в которых вы участвуете">
              <ButtonLink href="/?chip=auctions">Смотреть аукционы</ButtonLink>
            </EmptyState>
          ) : (
            bids.data.items.map(({ listing, auction }) => <BidRow key={auction.id} listing={listing} auction={auction} />)
          )
        ) : tab === "offers" ? (
          !offers.data ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
          ) : offers.data.items.length === 0 ? (
            <EmptyState title="Здесь появятся ваши предложения цены" hint="Нажмите «Предложить цену» на странице вещи" />
          ) : (
            offers.data.items.map((o) => <OfferCard key={o.id} offer={o} onChange={() => offers.mutate()} />)
          )
        ) : error ? (
          <ErrorState message="Не удалось загрузить сделки" onRetry={() => mutate()} />
        ) : !data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : data.items.length === 0 ? (
          <EmptyState title={tab === "active" ? "Здесь появятся ваши покупки" : "Пока пусто"}>
            <ButtonLink href="/">Смотреть вещи</ButtonLink>
          </EmptyState>
        ) : (
          data.items.map((d) => <DealCard key={d.id} deal={d} onChange={() => mutate()} />)
        )}
      </div>
    </div>
  );
}

/** One auction I bid on: my position and what to do next. */
function BidRow({ listing, auction: a }: { listing: Card; auction: AuctionView }) {
  const state =
    a.status === "ACTIVE"
      ? a.leaderIsMe
        ? { tone: "ok" as const, text: "Вы лидируете" }
        : { tone: "warn" as const, text: "Вашу ставку перебили" }
      : a.winnerIsMe
        ? { tone: "ok" as const, text: "Вы выиграли" }
        : { tone: "muted" as const, text: a.status === "NO_SALE" ? "Без продажи" : "Аукцион завершён" };
  return (
    <article className={`flex gap-4 rounded-2xl bg-surface p-4 ${a.status === "ACTIVE" && !a.leaderIsMe ? "border-l-4 border-l-[#d9a100]" : ""}`}>
      <Link href={`/item/${listing.id}`} className="w-20 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {listing.cover && <img src={listing.cover.urls.s} alt="" width={80} height={100} className="size-full object-cover" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.text}</Badge>
          {a.status === "ACTIVE" && <AuctionTimer endsAt={a.endsAt} />}
        </div>
        <Link href={`/item/${listing.id}`} className="truncate font-medium hover:underline">
          {listing.title}
        </Link>
        <p className="text-sm text-ink-2">
          Текущая ставка <b className="tabular text-ink">{formatPrice(a.currentBid)}</b> · ваша {formatPrice(a.myMaxBid)}
        </p>
        {a.winnerIsMe && a.requestId && (
          <Link href={`/buy/${listing.id}?request=${a.requestId}`} className="text-sm font-semibold underline underline-offset-4">
            Выбрать способ получения
          </Link>
        )}
        {a.status === "ACTIVE" && !a.leaderIsMe && (
          <Link href={`/item/${listing.id}`} className="text-sm font-semibold underline underline-offset-4">
            Перебить — от {formatPrice(a.minBid)}
          </Link>
        )}
      </div>
    </article>
  );
}
