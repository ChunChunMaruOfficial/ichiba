"use client";

import { TitleWithKanji } from "@/components/sections";
import { Daruma } from "@/components/shop/daruma";
import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { Bars, BumpButton } from "@/components/trust";
import { ButtonLink, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { formatPrice, plural } from "@/lib/labels";
import type { StatsOverview } from "@/lib/types";

export default function StatsPage() {
  return <RequireAuth reason="чтобы открыть статистику">{() => <Stats />}</RequireAuth>;
}

/** Change against the previous period of the same length. */
function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev && !now) return <span className="text-xs text-muted">—</span>;
  if (!prev) return <span className="text-xs font-medium text-ok">новое</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  return <span className={clsx("tabular text-xs font-medium", pct > 0 ? "text-ok" : pct < 0 ? "text-danger" : "text-muted")}>{pct > 0 ? `+${pct}%` : `${pct}%`}</span>;
}

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function Stats() {
  const [days, setDays] = useState<7 | 30>(7);
  const { data, error, mutate } = useSWR<StatsOverview>(`/stats/overview?days=${days}`);

  if (error) return <ErrorState message="Не удалось загрузить статистику" onRetry={() => mutate()} />;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <Link href="/sales" className="text-sm text-ink-2 hover:text-ink">
        ← Мои продажи
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <TitleWithKanji kanji="統計">
          <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Статистика</h1>
        </TitleWithKanji>
        <div className="flex gap-2" role="group" aria-label="Период">
          {([7, 30] as const).map((d) => (
            <Chip key={d} active={days === d} onClick={() => setDays(d)}>
              {d} дней
            </Chip>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-56 rounded-3xl" />
        </div>
      ) : !data.listings.length ? (
        <EmptyState art={<Daruma eyes={1} className="mb-2 h-36" />} title="Пока нечего считать" hint="Статистика появится, когда вы выставите первую вещь">
          <ButtonLink href="/sell">Выставить вещь</ButtonLink>
        </EmptyState>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Просмотры", data.totals.views, data.previous.views],
                ["Добавили в ♡", data.totals.favorites, data.previous.favorites],
                ["Написали или предложили цену", data.totals.contacts, data.previous.contacts],
                ["Запросы на покупку", data.totals.requests, data.previous.requests],
                ["Продажи", data.totals.sales, data.previous.sales],
                ["Выручка", data.totals.revenue, data.previous.revenue],
              ] as const
            ).map(([label, now, prev]) => (
              <div key={label} className="rounded-2xl bg-surface p-4">
                <dd className="tabular text-2xl font-semibold">{label === "Выручка" ? formatPrice(now) : now}</dd>
                <dt className="mt-0.5 text-xs text-muted">{label}</dt>
                <div className="mt-1">
                  <Delta now={now} prev={prev} />
                </div>
              </div>
            ))}
          </dl>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className="rounded-3xl bg-surface p-5">
              <h2 className="font-semibold">Просмотры по дням</h2>
              <Bars values={data.series.map((d) => d.views)} labels={data.series.map((d) => dayLabel(d.day))} height={140} className="mt-4" title="Просмотры по дням" />
              <div className="mt-2 flex justify-between text-xs text-muted">
                <span>{dayLabel(data.series[0].day)}</span>
                <span>{dayLabel(data.series.at(-1)!.day)}</span>
              </div>
              <p className="mt-4 text-sm text-ink-2">
                ♡ за период: <b className="text-ink">{data.totals.favorites}</b> · в корзину: <b className="text-ink">{data.totals.carts}</b> · чаты: <b className="text-ink">{data.totals.chats}</b> · предложения цены: <b className="text-ink">{data.totals.offers}</b>
              </p>
            </section>

            <section className="rounded-3xl bg-surface p-5">
              <h2 className="font-semibold">Воронка</h2>
              <ol className="mt-4 flex flex-col gap-3">
                {data.funnel.map((f, i) => {
                  const top = data.funnel[0].value || 1;
                  // Share of all views (the stages aren't strictly nested: one viewer may write and also buy).
                  const share = i > 0 && data.funnel[0].value ? (f.value / data.funnel[0].value) * 100 : null;
                  return (
                    <li key={f.key}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{f.label}</span>
                        <span className="tabular font-semibold">
                          {f.value}
                          {share != null && <span className="ml-2 text-xs font-normal text-muted">{share < 1 && share > 0 ? share.toFixed(1) : Math.round(share)}% просмотров</span>}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-ink/5">
                        <div className="h-full rounded-full bg-ink/80" style={{ width: `${Math.max(f.value ? 2 : 0, (f.value / top) * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>

          {data.tips.length > 0 && (
            <section className="mt-6 rounded-3xl bg-kraft/50 p-5">
              <h2 className="font-semibold">Что можно улучшить</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {data.tips.map((t, i) => (
                  <li key={i}>
                    <Link href={`/item/${t.listingId}`} className="font-medium underline underline-offset-4">
                      {t.title}
                    </Link>
                    : {t.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6">
            <h2 className="mb-3 font-semibold">
              Вещи <span className="font-normal text-muted">· за {days} {plural(days, "день", "дня", "дней")}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {data.listings.map((r) => (
                <li key={r.listing.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-2xl bg-surface p-3 md:grid-cols-[56px_minmax(0,1fr)_auto_auto] md:items-center">
                  <Link href={`/item/${r.listing.id}`} className="row-span-2 overflow-hidden rounded-lg bg-skeleton md:row-span-1" style={{ aspectRatio: "4 / 5" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.listing.cover && <img src={r.listing.cover.urls.s} alt="" className="size-full object-contain" />}
                  </Link>
                  <div className="min-w-0">
                    <Link href={`/item/${r.listing.id}`} className="block truncate font-medium hover:underline">
                      {r.listing.title}
                    </Link>
                    <p className="text-sm text-ink-2">
                      {formatPrice(r.listing.price)}
                      {r.listing.status !== "PUBLISHED" && <span className="ml-2 text-muted">{{ RESERVED: "в сделке", HIDDEN: "скрыта", SOLD: "продана" }[r.listing.status as "RESERVED"] ?? ""}</span>}
                    </p>
                    {r.tips[0] && <p className="mt-0.5 text-xs text-ink-2">💡 {r.tips[0]}</p>}
                  </div>
                  <dl className="tabular flex gap-4 text-center text-sm md:px-4">
                    {(
                      [
                        ["просм.", r.period.views],
                        ["♡", r.period.favorites],
                        ["чаты", r.period.chats + r.period.offers],
                        ["запр.", r.period.requests],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dd className="font-semibold">{v}</dd>
                        <dt className="text-[11px] text-muted">{k}</dt>
                      </div>
                    ))}
                  </dl>
                  <div className="col-span-2 md:col-span-1">{r.bump && <BumpButton listingId={r.listing.id} bump={r.bump} size="sm" onDone={() => mutate()} />}</div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
