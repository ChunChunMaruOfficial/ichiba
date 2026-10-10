"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { api } from "./api";
import type { Card } from "./types";

/** ♡ toggle with optimistic UI, undo toast and auth gate (frames 06/08/11). */
export function useFavorite(card: Pick<Card, "id" | "title" | "isFavorite">, source: "feed" | "product" | "search" | "wardrobe" | "swipe" = "feed") {
  const { requireAuth } = useSession();
  const toast = useToast();
  const router = useRouter();
  // Local optimistic value that resets whenever fresh data arrives from the server.
  const [state, setState] = useState({ base: card.isFavorite, value: card.isFavorite });
  if (state.base !== card.isFavorite) setState({ base: card.isFavorite, value: card.isFavorite });
  const isFavorite = state.value;
  const setIsFavorite = useCallback((value: boolean) => setState((s) => ({ ...s, value })), []);

  const set = useCallback(
    async (next: boolean) => {
      setIsFavorite(next);
      try {
        await api(`/favorites/${card.id}`, { method: next ? "POST" : "DELETE", body: next ? { source } : undefined });
        return true;
      } catch {
        setIsFavorite(!next);
        toast("Не удалось сохранить", { tone: "error" });
        return false;
      }
    },
    [card.id, source, toast, setIsFavorite],
  );

  const toggle = useCallback(() => {
    requireAuth(
      async () => {
        const next = !isFavorite;
        if (!(await set(next))) return;
        if (next) toast("Сохранено · сообщим о снижении цены и резерве", { action: { label: "Избранное", onClick: () => router.push("/favorites") } });
        else toast("Удалено из избранного", { action: { label: "Отменить", onClick: () => void set(true) } });
      },
    );
  }, [requireAuth, isFavorite, set, toast, router, card.title]);

  return { isFavorite, toggle };
}

interface Page {
  items: Card[];
  total: number;
}

/** Paged list with "load more on scroll" (pages of 24, frames 06/07). */
export function useInfiniteCards<P extends Page>(keyFor: (offset: number) => string | null, pageSize = 24) {
  const swr = useSWRInfinite<P>((index, prev) => {
    if (prev && prev.items.length < pageSize) return null;
    return keyFor(index * pageSize);
  });
  const pages = swr.data ?? [];
  const items = pages.flatMap((p) => p.items);
  const total = pages[0]?.total ?? 0;
  const done = pages.length > 0 && (pages[pages.length - 1].items.length < pageSize || items.length >= total);
  const loadingMore = swr.isValidating && swr.size > pages.length;
  return { ...swr, pages, items, total, done, loadingMore, loadMore: () => !done && !swr.isValidating && swr.setSize(swr.size + 1) };
}

/** Calls `onHit` when the sentinel scrolls near the viewport. */
export function useSentinel(onHit: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onHit);
  useEffect(() => {
    cb.current = onHit;
  });
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && cb.current(), { rootMargin: "800px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}
