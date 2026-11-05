"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

/**
 * A drum picker, the way a phone picks a date: the values on a wheel that snaps to the one under the band in the
 * middle, the rows curving away above and below. Scrolled with a finger or the wheel, tapped, or moved with the
 * arrow keys. Each option is a string; the one in the middle is the value.
 */

const ROW = 40;
const ROWS = 5;

export function WheelPicker({ options, value, onChange, label, className }: { options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void; label: string; className?: string }) {
  const list = useRef<HTMLDivElement>(null);
  /** Where the wheel is, in rows (fractional while it moves): the rows are drawn from it. */
  const [pos, setPos] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const frame = useRef(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  // The value set from outside (or at the start): the wheel goes there, unless it is there already.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (Math.round(el.scrollTop / ROW) !== index) el.scrollTop = index * ROW;
  }, [index]);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = list.current;
      if (!el) return;
      const p = el.scrollTop / ROW;
      setPos(p);
      const i = Math.min(options.length - 1, Math.max(0, Math.round(p)));
      if (options[i] && options[i].value !== value) onChange(options[i].value);
    });
  };
  const goTo = (i: number) => list.current?.scrollTo({ top: Math.min(options.length - 1, Math.max(0, i)) * ROW, behavior: "smooth" });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      goTo(index + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      goTo(e.key === "Home" ? 0 : options.length - 1);
    }
  };

  return (
    <div className={clsx("relative select-none", className)} style={{ height: ROW * ROWS }}>
      {/* The band under the chosen row. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-ink/[0.06]" style={{ height: ROW }} />
      <div
        ref={list}
        role="listbox"
        aria-label={label}
        aria-activedescendant={options[index] ? `${label}-${options[index].value}` : undefined}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKey}
        className="no-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [mask-image:linear-gradient(transparent,black_28%,black_72%,transparent)] [perspective:600px] focus-visible:[&+span]:opacity-100"
        style={{ paddingBlock: ROW * ((ROWS - 1) / 2) }}
      >
        {options.map((o, i) => {
          const d = i - pos; // rows from the middle, signed
          const far = Math.min(2.5, Math.abs(d));
          return (
            <div
              key={o.value}
              id={`${label}-${o.value}`}
              role="option"
              aria-selected={i === index}
              onClick={() => goTo(i)}
              className={clsx("grid snap-center place-items-center tabular transition-[font-weight] duration-150", i === index ? "font-semibold text-ink" : "text-ink-2")}
              style={{ height: ROW, opacity: 1 - far * 0.32, transform: `rotateX(${d * -20}deg) scale(${1 - far * 0.07})` }}
            >
              {o.label}
            </div>
          );
        })}
      </div>
      {/* The focus ring, drawn by hand: the list's own would be clipped by the mask. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 ring-2 ring-indigo ring-offset-2 ring-offset-surface transition-opacity" />
    </div>
  );
}
