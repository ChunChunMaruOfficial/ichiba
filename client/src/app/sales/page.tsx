"use client";

import { TitleWithKanji } from "@/components/sections";
import { Furoshiki } from "@/components/shop/furoshiki";
import { Daruma } from "@/components/shop/daruma";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { DealCard } from "@/components/deal-actions";
import { OfferCard } from "@/components/offer";
import { RequireAuth } from "@/components/require-auth";
import { ButtonLink, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { formatPrice, plural } from "@/lib/labels";
import type { Deal, Offer } from "@/lib/types";

type Tab = "action" | "deals" | "sold";
const TABS: Array<[Tab, string]> = [
  ["action", "Требует действия"],
  ["deals", "Сделки"],
  ["sold", "Продано"],
];

interface SalesData {
  items: Deal[];
  soldTotal: number | null;
  summary: { newRequests: number; waitingHandover: number; offers: number };
}

export default function SalesPage() {
  return <RequireAuth reason="чтобы увидеть свои продажи">{(me) => (
        <Suspense>
          {me.isSeller ? (
            <Sales />
          ) : (
            // Nothing listed yet: no point in empty counters, offer the first step instead.
            <EmptyState art={<Daruma eyes={1} className="mb-2 h-40" />} title="Загадайте первую продажу" hint="Выставьте первую вещь — запросы покупателей, сделки и статистика появятся здесь">
              <ButtonLink href="/sell">Выставить вещь</ButtonLink>
            </EmptyState>
          )}
        </Suspense>
      )}</RequireAuth>;
}

function Sales() {
  const router = useRouter();
  const params = useSearchParams();
  // Chips are filters: none on at first (every deal), a second tap on the same chip shows everything again.
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? null) as Tab | null;
  const toggle = (t: Tab) => router.replace(tab === t ? "?" : `?tab=${t}`, { scroll: false });
  const setTab = (t: Tab) => router.replace(`?tab=${t}`, { scroll: false });
  const { data, error, mutate } = useSWR<SalesData>(`/sales?tab=${tab ?? "all"}`);
  const offers = useSWR<{ items: Offer[] }>(tab === "action" ? "/offers?role=seller&turn=mine" : "/offers?role=seller");
  const s = data?.summary;
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TitleWithKanji kanji="商い">
          <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Продажи</h1>
        </TitleWithKanji>
        <ButtonLink href="/sales/stats" variant="secondary" size="sm">
          Статистика
        </ButtonLink>
      </div>

      {s && (
        <div className="rise mt-6 grid grid-cols-3 gap-3 md:gap-4">
          <button onClick={() => setTab("action")} className="rounded-3xl bg-surface p-4 text-left shadow-[var(--shadow-paper)] transition-transform duration-200 hover:-translate-y-0.5 md:p-6">
            <p className="tabular text-2xl font-bold md:text-4xl">{s.newRequests}</p>
            <p className="text-sm text-muted">{plural(s.newRequests, "новый запрос", "новых запроса", "новых запросов")}</p>
          </button>
          <button onClick={() => setTab("action")} className="rounded-3xl bg-surface p-4 text-left shadow-[var(--shadow-paper)] transition-transform duration-200 hover:-translate-y-0.5 md:p-6">
            <p className="tabular text-2xl font-bold md:text-4xl">{s.waitingHandover}</p>
            <p className="text-sm text-muted">{plural(s.waitingHandover, "сделка ожидает", "сделки ожидают", "сделок ожидают")} передачи</p>
          </button>
          <button onClick={() => setTab("action")} className="rounded-3xl bg-surface p-4 text-left shadow-[var(--shadow-paper)] transition-transform duration-200 hover:-translate-y-0.5 md:p-6">
            <p className="tabular text-2xl font-bold md:text-4xl">{s.offers}</p>
            <p className="text-sm text-muted">{plural(s.offers, "предложение цены", "предложения цены", "предложений цены")}</p>
          </button>
        </div>
      )}

      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto" role="group" aria-label="Показать только">
        {TABS.map(([key, label]) => (
          <Chip key={key} active={tab === key} onClick={() => toggle(key)}>
            {label}
          </Chip>
        ))}
        <ButtonLink href="/wardrobe" variant="ghost" size="sm" className="ml-auto">
          Мои вещи
        </ButtonLink>
      </div>

      {tab === "sold" && data?.soldTotal != null && data.items.length > 0 && <p className="mt-4 text-ink-2">Продано на <b className="tabular text-ink">{formatPrice(data.soldTotal)}</b></p>}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0 lg:[&>*:only-child]:col-span-2">
        {error ? (
          <ErrorState message="Не удалось загрузить сделки" onRetry={() => mutate()} />
        ) : !data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : data.items.length === 0 && !(tab !== "sold" && offers.data?.items.length) ? (
          tab === "action" ? (
            <EmptyState art={<Daruma eyes={2} className="mb-2 h-36" />} title="Всё отвечено" hint="Новые запросы появятся здесь — мы пришлём уведомление" />
          ) : (
            <EmptyState art={<Furoshiki className="mb-2 h-36" />} title="Здесь появятся ваши сделки">
              <ButtonLink href="/sell">+ Добавить вещь</ButtonLink>
            </EmptyState>
          )
        ) : (
          <>
            {tab !== "sold" && offers.data?.items.map((o) => <OfferCard key={o.id} offer={o} onChange={() => (void offers.mutate(), void mutate())} />)}
            {data.items.map((d) => (
              <DealCard key={d.id} deal={d} onChange={() => mutate()} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
