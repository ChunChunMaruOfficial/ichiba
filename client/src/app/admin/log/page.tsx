"use client";

import clsx from "clsx";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { Select } from "@/components/select";
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton } from "@/components/ui";
import { qs } from "@/lib/api";
import { itemHref } from "@/lib/item-path";

interface Row {
  id: string;
  at: string;
  action: string;
  detail: string | null;
  market: "brands" | "resale" | null;
  seller: { username: string; brand: string | true | null } | null;
  listing: { id: string; title: string; status: string } | null;
}

const MARKETS = [
  ["all", "Все"],
  ["brands", "Бренды и каталог"],
  ["resale", "Вторичка"],
] as const;

/** Server codes (server/src/activity/activity.ts) in words. Deal steps are `deal_<status>`. */
const ACTIONS: Record<string, string> = {
  listing_created: "Создал вещь",
  listing_edited: "Изменил вещь",
  price_changed: "Изменил цену",
  listing_published: "Выставил",
  listing_scheduled: "Запланировал публикацию",
  listing_hidden: "Снял с продажи",
  listing_bumped: "Поднял",
  listing_sold: "Продано",
  listing_deleted: "Удалил вещь",
  offer_countered: "Встречная цена",
  offer_accepted: "Принял предложение",
  offer_declined: "Отклонил предложение",
  likers_offer: "Скидка лайкнувшим",
  auction_cancelled: "Отменил аукцион",
  brand_applied: "Заявка на бренд",
  profile_edited: "Изменил профиль",
  look_created: "Создал образ",
};
const DEALS: Record<string, string> = {
  accepted: "Сделка: принял",
  declined: "Сделка: отклонил",
  cancelled: "Сделка: отменил",
  handed_over: "Сделка: передал",
  in_transit: "Сделка: отправил",
  disputed: "Сделка: спор",
  completed: "Сделка: завершена",
  counter_offered: "Сделка: встречная цена",
  waiting_handover: "Сделка: ждёт передачи",
  waiting_payment: "Сделка: ждёт оплаты",
};
const label = (a: string) => ACTIONS[a] ?? (a.startsWith("deal_") ? (DEALS[a.slice(5)] ?? `Сделка: ${a.slice(5)}`) : a);

const ACTION_FILTER = [{ value: "", label: "Все действия" }, ...Object.entries(ACTIONS).map(([value, l]) => ({ value, label: l })), { value: "deal", label: "Сделки" }];

const date = (v: string) => new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

/** «Журнал»: every seller action, brands and «Вторичка» alike, newest first. */
export default function AdminLogPage() {
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<(typeof MARKETS)[number][0]>("all");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const query = useDeferredValue(q);
  const { data, error, mutate } = useSWR<{ total: number; pageSize: number; items: Row[] }>(`/admin/activity${qs({ q: query, market, action, page })}`, { keepPreviousData: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input aria-label="Продавец" placeholder="Ник продавца…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="w-full max-w-xs" />
        <div className="flex flex-wrap gap-1">
          {MARKETS.map(([id, l]) => (
            <button
              key={id}
              type="button"
              onClick={() => (setMarket(id), setPage(1))}
              className={clsx("rounded-full px-3 py-1.5 text-sm", market === id ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="w-56">
          <Select aria-label="Действие" value={action} onChange={(v) => (setAction(v), setPage(1))} options={ACTION_FILTER} />
        </div>
        {data && <span className="ml-auto text-sm text-muted tabular">{data.total.toLocaleString("ru-RU")} записей</span>}
      </div>

      {error ? (
        <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Записей нет" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">Когда</th>
                <th className="px-4 py-3 font-medium">Продавец</th>
                <th className="px-4 py-3 font-medium">Раздел</th>
                <th className="px-4 py-3 font-medium">Действие</th>
                <th className="px-4 py-3 font-medium">Вещь</th>
                <th className="px-4 py-3 font-medium">Подробности</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((r) => (
                <tr key={r.id} className="hover:bg-ink/[0.03]">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-2 tabular">{date(r.at)}</td>
                  <td className="px-4 py-3 font-medium">
                    {r.seller ? (
                      <Link href={`/u/${r.seller.username}`} target="_blank" className="hover:underline">
                        @{r.seller.username}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {r.seller?.brand && <span className="ml-2 text-xs font-normal text-muted">бренд</span>}
                  </td>
                  <td className="px-4 py-3">{r.market === "brands" ? <Badge tone="dark">каталог</Badge> : r.market === "resale" ? <Badge tone="muted">вторичка</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3">{label(r.action)}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-ink-2">
                    {r.listing ? (
                      <Link href={itemHref(r.listing)} target="_blank" className="hover:text-ink hover:underline" title={r.listing.title}>
                        {r.listing.title || "Без названия"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-ink-2" title={r.detail ?? undefined}>
                    {r.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Назад
          </Button>
          <span className="tabular text-muted">
            {page} / {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Дальше
          </Button>
        </div>
      )}
    </div>
  );
}
