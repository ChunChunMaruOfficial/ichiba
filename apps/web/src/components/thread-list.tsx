"use client";

import clsx from "clsx";
import Link from "next/link";
import useSWR from "swr";
import { timeAgo } from "@/lib/labels";
import type { ThreadSummary } from "@/lib/types";
import { DealBadge, EmptyState, ErrorState, Skeleton } from "./ui";

/** Conversations (frame 15): one per item, newest first, unread in bold. `activeId` highlights the open one. */
export function ThreadList({ activeId, compact }: { activeId?: string; compact?: boolean }) {
  const { data, error, mutate } = useSWR<{ items: ThreadSummary[] }>("/threads");
  if (error) return <ErrorState message="Не удалось загрузить сообщения" onRetry={() => mutate()} />;
  if (!data)
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  if (data.items.length === 0) return <EmptyState title="Здесь появятся переписки с продавцами и покупателями" hint="Нажмите «Задать вопрос» на странице вещи" />;
  return (
    <ul className="flex flex-col gap-1">
      {data.items.map((t, i) => (
        <li key={t.id} className="rise" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
          <Link
            href={`/messages/${t.id}`}
            aria-current={t.id === activeId ? "page" : undefined}
            className={clsx("flex gap-3.5 rounded-2xl px-3 py-3 transition-colors", t.id === activeId ? "bg-surface shadow-[inset_3px_0_0_var(--shu)]" : "hover:bg-surface/70")}
          >
            <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.listing.cover && <img src={t.listing.cover.urls.s} alt="" width={56} height={70} className="size-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className={clsx("truncate", t.unread && "font-semibold")}>
                  @{t.counterpart.username}
                  {!compact && <span className="ml-2 text-sm font-normal text-muted">{t.role === "buyer" ? "продавец" : "покупатель"}</span>}
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
            {!compact && t.request && !t.unread && (
              <span className="hidden shrink-0 self-center sm:block">
                <DealBadge status={t.request.status} role={t.role} />
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
