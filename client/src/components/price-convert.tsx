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
          // Always beside the tag, never over the text under it. Up to tablets (a phone, or the narrow price column of a
          // tablet) there is little room to the right, so the tags stack two over one, about as tall as the price
          // itself; only wide screens fan them out in a row. A row there once ran past the screen edge at 768px.
          // On paper, so a struck-out old price beside the tag doesn't show through the gaps.
          "bg-washi pointer-events-none absolute left-full top-1/2 z-10 ml-1.5 grid -translate-y-1/2 grid-cols-[auto_auto] items-center gap-1 rounded-lg p-1 transition-opacity duration-200 sm:ml-2 lg:flex lg:gap-1.5",
          !open && "invisible opacity-0",
        )}>
        {rows.map((r, i) => (
          <span
            key={r}
            className={clsx(
              "whitespace-nowrap rounded-md bg-kraft px-1.5 py-0.5 text-center text-[12px] font-semibold tabular text-kraft-ink shadow-[0_2px_6px_-2px_rgb(0_0_0/0.25)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] sm:px-2 sm:py-1 sm:text-[13px]",
              // Roubles are the longest: stacked, they take the whole second row.
              i === 2 && "col-span-2 lg:col-span-1",
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
