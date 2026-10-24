"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Quiet signals for «Для вас» (server/src/recommendations): how long an item page was looked at, and which cards a
 * feed showed. Sent as the page is left (sendBeacon survives navigation and closing the tab); only for a signed-in
 * person — the callers decide. Nothing here is shown to anyone; see /privacy.
 */

function beacon(path: string, body: unknown) {
  const url = `/api${path}`;
  const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
  try {
    if (navigator.sendBeacon?.(url, blob)) return;
  } catch {
    /* falls through to fetch */
  }
  void fetch(url, { method: "POST", body: blob, credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
}

/**
 * Time on an item page (only while the tab is visible) and how many of its photos were looked at, reported once
 * when the page is left. `photo` is the gallery's current index.
 */
export function useItemEngagement(id: string, enabled: boolean, photo: number) {
  const photos = useRef(new Set<number>());
  useEffect(() => {
    photos.current.add(photo);
  }, [photo]);

  useEffect(() => {
    if (!enabled) return;
    photos.current = new Set([0]);
    let shown = 0;
    let since = document.visibilityState === "visible" ? performance.now() : null;
    let sent = false;
    const pause = () => {
      if (since != null) shown += performance.now() - since;
      since = null;
    };
    const send = () => {
      if (sent) return;
      sent = true;
      pause();
      beacon(`/listings/${id}/engagement`, { ms: Math.round(shown), photos: photos.current.size });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") since ??= performance.now();
      else pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      send();
    };
  }, [id, enabled]);
}

// ---------- impressions ----------

/** A card counts as shown after being at least half on screen for this long. */
const SEEN_MS = 1000;
/** One showing per item per half hour: scrolling up and down a feed is one look, not ten. */
const REPEAT_MS = 30 * 60_000;
const reported = new Map<string, number>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
const pending = new Map<Element, { id: string; timer: ReturnType<typeof setTimeout> | null }>();

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  for (let i = 0; i < queue.length; i += 100) beacon("/feed/impressions", { ids: queue.slice(i, i + 100) });
  queue = [];
}

function seen(id: string) {
  const at = reported.get(id);
  if (at && Date.now() - at < REPEAT_MS) return;
  reported.set(id, Date.now());
  queue.push(id);
  timer ??= setTimeout(flush, 5000);
}

function watch(): IntersectionObserver {
  if (observer) return observer;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = pending.get(e.target);
        if (!p) continue;
        if (e.isIntersecting) p.timer ??= setTimeout(() => seen(p.id), SEEN_MS);
        else if (p.timer) {
          clearTimeout(p.timer);
          p.timer = null;
        }
      }
    },
    { threshold: 0.5 },
  );
  return observer;
}

/** A ref for a feed card: the card is reported as shown once it has been on screen for a moment. `null` = don't. */
export function useImpression(id: string | null) {
  const el = useRef<Element | null>(null);
  return useCallback(
    (node: Element | null) => {
      if (el.current) {
        const p = pending.get(el.current);
        if (p?.timer) clearTimeout(p.timer);
        pending.delete(el.current);
        observer?.unobserve(el.current);
      }
      el.current = node;
      if (!node || !id || typeof IntersectionObserver === "undefined") return;
      pending.set(node, { id, timer: null });
      watch().observe(node);
    },
    [id],
  );
}
