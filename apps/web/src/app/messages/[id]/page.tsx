"use client";

import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { LocationBubble, LocationPicker, LocationViewer } from "@/components/chat-location";
import { RequireAuth } from "@/components/require-auth";
import { ThreadList } from "@/components/thread-list";
import { LIVE_MESSAGE_EVENT, LIVE_RISK_EVENT, type LiveMessage, type LiveRisk, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { DealBadge, EmptyState, ErrorState, IconChevronLeft, IconPin, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { ChatLocation, ChatMessage, ThreadSummary } from "@/lib/types";

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы открыть переписку">{() => <Thread id={id} />}</RequireAuth>;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function Thread({ id }: { id: string }) {
  const { data, error, mutate } = useSWR<{ thread: ThreadSummary; messages: ChatMessage[]; hasMore: boolean }>(`/threads/${id}`);
  const { refresh } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<{ location: ChatLocation; mine: boolean } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Opening the thread marks it read on the server; refresh the header counter.
  useEffect(() => {
    if (data) void refresh();
  }, [data?.thread.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live messages from the SSE stream.
  useEffect(() => {
    const onMessage = (e: Event) => {
      const m = (e as CustomEvent<LiveMessage>).detail;
      if (m.threadId !== id) return;
      void mutate((d) => d && { ...d, messages: d.messages.some((x) => x.id === m.message.id) ? d.messages : [...d.messages, { id: m.message.id, body: m.message.body, mine: false, createdAt: m.message.createdAt, risk: m.message.risk ?? null, location: m.message.location ?? null }] }, { revalidate: false });
      void api(`/threads/${id}/read`, { method: "POST" }).then(() => refresh());
    };
    // Antifraud verdicts arrive a few seconds after the message itself.
    const onRisk = (e: Event) => {
      const r = (e as CustomEvent<LiveRisk>).detail;
      if (r.threadId !== id) return;
      void mutate((d) => d && { ...d, messages: d.messages.map((x) => (x.id === r.messageId ? { ...x, risk: r.risk } : x)) }, { revalidate: false });
    };
    window.addEventListener(LIVE_MESSAGE_EVENT, onMessage);
    window.addEventListener(LIVE_RISK_EVENT, onRisk);
    return () => {
      window.removeEventListener(LIVE_MESSAGE_EVENT, onMessage);
      window.removeEventListener(LIVE_RISK_EVENT, onRisk);
    };
  }, [id, mutate, refresh]);

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
      if (m.notice) toast(m.notice, { tone: "error" });
    } catch (e) {
      void mutate((d) => d && { ...d, messages: d.messages.filter((x) => x.id !== tempId) }, { revalidate: false });
      setDraft(body);
      toast(e instanceof ApiError ? e.message : "Сообщение не отправлено — проверьте соединение", { tone: "error" });
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  const sendLocation = async (location: ChatLocation) => {
    setPicking(false);
    const tempId = `tmp-${Date.now()}`;
    void mutate((d) => d && { ...d, messages: [...d.messages, { id: tempId, body: "📍 Местоположение", mine: true, createdAt: new Date().toISOString(), pending: true, location }] }, { revalidate: false });
    try {
      const m = await api<ChatMessage>(`/threads/${id}/location`, { body: { ...location } });
      void mutate((d) => d && { ...d, messages: d.messages.map((x) => (x.id === tempId ? m : x)) }, { revalidate: false });
    } catch (e) {
      void mutate((d) => d && { ...d, messages: d.messages.filter((x) => x.id !== tempId) }, { revalidate: false });
      toast(e instanceof ApiError ? e.message : "Местоположение не отправлено — проверьте соединение", { tone: "error" });
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
  const days = data.messages.map((m) => dayLabel(m.createdAt));

  return (
    <div className="mx-auto grid h-[calc(100dvh-56px)] max-w-[1280px] md:h-[calc(100dvh-64px)] lg:grid-cols-[360px_1fr] lg:gap-6 lg:px-6 lg:py-4">
      {/* Wide screens: all conversations stay on the left, like a messenger. */}
      <aside className="hidden min-h-0 overflow-y-auto overscroll-contain pr-1 lg:block">
        <ThreadList activeId={id} compact />
      </aside>
      <div className="flex min-h-0 flex-col lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line">
      {/* Item / deal context on top (frame 15). */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/messages" aria-label="Все сообщения" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-ink/5 lg:hidden">
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
            <Link href={`/buy/${t.listing.id}`} className="shrink-0 btn-wa btn-wa-ink rounded-lg px-3 py-1.5 text-sm font-semibold">
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
                {showDay && <span className="my-3 self-center rounded-full bg-ink/5 px-3 py-0.5 text-xs text-muted">{day}</span>}
                {m.location ? (
                  <div className={clsx("flex flex-col", m.mine ? "items-end" : "items-start", m.pending && "opacity-60")}>
                    <LocationBubble location={m.location} mine={m.mine} time={new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} onOpen={() => setViewing({ location: m.location!, mine: m.mine })} />
                  </div>
                ) : (
                <div className={clsx("max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug", m.mine ? "self-end rounded-br-md bg-accent text-accent-ink" : "self-start rounded-bl-md bg-surface", m.pending && "opacity-60")}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={clsx("mt-0.5 text-right text-[11px]", m.mine ? "text-accent-ink/60" : "text-muted")}>
                    {new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                )}
                {!m.mine && m.risk && (
                  <p
                    role="alert"
                    className={clsx(
                      "mt-1 flex max-w-[80%] items-start gap-1.5 self-start rounded-xl px-3 py-2 text-xs leading-snug",
                      m.risk.level === "high" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn",
                    )}
                  >
                    <span aria-hidden className="font-bold">!</span>
                    <span>
                      {m.risk.level === "high" && <b className="font-semibold">Похоже на мошенничество. </b>}
                      {m.risk.text}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <form
        className="flex items-end gap-2 border-t border-line px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="Отправить местоположение"
          title="Отправить местоположение"
          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-ink/5 hover:text-ink"
        >
          <IconPin className="size-6" />
        </button>
        <label htmlFor="chat-input" className="sr-only">
          Сообщение
        </label>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Сообщение…"
          className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-[15px] outline-none focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-accent/15"
        />
        <button type="submit" disabled={!draft.trim()} className="h-11 shrink-0 btn-wa btn-wa-ink rounded-xl px-4 font-semibold disabled:opacity-40">
          Отправить
        </button>
      </form>
      <LocationPicker open={picking} onClose={() => setPicking(false)} onSend={(p) => void sendLocation(p)} />
      <LocationViewer location={viewing?.location ?? null} title={viewing?.mine ? "Ваше местоположение" : `Местоположение @${t.counterpart.username}`} onClose={() => setViewing(null)} />
      </div>
    </div>
  );
}
