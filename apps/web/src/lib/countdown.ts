"use client";

import { useEffect, useState } from "react";

/** Live time left until `endsAt`; ticks every second in the last hour, every 30 s before that. */
export function useCountdown(endsAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const end = endsAt ? new Date(endsAt).getTime() : 0;
  const left = Math.max(0, end - now);
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), left < 3600_000 ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [endsAt, left < 3600_000]); // eslint-disable-line react-hooks/exhaustive-deps
  return { left, label: formatLeft(left), urgent: left > 0 && left < 3600_000, over: !!endsAt && left === 0 };
}

export function formatLeft(ms: number) {
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
