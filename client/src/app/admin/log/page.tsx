"use client";

import clsx from "clsx";
import Link from "next/link";
import { Fragment, useDeferredValue, useRef, useState } from "react";
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
interface Page {
  total: number;
  pageSize: number;
  summary: { sellers: number; created: number; published: number; sold: number; deals: number };
  items: Row[];
}

const MARKETS = [
  ["all", "Все"],
  ["brands", "Бренды и каталог"],
  ["resale", "Вторичка"],
] as const;

/** Periods, as whole days in Minsk time: the API takes `from` and `to` as dates. */
const PERIODS = [
  ["all", "Всё время", 0],
  ["today", "Сегодня", 1],
  ["week", "7 дней", 7],
  ["month", "30 дней", 30],
] as const;
type Period = (typeof PERIODS)[number][0];
const dayStr = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Minsk" }).format(d);
const fromOf = (p: Period) => {
  const days = PERIODS.find(([id]) => id === p)![2];
  return days ? dayStr(new Date(Date.now() - (days - 1) * 86_400_000)) : "";
};

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
/** The tone of an action at a glance: money and sales in cinnabar, removals muted, the rest plain. */
const tone = (a: string): "sale" | "ok" | "muted" | "warn" | null =>
  a === "listing_sold" || a === "deal_completed" ? "sale" : a === "listing_published" || a === "listing_created" ? "ok" : a === "listing_deleted" || a === "listing_hidden" ? "muted" : a === "deal_disputed" ? "warn" : null;

const ACTION_FILTER = [{ value: "", label: "Все действия" }, ...Object.entries(ACTIONS).map(([value, l]) => ({ value, label: l })), { value: "deal", label: "Сделки" }];

const time = (v: string) => new Date(v).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayTitle = (v: string) => {
  const d = new Date(v);
  const today = dayStr(new Date());
  const yesterday = dayStr(new Date(Date.now() - 86_400_000));
  const key = dayStr(d);
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return key === today ? `Сегодня, ${date}` : key === yesterday ? `Вчера, ${date}` : d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

const Chip = ({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} className={clsx("rounded-full px-3 py-1.5 text-sm", active ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}>
    {children}
  </button>
);

/**
 * «Журнал»: every seller action, brands and «Вторичка» alike, newest first, by day. Filters: section, kind of action,
 * seller (type a nick or click one), period. The first page refreshes itself every 15 s and marks what came in.
 */
export default function AdminLogPage() {
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<(typeof MARKETS)[number][0]>("all");
  const [period, setPeriod] = useState<Period>("week");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const query = useDeferredValue(q);
  const live = page === 1;
  // Rows newer than the newest one seen on the previous refresh flash once.
  const seenTop = useRef<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const { data, error, mutate, isValidating } = useSWR<Page>(`/admin/activity${qs({ q: query, market, action, page, from: fromOf(period) })}`, {
    keepPreviousData: true,
    refreshInterval: live ? 15_000 : 0,
    onSuccess: (d) => {
      if (!live) return;
      const top = d.items[0]?.id ?? null;
      if (seenTop.current && top !== seenTop.current) {
        const i = d.items.findIndex((r) => r.id === seenTop.current);
        setFresh(new Set(d.items.slice(0, i < 0 ? 0 : i).map((r) => r.id)));
      }
      seenTop.current = top;
    },
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  /** A changed filter starts from page one and forgets what was «new». */
  const reset = () => {
    setPage(1);
    seenTop.current = null;
    setFresh(new Set());
  };
  const pick = (username: string) => (setQ(q === username ? "" : username), reset());

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input aria-label="Продавец" placeholder="Ник продавца…" value={q} onChange={(e) => (setQ(e.target.value), reset())} className="w-full max-w-xs" />
        <div className="flex flex-wrap gap-1">
          {MARKETS.map(([id, l]) => (
            <Chip key={id} active={market === id} onClick={() => (setMarket(id), reset())}>
              {l}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {PERIODS.map(([id, l]) => (
            <Chip key={id} active={period === id} onClick={() => (setPeriod(id), reset())}>
              {l}
            </Chip>
          ))}
        </div>
        <div className="w-56">
          <Select aria-label="Действие" value={action} onChange={(v) => (setAction(v), reset())} options={ACTION_FILTER} />
        </div>
        {data && (
          <span className="ml-auto flex items-center gap-2 text-sm text-muted tabular">
            {live && (
              <span className="relative inline-flex size-2" title="Обновляется каждые 15 секунд">
                <span className={clsx("absolute inset-0 rounded-full bg-ok", isValidating ? "live-ping" : "opacity-0")} />
                <span className="relative inline-block size-2 rounded-full bg-ok" />
              </span>
            )}
            {data.total.toLocaleString("ru-RU")} записей
          </span>
        )}
      </div>

      {data && (
        <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl bg-surface px-5 py-4 text-sm sm:grid-cols-5">
          {(
            [
              ["Продавцов", data.summary.sellers],
              ["Создано вещей", data.summary.created],
              ["Выставлено", data.summary.published],
              ["Продано", data.summary.sold],
              ["Шагов по сделкам", data.summary.deals],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="tabular text-2xl font-semibold">{v.toLocaleString("ru-RU")}</dd>
            </div>
          ))}
        </dl>
      )}

      {error ? (
        <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Записей нет" hint={period !== "all" ? "За этот период продавцы ничего не делали — попробуйте «Всё время»" : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
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
              {data.items.map((r, i) => {
                const prev = data.items[i - 1];
                const newDay = !prev || dayStr(new Date(prev.at)) !== dayStr(new Date(r.at));
                const t = tone(r.action);
                return (
                  <Fragment key={r.id}>
                    {newDay && (
                      <tr className="bg-paper/60">
                        <td colSpan={6} className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          {dayTitle(r.at)}
                        </td>
                      </tr>
                    )}
                    <tr className={clsx("hover:bg-ink/[0.03]", fresh.has(r.id) && "msg-flash")}>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2 tabular">{time(r.at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">
                        {r.seller ? (
                          <>
                            <button type="button" onClick={() => pick(r.seller!.username)} className={clsx("underline-offset-4 hover:underline", q === r.seller.username && "text-shu")} title="Только этот продавец">
                              @{r.seller.username}
                            </button>
                            <Link href={`/u/${r.seller.username}`} target="_blank" className="ml-1.5 text-muted hover:text-ink" title="Профиль">
                              ↗
                            </Link>
                          </>
                        ) : (
                          "—"
                        )}
                        {r.seller?.brand && <span className="ml-2 text-xs font-normal text-muted">бренд</span>}
                      </td>
                      <td className="px-4 py-3">{r.market === "brands" ? <Badge tone="dark">каталог</Badge> : r.market === "resale" ? <Badge tone="muted">вторичка</Badge> : <span className="text-muted">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3">{t ? <Badge tone={t}>{label(r.action)}</Badge> : label(r.action)}</td>
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
                  </Fragment>
                );
              })}
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
