"use client";

import clsx from "clsx";
import Link from "next/link";
import useSWR from "swr";
import { useSession } from "@/components/session";
import { RequireAuth } from "@/components/require-auth";
import { DealBadge, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { timeAgo } from "@/lib/labels";
import type { ThreadSummary } from "@/lib/types";

export default function MessagesPage() {
  return <RequireAuth reason="чтобы открыть сообщения">{() => <Threads />}</RequireAuth>;
}

/** Conversations list (frame 15): one per item, newest first, unread in bold. */
function Threads() {
  const { realtime } = useSession();
  const { data, error, mutate } = useSWR<{ items: ThreadSummary[] }>("/threads", { refreshInterval: realtime === "live" ? 0 : 15_000 });
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Сообщения</h1>
      <div className="mt-6">
        {error ? (
          <ErrorState message="Не удалось загрузить сообщения" onRetry={() => mutate()} />
        ) : !data ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title="Здесь появятся переписки с продавцами и покупателями" hint="Нажмите «Задать вопрос» на странице вещи" />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link href={`/messages/${t.id}`} className="flex gap-4 rounded-2xl px-2 py-3 hover:bg-surface">
                  <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.listing.cover && <img src={t.listing.cover.urls.s} alt="" width={56} height={70} className="size-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={clsx("truncate", t.unread && "font-semibold")}>
                        @{t.counterpart.username}
                        <span className="ml-2 text-sm font-normal text-muted">{t.role === "buyer" ? "продавец" : "покупатель"}</span>
                      </p>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(t.lastMessageAt)}</span>
                    </div>
                    <p className="truncate text-sm text-ink-2">{t.listing.title}</p>
                    <p className={clsx("truncate text-sm", t.unread ? "font-medium text-ink" : "text-muted")}>
                      {t.lastMessage?.mine && "Вы: "}
                      {t.lastMessage?.body}
                    </p>
                  </div>
                  {t.unread && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-danger" aria-label="Непрочитано" />}
                  {t.request && !t.unread && (
                    <span className="hidden shrink-0 self-center sm:block">
                      <DealBadge status={t.request.status} role={t.role} />
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
