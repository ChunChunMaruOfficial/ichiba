"use client";

import clsx from "clsx";
import Link from "next/link";
import useSWR from "swr";
import { timeAgo } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { AssistantSummary, ThreadSummary } from "@/lib/types";
import { IconPushpin } from "./chat/icons";
import { useSession } from "./session";
import { DealBadge, EmptyState, ErrorState, Skeleton } from "./ui";

/** Conversations (frame 15): one per item, newest first, unread in bold. `activeId` highlights the open one. */
export function ThreadList({ activeId, compact }: { activeId?: string; compact?: boolean }) {
  const { realtime } = useSession();
  // Without a live channel the list polls for new messages.
  const { data, error, mutate } = useSWR<{ items: ThreadSummary[] }>("/threads", { refreshInterval: realtime === "live" ? 0 : 15_000 });
  const assistant = useSWR<AssistantSummary>("/assistant/summary", { refreshInterval: 0 });
  const { prefs } = usePrefs();
  if (error) return <ErrorState message="Не удалось загрузить сообщения" onRetry={() => mutate()} />;
  if (!data)
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  // The assistant's chat is one of the rows: on top while pinned, by the time of its last message otherwise.
  const at = assistant.data ? new Date(assistant.data.lastMessageAt).getTime() : 0;
  const before = prefs.assistantPinned ? 0 : data.items.filter((t) => new Date(t.lastMessageAt).getTime() > at).length;
  const row = (
    <li key="ichiba">
      <AssistantRow summary={assistant.data} active={activeId === ASSISTANT_ID} pinned={prefs.assistantPinned} />
    </li>
  );
  return (
    <ul className="flex flex-col divide-y divide-line">
      {before === 0 && row}
      {data.items.length === 0 && !compact && (
        <li>
          <EmptyState title="Здесь появятся переписки с продавцами и покупателями" hint="Нажмите «Задать вопрос» на странице вещи" />
        </li>
      )}
      {data.items.flatMap((t, i) => [
        <li key={t.id} className="rise" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
          <Link
            href={`/messages/${t.id}`}
            aria-current={t.id === activeId ? "page" : undefined}
            className={clsx("flex gap-3.5 rounded-2xl px-3 py-3.5 transition-colors", t.id === activeId ? "bg-surface" : "hover:bg-surface/70")}
          >
            <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.listing.cover && <img src={t.listing.cover.urls.s} alt="" width={56} height={70} className="size-full object-contain" />}
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
            {/* aria-label on a bare span is ignored by screen readers: the word goes in as visually hidden text. */}
            {t.unread && (
              <span className="mt-2 size-2.5 shrink-0 rounded-full bg-danger">
                <span className="sr-only">Непрочитано</span>
              </span>
            )}
            {!compact && t.request && !t.unread && (
              <span className="hidden shrink-0 self-center sm:block">
                <DealBadge status={t.request.status} role={t.role} />
              </span>
            )}
          </Link>
        </li>,
        before === i + 1 ? row : null,
      ])}
    </ul>
  );
}

/** The segment of /messages/ichiba, as the layout passes it for the open chat. */
export const ASSISTANT_ID = "ichiba";

/** The assistant's seal: 市 of 市場, «ichiba». */
export function AssistantSeal({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx("grid shrink-0 place-items-center rounded-xl bg-shu font-brush leading-none text-on-shu", className)}>
      市
    </span>
  );
}

function AssistantRow({ summary, active, pinned }: { summary?: AssistantSummary; active: boolean; pinned: boolean }) {
  const unread = !!summary?.unread && !active;
  return (
    <Link href="/messages/ichiba" aria-current={active ? "page" : undefined} className={clsx("flex gap-3.5 rounded-2xl px-3 py-3.5 transition-colors", active ? "bg-surface" : "hover:bg-surface/70")}>
      <AssistantSeal className="aspect-[4/5] w-14 text-3xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={clsx("flex min-w-0 items-center gap-1.5", unread && "font-semibold")}>
            <span className="truncate">Ichiba</span>
            {pinned && <IconPushpin className="size-3.5 shrink-0 text-muted" />}
            {pinned && <span className="sr-only">Закреплён</span>}
          </p>
          {summary && <span className="shrink-0 text-xs text-muted">{timeAgo(summary.lastMessageAt)}</span>}
        </div>
        <p className="truncate text-sm text-ink-2">Помощник площадки</p>
        <p className={clsx("truncate text-sm", unread ? "font-medium text-ink" : "text-muted")}>
          {summary && !summary.fromBot && "Вы: "}
          {summary?.lastMessage ?? "Напишите, что сделать"}
        </p>
      </div>
      {unread && (
        <span className="mt-2 size-2.5 shrink-0 rounded-full bg-danger">
          <span className="sr-only">Непрочитано</span>
        </span>
      )}
    </Link>
  );
}
