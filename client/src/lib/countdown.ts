"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
/**
 * false while React hydrates server HTML, true afterwards (and straight away on a client-only render). The server
 * and the browser read the clock at different moments, so anything computed from "now" is rendered only once this
 * is true: otherwise the first client render differs from the HTML (a hydration mismatch).
 */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** Shown in place of a live time until the page is hydrated: same on the server and in the first client render. */
export const TIME_PLACEHOLDER = "—";

/**
 * Live time left until `endsAt`; ticks every second in the last hour, every 30 s before that. Until hydration the
 * timer is not running yet (`ready` false): the label is a placeholder and the auction counts as neither urgent nor
 * over, identically on the server and the client.
 */
export function useCountdown(endsAt: string | null | undefined) {
  const ready = useHydrated();
  const [now, setNow] = useState(() => Date.now());
  const end = endsAt ? new Date(endsAt).getTime() : 0;
  const left = Math.max(0, end - now);
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), left < 3600_000 ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [endsAt, left < 3600_000]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return { ready, left: null, label: TIME_PLACEHOLDER, urgent: false, over: false };
  return { ready, left, label: formatLeft(left), urgent: left > 0 && left < 3600_000, over: !!endsAt && left === 0 };
}

function formatLeft(ms: number) {
  if (ms <= 0) return "завершён";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
