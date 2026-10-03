"use client";

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
  return <RequireAuth reason="чтобы увидеть свои продажи">{() => (
        <Suspense>
          <Sales />
        </Suspense>
      )}</RequireAuth>;
}

function Sales() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "action") as Tab;
  const setTab = (t: Tab) => router.replace(t === "action" ? "?" : `?tab=${t}`, { scroll: false });
  const { data, error, mutate } = useSWR<SalesData>(`/sales?tab=${tab}`);
  const offers = useSWR<{ items: Offer[] }>(tab === "action" ? "/offers?role=seller&turn=mine" : "/offers?role=seller");
  const s = data?.summary;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Мои продажи</h1>

      {s && (
        <div className="mt-6 grid grid-cols-3 gap-3">
          <button onClick={() => setTab("action")} className="rounded-2xl bg-surface p-4 text-left hover:bg-white">
            <p className="tabular text-2xl font-semibold">{s.newRequests}</p>
            <p className="text-sm text-muted">{plural(s.newRequests, "новый запрос", "новых запроса", "новых запросов")}</p>
          </button>
          <button onClick={() => setTab("action")} className="rounded-2xl bg-surface p-4 text-left hover:bg-white">
            <p className="tabular text-2xl font-semibold">{s.waitingHandover}</p>
            <p className="text-sm text-muted">{plural(s.waitingHandover, "сделка ожидает", "сделки ожидают", "сделок ожидают")} передачи</p>
          </button>
          <button onClick={() => setTab("action")} className="rounded-2xl bg-surface p-4 text-left hover:bg-white">
            <p className="tabular text-2xl font-semibold">{s.offers}</p>
            <p className="text-sm text-muted">{plural(s.offers, "предложение цены", "предложения цены", "предложений цены")}</p>
          </button>
        </div>
      )}

      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto" role="tablist">
        {TABS.map(([key, label]) => (
          <Chip key={key} role="tab" aria-selected={tab === key} active={tab === key} onClick={() => setTab(key)}>
            {label}
          </Chip>
        ))}
        <ButtonLink href="/wardrobe" variant="ghost" size="sm" className="ml-auto">
          Мои вещи
        </ButtonLink>
      </div>

      {tab === "sold" && data?.soldTotal != null && data.items.length > 0 && <p className="mt-4 text-ink-2">Продано на <b className="tabular text-ink">{formatPrice(data.soldTotal)}</b></p>}

      <div className="mt-6 flex flex-col gap-3">
        {error ? (
          <ErrorState message="Не удалось загрузить сделки" onRetry={() => mutate()} />
        ) : !data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : data.items.length === 0 && !(tab !== "sold" && offers.data?.items.length) ? (
          tab === "action" ? (
            <EmptyState title="Всё отвечено 👌" />
          ) : (
            <EmptyState title="Здесь появятся ваши сделки">
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
