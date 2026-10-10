"use client";

import clsx from "clsx";
import { memo } from "react";
import { LocationBubble } from "@/components/chat-location";
import type { ChatMedia, ChatMessage, ChatQuote } from "@/lib/types";
import { IconPlay, IconReply, IconRetry, Ticks } from "./icons";
import { useMessageGestures } from "./gestures";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export interface BubbleProps {
  m: ChatMessage;
  /** The other side read up to here (two ticks). */
  read: boolean;
  counterpart: string;
  selecting: boolean;
  selected: boolean;
  menuOpen: boolean;
  onMenu: (m: ChatMessage, at: { point?: { x: number; y: number }; rect?: DOMRect; el?: HTMLElement; touch: boolean }) => void;
  onReply: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onToggleSelect: (m: ChatMessage) => void;
  onJump: (id: string) => void;
  onOpenMedia: (m: ChatMessage, index: number) => void;
  onOpenLocation: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
}

/** One message: swipe right to reply, hold (or right click) for the menu, double tap for ❤️. */
export const MessageBubble = memo(function MessageBubble(p: BubbleProps) {
  const { m } = p;
  const outbox = m.pending || m.failed;
  const hasMedia = !!m.media?.length;
  const { target, hint, handlers } = useMessageGestures({
    disabled: p.selecting || !!outbox,
    onLongPress: () => {
      const el = target.current?.querySelector<HTMLElement>("[data-bubble]") ?? undefined;
      p.onMenu(m, { el, rect: el?.getBoundingClientRect(), touch: true });
    },
    onSwipeReply: () => p.onReply(m),
    onDoubleTap: hasMedia || m.location ? undefined : () => p.onReact(m, "❤️"),
    onContextMenu: (point) => p.onMenu(m, { point, touch: false }),
  });

  const meta = (
    <>
      {m.editedAt && <span>изменено</span>}
      <time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>
      {m.mine && !outbox && <Ticks read={p.read} />}
      {m.pending && !m.failed && <ClockIcon />}
    </>
  );
  const onlyMedia = hasMedia && !m.body;

  return (
    <div
      data-mid={m.id}
      className={clsx("group/msg relative flex touch-pan-y items-end gap-2 rounded-xl py-0.5", p.selecting && "cursor-pointer", p.selected && "bg-accent-soft/70")}
      onClick={p.selecting ? () => p.onToggleSelect(m) : undefined}
      {...handlers}
    >
      {/* Swipe-to-reply arrow, revealed behind the message. */}
      <div ref={hint} aria-hidden className="pointer-events-none absolute left-1 top-1/2 -mt-4 grid size-8 place-items-center rounded-full bg-ink/10 text-ink opacity-0">
        <IconReply className="size-4" />
      </div>
      {p.selecting && (
        <span
          aria-hidden
          className={clsx("mb-2 ml-1 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors", p.selected ? "border-accent bg-accent text-accent-ink" : "border-line-control")}
        >
          {p.selected && <Ticks read={false} className="h-2.5 w-3" />}
        </span>
      )}
      <div ref={target} className={clsx("flex min-w-0 flex-1 flex-col", m.mine ? "items-end" : "items-start")}>
        <div className={clsx("flex max-w-[85%] items-center gap-1.5 sm:max-w-[70%]", m.mine ? "flex-row-reverse" : "flex-row")}>
          <div
            data-bubble
            className={clsx(
              "relative min-w-0 overflow-hidden rounded-2xl text-[15px] leading-snug transition-[box-shadow,transform] duration-150",
              m.mine ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line)]",
              // On touch screens a held message must not start a text selection or the iOS callout.
              "pointer-coarse:select-none [-webkit-touch-callout:none]",
              // On phones the menu shows a lifted copy of the message, so the original hides meanwhile.
              p.menuOpen && "z-[71] scale-[1.02] shadow-[var(--shadow-float)] pointer-coarse:invisible",
              outbox && !m.failed && "opacity-70",
              (hasMedia || m.location) && "p-1",
            )}
          >
            {m.replyTo && <Quote q={m.replyTo} mine={m.mine} counterpart={p.counterpart} onJump={p.onJump} inset={hasMedia || !!m.location} />}
            {m.location ? (
              <LocationBubble embedded location={m.location} mine={m.mine} time={meta} onOpen={() => !p.selecting && p.onOpenLocation(m)} />
            ) : (
              <>
                {hasMedia && <Album media={m.media!} mine={m.mine} progress={m.pending ? m.progress : undefined} onOpen={(i) => !p.selecting && !outbox && p.onOpenMedia(m, i)} meta={onlyMedia ? meta : null} />}
                {!onlyMedia && (
                  <div className={clsx(hasMedia ? "px-2.5 pb-1 pt-1.5" : "px-3.5 py-2")}>
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {m.body}
                      {/* Room for the time on the last line, as in Telegram. */}
                      <span aria-hidden className="invisible inline-flex pl-2 text-[11px]">
                        {m.editedAt && "изменено "}
                        00:00{m.mine && " ✓✓"}
                      </span>
                    </p>
                    <p className={clsx("-mt-4 flex items-center justify-end gap-1 text-[11px] leading-4", m.mine ? "text-accent-ink/60" : "text-muted")}>{meta}</p>
                  </div>
                )}
              </>
            )}
            {!!m.reactions?.length && (
              <div className={clsx("flex flex-wrap gap-1 pb-2", hasMedia || m.location ? "px-1.5 pt-1" : "-mt-0.5 px-3")}>
                {m.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    aria-pressed={r.mine}
                    aria-label={`${r.emoji} ${r.count}${r.mine ? ", ваша реакция" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!p.selecting) p.onReact(m, r.emoji);
                    }}
                    className={clsx(
                      "pop inline-flex h-7 items-center gap-1 rounded-full px-2 text-sm transition-colors",
                      m.mine ? (r.mine ? "bg-accent-ink text-accent" : "bg-accent-ink/15") : r.mine ? "bg-accent text-accent-ink" : "bg-ink/5",
                    )}
                  >
                    <span className="text-base leading-none">{r.emoji}</span>
                    {r.count > 1 && <span className="tabular text-xs font-semibold">{r.count}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Desktop: quick reply on hover, like Telegram Web. */}
          {!p.selecting && !outbox && (
            <button
              type="button"
              aria-label="Ответить"
              title="Ответить"
              onClick={() => p.onReply(m)}
              className="hidden size-8 shrink-0 place-items-center rounded-full text-muted opacity-0 transition-opacity hover:bg-ink/5 hover:text-ink focus-visible:opacity-100 group-hover/msg:opacity-100 pointer-fine:grid"
            >
              <IconReply className="size-4" />
            </button>
          )}
        </div>
        {m.failed && (
          <div className="mt-1 flex items-center gap-3 text-xs">
            <span className="text-danger">Не отправлено</span>
            <button type="button" onClick={() => p.onRetry(m)} className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-2 hover:underline">
              <IconRetry className="size-3.5" /> Повторить
            </button>
            <button type="button" onClick={() => p.onDiscard(m)} className="text-muted hover:text-ink">
              Удалить
            </button>
          </div>
        )}
        {!m.mine && m.risk && (
          <p
            role="alert"
            className={clsx("mt-1 flex max-w-[85%] items-start gap-1.5 rounded-xl px-3 py-2 text-xs leading-snug sm:max-w-[70%]", m.risk.level === "high" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}
          >
            <span aria-hidden className="font-bold">!</span>
            <span>
              {m.risk.level === "high" && <b className="font-semibold">Похоже на мошенничество. </b>}
              {m.risk.text}
            </span>
          </p>
        )}
      </div>
    </div>
  );
});

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-label="Отправляется">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}

/** The quoted message above a reply; tap jumps to it. */
function Quote({ q, mine, counterpart, onJump, inset }: { q: ChatQuote; mine: boolean; counterpart: string; onJump?: (id: string) => void; inset?: boolean }) {
  return (
    <button
      type="button"
      disabled={q.deleted || !onJump}
      onClick={(e) => {
        e.stopPropagation();
        onJump?.(q.id);
      }}
      className={clsx(
        "flex w-[calc(100%-1rem)] min-w-40 items-center gap-2 rounded-lg border-l-[3px] py-1 pl-2 pr-2.5 text-left text-[13px] leading-tight",
        inset ? "mx-1 mb-1 mt-1 w-[calc(100%-0.5rem)]" : "mx-2 mt-2",
        mine ? "border-accent-ink/60 bg-accent-ink/10" : "border-shu bg-shu/[0.07]",
      )}
    >
      {q.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.thumb} alt="" width={32} height={32} className="size-8 shrink-0 rounded object-cover" />
      )}
      <span className="min-w-0">
        <span className={clsx("block truncate font-semibold", mine ? "text-accent-ink" : "text-shu")}>{q.mine ? "Вы" : `@${counterpart}`}</span>
        <span className={clsx("block truncate", q.deleted && "italic", mine ? "text-accent-ink/80" : "text-ink-2")}>{q.text}</span>
      </span>
    </button>
  );
}

/** Photos and videos as a Telegram-like album: one big tile, or a grid. */
function Album({ media, mine, progress, onOpen, meta }: { media: ChatMedia[]; mine: boolean; progress?: number; onOpen: (i: number) => void; meta: React.ReactNode }) {
  const one = media.length === 1;
  const first = media[0];
  // A single tile keeps its proportions within 4:5 … 16:9.
  const ratio = one ? Math.min(16 / 9, Math.max(4 / 5, first.width / Math.max(1, first.height))) : 1;
  return (
    <div className="relative">
      <div className={clsx("grid gap-0.5 overflow-hidden rounded-xl", one ? "w-[min(300px,70vw)]" : "w-[min(320px,72vw)] grid-cols-6")} style={one ? { aspectRatio: ratio } : undefined}>
        {media.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(i);
            }}
            aria-label={item.type === "video" ? "Открыть видео" : "Открыть фото"}
            className={clsx("relative block size-full overflow-hidden bg-skeleton", !one && tileClass(media.length, i))}
          >
            {item.type === "photo" ? (
              // An outbox tile has no picture yet when the browser can't draw the local file (HEIC).
              (one ? item.urls.m : item.urls.s) &&
              // eslint-disable-next-line @next/next/no-img-element
              <img src={one ? item.urls.m : item.urls.s} alt="" width={item.width} height={item.height} loading="lazy" draggable={false} className="size-full object-cover" />
            ) : item.poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.poster} alt="" width={item.width} height={item.height} loading="lazy" draggable={false} className="size-full object-cover" />
            ) : (
              item.url && <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" />
            )}
            {item.type === "video" && (
              <>
                <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                  <IconPlay className="ml-0.5 size-5" />
                </span>
                {item.durationMs > 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[11px] text-white">{duration(item.durationMs)}</span>}
              </>
            )}
          </button>
        ))}
      </div>
      {progress != null && progress < 1 && (
        <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-label="Загрузка">
          <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${Math.max(0.04, progress) * 94.2} 94.2`} strokeLinecap="round" />
          </svg>
        </span>
      )}
      {meta && <span className={clsx("pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[11px] text-white", mine && "")}>{meta}</span>}
    </div>
  );
}

/** Grid spans on a 6-column grid: 2 → halves, 3 → one wide + two, 4 → 2×2, then rows of three. */
function tileClass(n: number, i: number) {
  if (n === 2) return "col-span-3 aspect-[3/4]";
  if (n === 3) return i === 0 ? "col-span-6 aspect-[16/10]" : "col-span-3 aspect-square";
  if (n === 4) return "col-span-3 aspect-square";
  const rest = n % 3;
  // Leftovers on the first row: one wide tile, or two halves.
  if (rest === 1 && i === 0) return "col-span-6 aspect-[16/10]";
  if (rest === 2 && i < 2) return "col-span-3 aspect-square";
  return "col-span-2 aspect-square";
}
