"use client";

import { Chochin } from "@/components/shop/chochin";
import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { RequireAuth } from "@/components/require-auth";
import { useSession } from "@/components/session";
import { Button, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/labels";
import { notificationHref, notificationText, type NotificationRow } from "@/lib/notifications";

export default function NotificationsPage() {
  return <RequireAuth reason="чтобы увидеть уведомления">{() => <Notifications />}</RequireAuth>;
}

const GROUPS: Array<[string, string, (t: string) => boolean]> = [
  ["all", "Все", () => true],
  ["deals", "Сделки", (t) => t.startsWith("request_") || t.startsWith("deal_")],
  ["offers", "Предложения", (t) => t.startsWith("offer_")],
  ["saved", "Избранное и подписки", (t) => t.startsWith("item_") || t === "price_drop" || t === "follow_new_item"],
];

/** Activity page (frame 15): every notification, newest first, with a link to act on it. */
function Notifications() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [group, setGroup] = useState("all");
  const { refresh } = useSession();
  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite<{ items: NotificationRow[]; hasMore: boolean }>((i, prev) => {
    if (prev && !prev.hasMore) return null;
    const before = prev?.items.at(-1)?.createdAt;
    return `/notifications?limit=30${unreadOnly ? "&unread=1" : ""}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  });
  const items = (data ?? []).flatMap((p) => p.items).filter((n) => GROUPS.find(([k]) => k === group)![2](n.type));
  const hasMore = data?.at(-1)?.hasMore;
  const unread = (data ?? []).flatMap((p) => p.items).some((n) => !n.readAt);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Уведомления</h1>
        {unread && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await api("/notifications/read-all", { method: "POST" });
              await mutate();
              void refresh();
            }}
          >
            Прочитать все
          </Button>
        )}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <div className="no-scrollbar flex gap-2 overflow-x-auto lg:sticky lg:top-24 lg:flex-col lg:self-start lg:overflow-visible">
        {GROUPS.map(([key, label]) => (
          <Chip key={key} active={group === key} onClick={() => setGroup(key)} className="lg:justify-start">
            {label}
          </Chip>
        ))}
        <Chip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} className="ml-auto lg:ml-0 lg:mt-3 lg:justify-start">
          Непрочитанные
        </Chip>
      </div>

      <div className="min-w-0">
        {error ? (
          <ErrorState message="Не удалось загрузить уведомления" onRetry={() => mutate()} />
        ) : !data ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState art={<Chochin className="mb-2 h-40" />} title="Здесь появятся ответы продавцов, новые запросы, предложения цены и снижение цен" />
        ) : (
          <ul className="rise flex flex-col divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={notificationHref(n)}
                  onClick={() => !n.readAt && void api(`/notifications/${n.id}/read`, { method: "POST" }).then(() => refresh())}
                  className="flex items-start gap-3 rounded-2xl px-3 py-3.5 transition-colors hover:bg-surface"
                >
                  <span className={clsx("mt-2 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-danger")} aria-label={n.readAt ? undefined : "Новое"} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block text-[15px]", !n.readAt && "font-medium")}>{notificationText(n)}</span>
                    <span className="text-xs text-muted">{timeAgo(n.createdAt)}</span>
                  </span>
                  {n.cover && (
                    <span className="w-11 shrink-0 overflow-hidden rounded-lg bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={n.cover} alt="" width={44} height={55} loading="lazy" className="size-full object-contain" />
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" loading={isValidating} onClick={() => setSize(size + 1)}>
              Показать ещё
            </Button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
