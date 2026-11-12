"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { IconPushpin, IconSend, IconUnpin } from "@/components/chat/icons";
import { RequireAuth } from "@/components/require-auth";
import { useSession } from "@/components/session";
import { AssistantSeal } from "@/components/thread-list";
import { ErrorState, IconChevronLeft, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import type { AssistantButton, AssistantMessage } from "@/lib/types";

export default function AssistantPage() {
  return <RequireAuth reason="чтобы написать помощнику">{() => <AssistantChat />}</RequireAuth>;
}

const CHAT_COLUMN = "relative flex min-h-0 flex-col lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line";
type Page = { messages: AssistantMessage[]; hasMore: boolean };
type Reply = { messages: AssistantMessage[] };
const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/**
 * The «Ichiba» chat: the assistant that answers about the platform and does things on the account. Text only; under
 * its messages there are buttons, as in a Telegram bot — «Отменить» after everything it changed, «Сделать / Отмена»
 * before what can't be put back, links to pages. Whatever it changes, the rest of the site re-reads.
 */
function AssistantChat() {
  const router = useRouter();
  const { refresh } = useSession();
  const { prefs, set } = usePrefs();
  const { mutate: mutateAll } = useSWRConfig();
  const { data, error, mutate } = useSWR<Page>("/assistant", { revalidateOnFocus: false });
  const [older, setOlder] = useState<AssistantMessage[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const messages = [...older, ...(data?.messages ?? [])];
  const count = messages.length + (pending ? 1 : 0) + (busy ? 1 : 0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  // Opening the chat reads it: the dot in the list of chats goes.
  useEffect(() => {
    if (data) void mutateAll("/assistant/summary");
  }, [data, mutateAll]);

  /** After the assistant did something: its messages, and everything on the site that shows what it may have changed. */
  const settle = useCallback(
    async (reply: Reply) => {
      await mutate((cur) => (cur ? { ...cur, messages: [...cur.messages, ...reply.messages.filter((m) => !cur.messages.some((x) => x.id === m.id))] } : cur), { revalidate: true });
      void refresh();
      void mutateAll((key) => typeof key === "string" && key !== "/assistant" && /^\/(assistant|wardrobes|stats|requests|offers|favorites|cart|threads|following)/.test(key));
    },
    [mutate, mutateAll, refresh],
  );

  const run = useCallback(
    async (call: () => Promise<Reply>, echo?: string) => {
      if (busy) return;
      setBusy(true);
      setFailed(null);
      if (echo) setPending(echo);
      try {
        await settle(await call());
      } catch (e) {
        setFailed(e instanceof ApiError && e.status === 429 ? "Вы достигли лимита сообщений. Попробуйте через минуту." : "Не отправилось — проверьте связь и попробуйте ещё раз");
        if (echo) setDraft((d) => d || echo);
      } finally {
        setPending(null);
        setBusy(false);
      }
    },
    [busy, settle],
  );

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void run(() => api<Reply>("/assistant/messages", { method: "POST", body: { text } }), text);
  };
  const press = (b: AssistantButton) => {
    if (b.kind === "link" && b.path) return router.push(b.path);
    void run(() => api<Reply>("/assistant/press", { method: "POST", body: { id: b.id } }));
  };
  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const page = await api<Page>(`/assistant?before=${encodeURIComponent(first.createdAt)}`);
    setOlder((cur) => [...page.messages, ...cur]);
    setHasOlder(page.hasMore);
  };

  if (error) {
    return (
      <div className={`${CHAT_COLUMN} justify-center`}>
        <ErrorState message="Не удалось открыть чат" onRetry={() => mutate()} />
      </div>
    );
  }
  const pinned = prefs.assistantPinned;
  return (
    <div className={CHAT_COLUMN}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/messages" aria-label="Все сообщения" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-ink/5 lg:hidden">
          <IconChevronLeft />
        </Link>
        <AssistantSeal className="size-11 text-2xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">Ichiba</p>
          <p className="truncate text-sm text-ink-2">{busy ? <span className="text-shu">думает…</span> : "Помощник площадки"}</p>
        </div>
        <button
          type="button"
          onClick={() => void set({ assistantPinned: !pinned })}
          aria-pressed={pinned}
          title={pinned ? "Открепить чат" : "Закрепить чат наверху"}
          className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-ink/5"
        >
          {pinned ? <IconUnpin className="size-5" /> : <IconPushpin className="size-5" />}
          <span className="max-sm:sr-only">{pinned ? "Открепить" : "Закрепить"}</span>
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4" aria-live="polite">
        {!data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
            <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {(hasOlder ?? data.hasMore) && (
              <li className="self-center">
                <button type="button" onClick={() => void loadOlder()} className="rounded-full bg-ink/5 px-3 py-1 text-xs text-muted hover:bg-ink/10">
                  Показать раньше
                </button>
              </li>
            )}
            {messages.map((m) => (
              <li key={m.id} className={clsx("flex flex-col", m.fromBot ? "items-start" : "items-end")}>
                {/* The message and its buttons are one block: as wide as the longer of the two, so the keyboard
                    sits exactly under the bubble, as in a Telegram bot. */}
                <div className={clsx("flex w-fit max-w-[85%] flex-col sm:max-w-[70%]", m.fromBot && !!m.buttons?.length && "min-w-48")}>
                  <Bubble mine={!m.fromBot} body={m.body} at={m.id === "welcome" ? null : m.createdAt} />
                  {m.fromBot && !!m.buttons?.length && <Buttons rows={m.buttons} disabled={busy} onPress={press} />}
                </div>
              </li>
            ))}
            {pending && (
              <li className="flex flex-col items-end opacity-70">
                <div className="flex w-fit max-w-[85%] flex-col sm:max-w-[70%]">
                  <Bubble mine body={pending} at={null} />
                </div>
              </li>
            )}
            {busy && (
              <li className="flex items-start">
                <span className="rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 text-muted shadow-[inset_0_0_0_1px_var(--line)]">
                  <span className="sr-only">Помощник думает</span>
                  <span aria-hidden className="inline-flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="size-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${i * 180}ms` }} />
                    ))}
                  </span>
                </span>
              </li>
            )}
          </ol>
        )}
      </div>

      <div className="border-t border-line bg-paper px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2 sm:px-4">
        {failed && (
          <p role="alert" className="mb-2 px-1 text-sm text-danger">
            {failed}
          </p>
        )}
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            Сообщение помощнику
          </label>
          <textarea
            id="assistant-input"
            ref={input}
            rows={1}
            value={draft}
            maxLength={500}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // On phones Enter is a new line; the send button sends.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Что сделать?"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border border-line-strong bg-surface px-4 py-2.5 text-[15px] leading-snug outline-none pointer-coarse:text-base focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-accent/15"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            aria-label="Отправить"
            // Tapping send must not take focus from the field: that would close the phone keyboard.
            onPointerDown={(e) => e.preventDefault()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-opacity hover:bg-accent-hover active:scale-90 disabled:opacity-40"
          >
            <IconSend />
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({ mine, body, at }: { mine: boolean; body: string; at: string | null }) {
  return (
    <div
      className={clsx(
        "rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
        mine ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line)]",
      )}
    >
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{body}</p>
      {at && <p className={clsx("mt-0.5 text-right text-[11px] leading-4", mine ? "text-accent-ink/60" : "text-muted")}>{time(at)}</p>}
    </div>
  );
}

/** The inline keyboard under a bot message: rows of equal buttons; «Отменить» and «Отмена» are quiet, «Сделать» stands out. */
function Buttons({ rows, disabled, onPress }: { rows: AssistantButton[][]; disabled: boolean; onPress: (b: AssistantButton) => void }) {
  return (
    <div className="mt-1.5 flex w-full flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          {row.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={disabled && b.kind === "press"}
              onClick={() => onPress(b)}
              className={clsx(
                "min-h-10 flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
                b.id.startsWith("ok:") ? "bg-accent text-accent-ink hover:bg-accent-hover" : "bg-ink/5 text-ink hover:bg-ink/10",
              )}
            >
              {b.label}
              {b.kind === "link" && <span aria-hidden> ↗</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
