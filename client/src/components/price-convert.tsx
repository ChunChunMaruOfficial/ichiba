"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

interface Rates {
  perByn: { USD: number; EUR: number; RUB: number };
}

const fmt = (v: number, cur: "USD" | "EUR" | "RUB") => {
  // Roubles in tens, the others whole above 10 and with one decimal below.
  const n = cur === "RUB" ? Math.round(v / 10) * 10 : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  const num = n.toLocaleString("ru-RU");
  return cur === "USD" ? `$${num}` : cur === "EUR" ? `€${num}` : `${num} ₽`;
};

/**
 * The price tag with a currency peek: hover (desktop) or tap (phones) and the tag swings on its thread while
 * small tags with the price in dollars, euros and roubles fan out beside it. Rates come from /rates (NBRB).
 */
export function PriceConvert({ byn, children, className }: { byn: number | null; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [swing, setSwing] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const { data } = useSWR<Rates | null>(byn ? "/rates" : null, { revalidateOnFocus: false, dedupingInterval: 3_600_000 });
  const show = (v: boolean) => {
    if (v && !open) setSwing((n) => n + 1);
    setOpen(v);
  };

  // A tap elsewhere closes it on phones.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (!byn || !data) return <span className={className}>{children}</span>;
  const rows = (["USD", "EUR", "RUB"] as const).map((c) => fmt(byn * data.perByn[c], c));

  return (
    <span ref={box} className={clsx("relative inline-flex items-center", className)} onMouseEnter={() => matchMedia("(hover: hover)").matches && show(true)} onMouseLeave={() => matchMedia("(hover: hover)").matches && setOpen(false)}>
      <button type="button" aria-expanded={open} aria-label="Цена в других валютах" onClick={() => show(!open)} className="cursor-pointer text-left">
        <span key={swing} className={clsx("inline-block origin-left", swing > 0 && "tag-swing")}>
          {children}
        </span>
      </button>
      <span role="status" aria-live="polite" className={clsx(
          // Beside the tag on wide screens; under it on phones, where there's no room to the right.
          "pointer-events-none absolute left-0 top-full z-10 mt-3 flex items-center gap-1.5 sm:left-full sm:top-1/2 sm:ml-3 sm:mt-0 sm:-translate-y-1/2",
          !open && "invisible",
        )}>
        {rows.map((r, i) => (
          <span
            key={r}
            className={clsx(
              "whitespace-nowrap rounded-md bg-kraft px-2 py-1 text-[13px] font-semibold tabular text-kraft-ink shadow-[0_2px_6px_-2px_rgb(0_0_0/0.25)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
              open ? "translate-x-0 rotate-0 opacity-100" : "-translate-x-3 -rotate-6 opacity-0",
            )}
            style={{ transitionDelay: open ? `${i * 60}ms` : "0ms" }}
          >
            {r}
          </span>
        ))}
      </span>
    </span>
  );
}
