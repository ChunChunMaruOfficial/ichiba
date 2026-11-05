"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

/** «1 вещь», «2 вещи», «5 вещей». */
export const thingsWord = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? "вещь" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "вещи" : "вещей";
};

const DURATION = 1800;
/** Fast at first, then settling: the last digits tick into place. */
const ease = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

/**
 * A number that rolls up to its value the first time it scrolls into view, and rolls from the old value to the new
 * one whenever it changes. Without motion (prefers-reduced-motion) it just shows the value.
 */
function useRollingNumber(target: number | undefined, ref: React.RefObject<HTMLElement | null>) {
  const [shown, setShown] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const from = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    // Browsers without the observer get the number at once, from the next frame.
    if (!("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(frame);
    }
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setSeen(true), io.disconnect()), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);

  useEffect(() => {
    if (target == null || !seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      const frame = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    const base = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      const value = Math.round(base + (target - base) * ease(p));
      setShown(value);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = Math.round(base + (target - base) * ease(Math.min(1, (performance.now() - start) / DURATION)));
    };
  }, [target, seen]);

  return shown;
}

/**
 * How many things are on sale on the whole site right now, in the footer in place of a call to sell: the number is
 * one a minute old at most (GET /count) and rolls when it changes. The label and the number only: no caption.
 */
export function LiveCount({ className }: { className?: string }) {
  const { data } = useSWR<{ total: number }>("/count", { refreshInterval: 60_000, revalidateOnFocus: true });
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRollingNumber(data?.total, ref);
  return (
    <div className={className}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Сейчас на ichiba</p>
      <p className="mt-2 flex items-baseline gap-x-2.5" aria-live="polite" aria-atomic>
        <span ref={ref} className="tabular font-display text-5xl font-bold leading-none tracking-tight text-ink md:text-6xl">
          {shown == null ? <span className="text-muted/60">···</span> : shown.toLocaleString("ru-RU")}
        </span>
        <span className="text-[15px] text-ink-2">{thingsWord(shown ?? 0)}</span>
      </p>
    </div>
  );
}
