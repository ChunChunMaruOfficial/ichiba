"use client";

import { UmeBranch } from "./shop/ume-branch";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { CONDITION_LABEL, formatPrice } from "@/lib/labels";
import type { Card } from "@/lib/types";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Button, EmptyState, IconHeart, IconX, Spinner } from "./ui";

/** Distance (px) or flick speed (px/ms) that commits a swipe. */
const THRESHOLD = 100;
const FLICK_SPEED = 0.6;
const FLY_MS = 320;
const STACK = 3;

const GUEST_SKIPS = "ichiba:guest-skips";
const readSkips = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(GUEST_SKIPS) ?? "[]");
  } catch {
    return [];
  }
};
const writeSkips = (ids: string[]) => {
  try {
    localStorage.setItem(GUEST_SKIPS, JSON.stringify(ids.slice(-300)));
  } catch {}
};

type Dir = "left" | "right";

/** Fits the deck between its top edge and the bottom of the viewport (minus the mobile bottom nav). */
function useFitHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const top = ref.current.getBoundingClientRect().top + window.scrollY;
      // Room for the bottom tabs when they are shown (not in the immersive swipe mode).
      const nav = document.querySelector<HTMLElement>('[data-chrome="bottom-nav"]');
      const reserve = nav && nav.offsetParent !== null ? nav.offsetHeight + 16 : 28;
      setHeight(Math.max(420, window.innerHeight - top - reserve));
    };
    measure();
    // The page switches immersive mode on after this mounts: measure again once that has applied.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, height };
}

/**
 * Tinder-style deck (decision D2). Drag or flick the top card, or use the buttons / ← → / Backspace.
 * Right = ♡ (asks guests to sign in), left = "не моё", ↶ brings the last card back.
 */
export function SwipeDeck({ context, limit = 20, onSwipe, onDone }: { context: "onboarding" | "swipe_mode"; limit?: number; onSwipe?: (count: number) => void; onDone?: () => void }) {
  const { me, requireAuth, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [skips] = useState(() => (typeof window === "undefined" ? [] : readSkips()));
  const deckKey = `/swipe/deck?context=${context}&limit=${limit}${!me && skips.length ? `&skip=${skips.join(",")}` : ""}`;
  const { data, mutate, isLoading } = useSWR<{ items: Card[] }>(deckKey, { revalidateOnFocus: false });

  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Array<{ card: Card; dir: Dir }>>([]);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<Dir | null>(null);
  const [returning, setReturning] = useState<Dir | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const last = useRef<{ x: number; t: number }>({ x: 0, t: 0 });
  const { ref: frame, height } = useFitHeight();

  const cards = data?.items ?? [];
  const top = cards[index];

  const commit = useCallback(
    (dir: Dir) => {
      if (!top || flying) return;
      // ♡ is personal: a guest is asked to sign in first; the card stays until they do.
      if (dir === "right" && !me) {
        setDrag({ x: 0, y: 0 });
        requireAuth(
          async () => {
            await api("/swipe", { body: { listingId: top.id, direction: "right", context } }).catch(() => {});
            void refresh();
            toast("Сохранено в избранное");
            setHistory((h) => [...h, { card: top, dir }]);
            setIndex((i) => i + 1);
          },
          { reason: `чтобы сохранить «${top.title}»` },
        );
        return;
      }
      setFlying(dir);
      if (me) api("/swipe", { body: { listingId: top.id, direction: dir, context } }).catch(() => toast("Не удалось сохранить", { tone: "error" }));
      else writeSkips([...readSkips(), top.id]);
      window.setTimeout(() => {
        setHistory((h) => [...h, { card: top, dir }]);
        setIndex((i) => i + 1);
        setFlying(null);
        setDrag({ x: 0, y: 0 });
        onSwipe?.(history.length + 1);
      }, FLY_MS);
    },
    [top, flying, me, requireAuth, context, refresh, toast, onSwipe, history.length],
  );

  const undo = useCallback(async () => {
    const prev = history.at(-1);
    if (!prev || flying) return;
    setHistory((h) => h.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    // The card slides back in from the side it left.
    setReturning(prev.dir);
    requestAnimationFrame(() => requestAnimationFrame(() => setReturning(null)));
    if (me) await api("/swipe/last", { method: "DELETE" }).catch(() => {});
    else writeSkips(readSkips().filter((id) => id !== prev.card.id));
  }, [history, flying, me]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [role=dialog]")) return;
      if (e.key === "ArrowRight") commit("right");
      if (e.key === "ArrowLeft") commit("left");
      if (e.key === "Backspace") void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo]);

  useEffect(() => {
    if (data && cards.length > 0 && index >= cards.length) onDone?.();
  }, [index, cards.length, data, onDone]);

  if (isLoading || !data) {
    return (
      <div ref={frame} className="flex items-center justify-center text-muted" style={{ height: height ?? 480 }}>
        <Spinner />
      </div>
    );
  }
  if (!top) {
    return (
      <div ref={frame}>
        <EmptyState art={<UmeBranch className="mb-2 w-56" />} title={cards.length ? "Вы посмотрели все вещи" : "Пока нечего показать"} hint="Новые вещи появляются каждый день">
          <Button
            variant="secondary"
            onClick={() => {
              setIndex(0);
              setHistory([]);
              void mutate();
            }}
          >
            Показать ещё
          </Button>
          {me && <Button onClick={() => router.push("/favorites")}>Открыть избранное</Button>}
        </EmptyState>
      </div>
    );
  }

  // Top-card pose: following the pointer, flying off, or sliding back after undo.
  const width = typeof window === "undefined" ? 400 : Math.min(window.innerWidth, 520);
  const off = width * 1.4;
  const x = flying ? (flying === "right" ? off : -off) : returning ? (returning === "right" ? off : -off) : drag.x;
  const y = flying || returning ? drag.y * 0.5 : drag.y * 0.25;
  const rotate = flying || returning ? (x > 0 ? 18 : -18) : drag.x / 14;
  const progress = Math.min(1, Math.abs(x) / THRESHOLD);
  const intent: Dir | null = x > 24 ? "right" : x < -24 ? "left" : null;

  const visible = cards.slice(index, index + STACK);

  return (
    <div ref={frame} className="mx-auto flex w-full max-w-[520px] flex-col items-center" style={{ height: height ?? undefined }}>
      {/* Portrait card: width follows the available height so photos are never cropped to a strip. */}
      <div className="relative min-h-0 w-full flex-1">
        <div className="relative mx-auto h-full max-w-full" style={{ aspectRatio: "3 / 4.3" }}>
        {visible
          .map((card, depth) => {
            const isTop = depth === 0;
            // Cards behind grow toward full size as the top one moves away.
            const lift = isTop ? 0 : Math.max(0, depth - progress);
            const scale = 1 - lift * 0.05;
            const shiftY = lift * 14;
            return (
              <article
                key={card.id}
                aria-hidden={!isTop}
                aria-label={isTop ? `${card.title}, ${formatPrice(card.price)}` : undefined}
                className={clsx(
                  "absolute inset-0 mx-auto flex flex-col overflow-hidden rounded-[28px] bg-surface shadow-[0_18px_40px_-18px_rgb(28_26_23/0.45)] will-change-transform",
                  isTop ? "z-20 cursor-grab touch-none select-none active:cursor-grabbing" : depth === 1 ? "z-10" : "z-0",
                  (!isTop || !dragging) && "transition-transform ease-out",
                )}
                style={{
                  transitionDuration: isTop && returning === null && flying === null && !dragging ? "260ms" : `${FLY_MS}ms`,
                  transform: isTop ? `translate(${x}px, ${y}px) rotate(${rotate}deg)` : `translateY(${shiftY}px) scale(${scale})`,
                  opacity: isTop ? 1 : depth === STACK - 1 ? progress : 1,
                }}
                onPointerDown={
                  isTop
                    ? (e) => {
                        if ((e.target as HTMLElement).closest("button, a")) return;
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
                        last.current = { x: e.clientX, t: performance.now() };
                        setDragging(true);
                      }
                    : undefined
                }
                onPointerMove={
                  isTop
                    ? (e) => {
                        if (!start.current) return;
                        setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
                        last.current = { x: e.clientX, t: performance.now() };
                      }
                    : undefined
                }
                onPointerUp={
                  isTop
                    ? (e) => {
                        if (!start.current) return;
                        const dt = Math.max(1, performance.now() - last.current.t + 16);
                        const speed = (e.clientX - last.current.x) / dt;
                        const moved = Math.abs(drag.x) + Math.abs(drag.y);
                        start.current = null;
                        setDragging(false);
                        if (drag.x > THRESHOLD || (drag.x > 30 && speed > FLICK_SPEED)) commit("right");
                        else if (drag.x < -THRESHOLD || (drag.x < -30 && speed < -FLICK_SPEED)) commit("left");
                        else {
                          setDrag({ x: 0, y: 0 });
                          if (moved < 6) router.push(`/item/${card.id}`);
                        }
                      }
                    : undefined
                }
                onPointerCancel={() => {
                  start.current = null;
                  setDragging(false);
                  setDrag({ x: 0, y: 0 });
                }}
              >
                <div className="relative min-h-0 flex-1 bg-skeleton">
                  {card.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.cover.urls.l} alt={isTop ? card.title : ""} draggable={false} className="pointer-events-none absolute inset-0 size-full object-cover" />
                  )}
                  {isTop && (
                    <>
                      {/* Tint + stamp show what letting go will do. */}
                      <div className={clsx("pointer-events-none absolute inset-0 transition-colors", intent === "right" ? "bg-heart" : intent === "left" ? "bg-ink" : "bg-transparent")} style={{ opacity: intent ? progress * 0.18 : 0 }} />
                      <span
                        className="pointer-events-none absolute left-5 top-5 -rotate-12 rounded-xl border-[3px] border-heart bg-surface/85 px-3 py-1 text-lg font-bold text-heart"
                        style={{ opacity: intent === "right" ? progress : 0 }}
                      >
                        ♡ Нравится
                      </span>
                      <span
                        className="pointer-events-none absolute right-5 top-5 rotate-12 rounded-xl border-[3px] border-ink bg-surface/85 px-3 py-1 text-lg font-bold text-ink"
                        style={{ opacity: intent === "left" ? progress : 0 }}
                      >
                        Не моё
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-end justify-between gap-3 px-5 pb-4 pt-3">
                  <div className="min-w-0">
                    <p className="tabular text-2xl font-semibold leading-tight">{formatPrice(card.price)}</p>
                    <p className="truncate text-[15px]">{card.title}</p>
                    <p className="truncate text-sm text-muted">{[card.size, card.condition && CONDITION_LABEL[card.condition], `@${card.seller.username}`].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
              </article>
            );
          })
          .reverse()}
        </div>
      </div>

      <div className="mt-5 flex shrink-0 items-center justify-center gap-5">
        <button aria-label="Вернуть предыдущую" title="Вернуть (Backspace)" disabled={!history.length} onClick={() => void undo()} className="grid size-11 place-items-center rounded-full bg-surface text-xl text-ink-2 shadow-sm transition hover:scale-105 disabled:opacity-30 disabled:hover:scale-100">
          ↶
        </button>
        <button aria-label="Не моё" title="Не моё (←)" onClick={() => commit("left")} className={clsx("grid size-16 place-items-center rounded-full bg-surface shadow-md transition hover:scale-105", intent === "left" && "scale-110 bg-ink text-accent-ink")}>
          <IconX className="size-7" />
        </button>
        <button aria-label="Нравится" title="Нравится (→)" onClick={() => commit("right")} className={clsx("grid size-16 place-items-center rounded-full bg-surface text-heart shadow-md transition hover:scale-105", intent === "right" && "scale-110 bg-heart text-on-danger")}>
          <IconHeart className="size-7" filled />
        </button>
{context === "swipe_mode" && top.status === "PUBLISHED" && me?.id !== top.seller.id && (
          <button
            onClick={() => requireAuth(() => router.push(`/buy/${top.id}`), { reason: `чтобы купить «${top.title}»` })}
            className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink shadow-sm transition hover:scale-105 hover:bg-accent-hover"
          >
            Купить
          </button>
        )}
      </div>
    </div>
  );
}
