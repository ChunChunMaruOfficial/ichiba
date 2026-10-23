"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import { usePresence } from "@/lib/presence";
import type { ChatMessage, ThreadSummary } from "@/lib/types";
import { previewOf } from "./chat/composer";
import { IconSend } from "./chat/icons";
import { LIVE_MESSAGE_EVENT, LIVE_TYPING_EVENT, type LiveMessage, useSession } from "./session";
import { useToast } from "./toast";
import { IconExpand, IconX } from "./ui";

/** Conversations already dismissed in this browser session, by "threadId:last message time". */
const SEEN_KEY = "ichiba:mini-chat-seen";
const readSeen = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const markSeen = (key: string) => {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...readSeen().filter((k) => k !== key), key].slice(-50)));
  } catch {}
};

/** My message while it is being sent. */
const outgoing = (body: string): ChatMessage => ({ id: `tmp-${Date.now()}`, body, mine: true, createdAt: new Date().toISOString(), pending: true });

/** One-tap answers for the most common replies, by role. */
const QUICK: Record<"buyer" | "seller", string[]> = {
  seller: ["Да, ещё продаётся", "Могу показать вживую", "Сейчас пришлю замеры"],
  buyer: ["Спасибо!", "Договорились", "Когда удобно встретиться?"],
};

/**
 * A new message pops up as a mini chat in the corner (a sheet above the tabs on phones): who wrote, about which
 * item, the last messages, quick answers and a reply field. Reply right there, open the full chat, or close it.
 * Shows for live messages and, on entering the site, for the newest unread conversation; a conversation closed
 * here does not pop up again in this session until a newer message arrives. Never over the chat itself.
 */
export function MiniChat() {
  const { me, refresh } = useSession();
  const pathname = usePathname();
  const [threadId, setThreadId] = useState<string | null>(null);
  const lastUnread = useRef<number | null>(null);
  const inChat = pathname.startsWith("/messages");

  const show = useCallback(
    (id: string, stamp: string) => {
      if (window.location.pathname.startsWith("/messages")) return;
      if (readSeen().includes(`${id}:${stamp}`)) return;
      setThreadId(id);
    },
    [],
  );

  // Live: a message from someone, anywhere on the site.
  useEffect(() => {
    const onMessage = (e: Event) => {
      const { threadId: id, message } = (e as CustomEvent<LiveMessage>).detail;
      show(id, message.createdAt);
    };
    window.addEventListener(LIVE_MESSAGE_EVENT, onMessage);
    return () => window.removeEventListener(LIVE_MESSAGE_EVENT, onMessage);
  }, [show]);

  // Entering the site (or polling without a live channel): the unread counter grew → the newest unread conversation.
  const unread = me?.unreadMessages ?? 0;
  useEffect(() => {
    if (!me) return;
    const before = lastUnread.current;
    lastUnread.current = unread;
    if (!unread || (before != null && unread <= before)) return;
    let alive = true;
    const t = setTimeout(
      () =>
        void api<{ items: ThreadSummary[] }>("/threads")
          .then(({ items }) => {
            const t0 = items.find((x) => x.unread && x.lastMessage && !x.lastMessage.mine);
            if (alive && t0?.lastMessage) show(t0.id, t0.lastMessage.createdAt);
          })
          .catch(() => {}),
      // On arrival, let the page settle first.
      before == null ? 1200 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [me, unread, show]);

  // Going into the messages takes over.
  const [prevInChat, setPrevInChat] = useState(inChat);
  if (inChat !== prevInChat) {
    setPrevInChat(inChat);
    if (inChat) setThreadId(null);
  }

  const { mounted, closing } = usePresence(!!threadId && !inChat, 220);
  const [shown, setShown] = useState(threadId);
  if (threadId && threadId !== shown) setShown(threadId);
  if (!me || !mounted || !shown) return null;
  return (
    <MiniChatCard
      key={shown}
      id={shown}
      closing={closing}
      onClose={(stamp) => {
        if (stamp) markSeen(`${shown}:${stamp}`);
        setThreadId(null);
        void refresh();
      }}
    />
  );
}

function MiniChatCard({ id, closing, onClose }: { id: string; closing: boolean; onClose: (lastStamp?: string) => void }) {
  const toast = useToast();
  const { refresh } = useSession();
  const { data, mutate } = useSWR<{ thread: ThreadSummary; messages: ChatMessage[] }>(`/threads/${id}`);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Opening it marked the conversation read on the server: update the counters.
  useEffect(() => {
    if (data) void refresh();
  }, [data?.thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // More messages in this conversation arrive into the card; "печатает…" too.
  useEffect(() => {
    const onMessage = (e: Event) => {
      const { threadId, message } = (e as CustomEvent<LiveMessage>).detail;
      if (threadId !== id) return;
      setTyping(false);
      void mutate((d) => d && { ...d, messages: d.messages.some((x) => x.id === message.id) ? d.messages : [...d.messages, message] }, { revalidate: false });
      void api(`/threads/${id}/read`, { method: "POST" }).then(() => refresh()).catch(() => {});
    };
    let t: ReturnType<typeof setTimeout> | undefined;
    const onTyping = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail.threadId !== id) return;
      setTyping(true);
      clearTimeout(t);
      t = setTimeout(() => setTyping(false), 5000);
    };
    window.addEventListener(LIVE_MESSAGE_EVENT, onMessage);
    window.addEventListener(LIVE_TYPING_EVENT, onTyping);
    return () => {
      clearTimeout(t);
      window.removeEventListener(LIVE_MESSAGE_EVENT, onMessage);
      window.removeEventListener(LIVE_TYPING_EVENT, onTyping);
    };
  }, [id, mutate, refresh]);

  const messages = data?.messages.slice(-4) ?? [];
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // Esc closes.
  const last = data?.messages.at(-1)?.createdAt;
  useEffect(() => {
    // Escape belongs to an open modal (a dispute, a confirmation) first: the mini-chat stays while one is open.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="dialog"][aria-modal="true"]') && onClose(last);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, last]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    const temp = outgoing(body);
    const tempId = temp.id;
    void mutate((d) => d && { ...d, messages: [...d.messages, temp] }, { revalidate: false });
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

  const t = data?.thread;
  const hasDraft = !!draft.trim();
  const repliedAlready = messages.at(-1)?.mine;

  return (
    <section
      role="dialog"
      aria-label={t ? `Новое сообщение от @${t.counterpart.username}` : "Новое сообщение"}
      data-chrome="mini-chat"
      data-closing={closing || undefined}
      style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: dragging ? "none" : undefined }}
      className={clsx(
        "mini-chat fixed z-[65] flex flex-col overflow-hidden bg-surface shadow-[var(--shadow-float)] ring-1 ring-line",
        // Phones: a sheet above the tabs, full width. Desktop: a card in the corner.
        "inset-x-2 bottom-[calc(84px+env(safe-area-inset-bottom))] rounded-[24px] md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]",
      )}
    >
      {/* Phones: grab the top and swipe down to close. */}
      <div
        className="flex touch-none justify-center pt-2 md:hidden"
        onPointerDown={(e) => {
          start.current = e.clientY;
          setDragging(true);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => start.current != null && setDrag(Math.max(0, e.clientY - start.current))}
        onPointerUp={() => {
          const far = drag > 70;
          start.current = null;
          setDragging(false);
          setDrag(0);
          if (far) onClose(last);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setDrag(0);
        }}
        aria-hidden
      >
        <span className="h-1 w-10 rounded-full bg-ink/15" />
      </div>

      <header className="flex items-center gap-3 px-4 pb-3 pt-2 md:pt-4">
        {t ? (
          <>
            <span aria-hidden className="grid size-10 shrink-0 -rotate-3 place-items-center rounded-lg bg-shu text-lg font-bold uppercase text-on-shu">
              {t.counterpart.username.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate font-semibold">
                @{t.counterpart.username}
                <span className="ml-1.5 text-xs font-normal text-muted">{t.role === "buyer" ? "продавец" : "покупатель"}</span>
              </p>
              <p className="truncate text-xs text-muted">{typing ? <span className="text-shu">печатает…</span> : "новое сообщение"}</p>
            </div>
          </>
        ) : (
          <span className="h-10 flex-1" />
        )}
        <Link href={`/messages/${id}`} onClick={() => onClose()} aria-label="Открыть переписку" title="Открыть переписку" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-ink/5 hover:text-ink">
          <IconExpand className="size-[18px]" />
        </Link>
        <button type="button" onClick={() => onClose(last)} aria-label="Закрыть" title="Закрыть" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-ink/5 hover:text-ink">
          <IconX className="size-5" />
        </button>
      </header>

      {t && (
        <Link href={`/item/${t.listing.id}`} onClick={() => onClose()} className="mx-4 flex items-center gap-3 rounded-2xl bg-paper p-2 pr-3 transition-colors hover:bg-surface-sunk">
          <span className="w-10 shrink-0 overflow-hidden rounded-lg bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.listing.cover && <img src={t.listing.cover.urls.s} alt="" width={40} height={50} className="size-full object-contain" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{t.listing.title}</span>
          <span className="hang-tag shrink-0 text-xs">{formatPrice(t.listing.price)}</span>
        </Link>
      )}

      <div ref={list} className="flex max-h-[30vh] min-h-16 flex-col gap-1.5 overflow-y-auto overscroll-contain px-4 py-3 md:max-h-56" aria-live="polite">
        {!data
          ? [0, 1].map((i) => <span key={i} className={clsx("skeleton h-8 rounded-2xl", i ? "w-1/2 self-end" : "w-2/3")} />)
          : messages.map((m) => (
              <p
                key={m.id}
                className={clsx(
                  "mini-msg max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[14px] leading-snug",
                  m.mine ? "self-end rounded-br-md bg-accent text-accent-ink" : "self-start rounded-bl-md bg-paper text-ink",
                  m.pending && "opacity-60",
                )}
              >
                {previewOf(m) || "Сообщение"}
              </p>
            ))}
      </div>

      {t && !repliedAlready && !hasDraft && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2">
          {QUICK[t.role].map((q) => (
            <button key={q} type="button" onClick={() => void send(q)} className="chip h-8 shrink-0 px-3 text-[13px]">
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t border-line px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          enterKeyHint="send"
          placeholder={t ? `Ответить @${t.counterpart.username}…` : "Ответить…"}
          aria-label="Ответ"
          // 16px: iOS does not zoom into the field.
          className="h-10 min-w-0 flex-1 rounded-full bg-paper px-4 text-base outline-none placeholder:text-muted focus-visible:ring-3 focus-visible:ring-indigo/20 md:text-[15px]"
        />
        <button
          type="submit"
          disabled={!hasDraft || sending}
          aria-label="Отправить"
          className={clsx(
            "grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] active:scale-90",
            hasDraft ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0",
          )}
        >
          <IconSend className="size-5" />
        </button>
      </form>
    </section>
  );
}
