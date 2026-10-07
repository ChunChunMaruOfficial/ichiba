"use client";

import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { LIVE_MESSAGE_EVENT, LIVE_READ_EVENT, LIVE_TYPING_EVENT, type LiveMessage, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { DealBadge, EmptyState, ErrorState, IconChevronLeft, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { ChatMessage, ThreadSummary } from "@/lib/types";

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы открыть переписку">{() => <Thread id={id} />}</RequireAuth>;
}

/** Messages that look like a request for prepayment or card details get a safety hint (frame 30 antifraud). */
const RISKY = /(предоплат|переведи|переведите|номер карты|карт[уы] \d|cvv|cvc|код из смс|ссылк[ау] на оплату|оплат[аи] по ссылке)/i;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function Thread({ id }: { id: string }) {
  const { refresh, realtime } = useSession();
  // Without a live channel (e.g. no Pusher keys on Vercel) the open thread polls every 5 s.
  const { data, error, mutate } = useSWR<{ thread: ThreadSummary; messages: ChatMessage[]; hasMore: boolean }>(`/threads/${id}`, {
    refreshInterval: realtime === "live" ? 0 : 5000,
  });
  const [typingUntil, setTypingUntil] = useState(0);
  const lastTypingSent = useRef(0);
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Opening the thread marks it read on the server; refresh the header counter.
  useEffect(() => {
    if (data) void refresh();
  }, [data?.thread.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live messages, read receipts and "печатает…" from the WebSocket.
  useEffect(() => {
    const onMessage = (e: Event) => {
      const m = (e as CustomEvent<LiveMessage>).detail;
      if (m.threadId !== id) return;
      setTypingUntil(0);
      void mutate((d) => d && { ...d, messages: d.messages.some((x) => x.id === m.message.id) ? d.messages : [...d.messages, { id: m.message.id, body: m.message.body, mine: false, createdAt: m.message.createdAt }] }, { revalidate: false });
      void api(`/threads/${id}/read`, { method: "POST" }).then(() => refresh());
    };
    const onRead = (e: Event) => {
      const r = (e as CustomEvent<{ threadId: string; at: string }>).detail;
      if (r.threadId !== id) return;
      void mutate((d) => d && { ...d, thread: { ...d.thread, counterpartReadAt: r.at } }, { revalidate: false });
    };
    const onTyping = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail.threadId === id) setTypingUntil(Date.now() + 5000);
    };
    window.addEventListener(LIVE_MESSAGE_EVENT, onMessage);
    window.addEventListener(LIVE_READ_EVENT, onRead);
    window.addEventListener(LIVE_TYPING_EVENT, onTyping);
    return () => {
      window.removeEventListener(LIVE_MESSAGE_EVENT, onMessage);
      window.removeEventListener(LIVE_READ_EVENT, onRead);
      window.removeEventListener(LIVE_TYPING_EVENT, onTyping);
    };
  }, [id, mutate, refresh]);

  // Hide "печатает…" when the other side stops.
  useEffect(() => {
    if (!typingUntil) return;
    const t = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(t);
  }, [typingUntil]);

  const notifyTyping = () => {
    if (realtime !== "live" || Date.now() - lastTypingSent.current < 3000) return;
    lastTypingSent.current = Date.now();
    void api(`/threads/${id}/typing`, { method: "POST" }).catch(() => undefined);
  };

  // Keep the newest message in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [data?.messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    const tempId = `tmp-${Date.now()}`;
    setDraft("");
    setSending(true);
    void mutate((d) => d && { ...d, messages: [...d.messages, { id: tempId, body, mine: true, createdAt: new Date().toISOString(), pending: true }] }, { revalidate: false });
    try {
      const m = await api<ChatMessage>(`/threads/${id}/messages`, { body: { body } });
      void mutate((d) => d && { ...d, messages: d.messages.map((x) => (x.id === tempId ? m : x)) }, { revalidate: false });
    } catch (e) {
      void mutate((d) => d && { ...d, messages: d.messages.filter((x) => x.id !== tempId) }, { revalidate: false });
      setDraft(body);
      toast(e instanceof ApiError ? e.message : "Сообщение не отправлено — проверьте соединение", { tone: "error" });
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  if (error) {
    return error instanceof ApiError && (error.status === 404 || error.status === 403) ? (
      <EmptyState title="Диалог не найден" />
    ) : (
      <ErrorState message="Не удалось загрузить переписку" onRetry={() => mutate()} />
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }

  const t = data.thread;
  const risky = data.messages.some((m) => !m.mine && RISKY.test(m.body)) || RISKY.test(draft);
  const days = data.messages.map((m) => dayLabel(m.createdAt));
  const readAt = t.counterpartReadAt ? new Date(t.counterpartReadAt).getTime() : 0;
  const lastMine = [...data.messages].reverse().find((m) => m.mine && !m.pending);
  const seen = !!lastMine && readAt >= new Date(lastMine.createdAt).getTime();

  return (
    <div className="mx-auto flex h-[calc(100dvh-56px)] max-w-3xl flex-col md:h-[calc(100dvh-64px)]">
      {/* Item / deal context on top (frame 15). */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/messages" aria-label="Все сообщения" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-black/5">
          <IconChevronLeft />
        </Link>
        <Link href={`/item/${t.listing.id}`} className="w-11 shrink-0 overflow-hidden rounded-lg bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.listing.cover && <img src={t.listing.cover.urls.s} alt="" width={44} height={55} className="size-full object-cover" />}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            <Link href={`/u/${t.counterpart.username}`} className="hover:underline">
              @{t.counterpart.username}
            </Link>
          </p>
          <p className="truncate text-sm text-ink-2">
            {t.listing.title} · <span className="tabular">{formatPrice(t.listing.price)}</span>
          </p>
        </div>
        {t.request ? (
          <Link href={`/deals/${t.request.id}`} className="shrink-0">
            <DealBadge status={t.request.status} role={t.role} />
          </Link>
        ) : (
          t.role === "buyer" &&
          t.listing.status === "PUBLISHED" && (
            <Link href={`/buy/${t.listing.id}`} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
              Купить
            </Link>
          )
        )}
      </div>

      <div ref={list} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {data.messages.length === 0 && <p className="py-10 text-center text-sm text-muted">Напишите продавцу — например, есть ли замеры или можно ли посмотреть вещь вживую.</p>}
        <ol className="flex flex-col gap-1.5">
          {data.messages.map((m, i) => {
            const day = days[i];
            const showDay = i === 0 || day !== days[i - 1];
            return (
              <li key={m.id} className="flex flex-col">
                {showDay && <span className="my-3 self-center rounded-full bg-black/5 px-3 py-0.5 text-xs text-muted">{day}</span>}
                <div className={clsx("max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug", m.mine ? "self-end rounded-br-md bg-accent text-accent-ink" : "self-start rounded-bl-md bg-surface", m.pending && "opacity-60")}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={clsx("mt-0.5 text-right text-[11px]", m.mine ? "text-white/60" : "text-muted")}>
                    {new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        {seen && data.messages[data.messages.length - 1]?.id === lastMine?.id && <p className="mt-1 text-right text-xs text-muted">Прочитано</p>}
        {typingUntil > 0 && <p className="mt-2 text-sm text-muted">@{t.counterpart.username} печатает…</p>}
      </div>

      {risky && (
        <p className="mx-4 mb-2 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Не переводите предоплату и не сообщайте данные карты и коды из SMS. Безопаснее оплатить при получении.
        </p>
      )}
      <form
        className="flex items-end gap-2 border-t border-line px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Сообщение
        </label>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          value={draft}
          maxLength={2000}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) notifyTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Сообщение…"
          className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-[15px] outline-none focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-accent/15"
        />
        <button type="submit" disabled={!draft.trim()} className="h-11 shrink-0 rounded-xl bg-accent px-4 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40">
          Отправить
        </button>
      </form>
    </div>
  );
}
