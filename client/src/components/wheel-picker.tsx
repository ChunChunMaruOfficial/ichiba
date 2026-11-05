"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

/**
 * A drum picker, the way a phone picks a date: the values on a wheel that snaps to the one under the band in the
 * middle, the rows curving away above and below. Scrolled with a finger, the wheel or a mouse drag, tapped, moved
 * with the small arrows above and below or with the arrow keys. Each option is a string; the one in the middle is
 * the value.
 */

const ROW = 40;
const ROWS = 5;

export function WheelPicker({ options, value, onChange, label, className }: { options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void; label: string; className?: string }) {
  const list = useRef<HTMLDivElement>(null);
  /** Where the wheel is, in rows (fractional while it moves): the rows are drawn from it. */
  const [pos, setPos] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const frame = useRef(0);
  /** A mouse drag in progress: where it started and how far it went (a drag is not a tap on a row). */
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
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

  // A mouse drags the wheel (a finger scrolls it by itself): the snapping is off while the hand is on it and the
  // wheel settles on the nearest row when the hand lets go.
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !list.current) return;
    drag.current = { y: e.clientY, top: list.current.scrollTop, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = list.current;
    if (!d || !el) return;
    if (!(e.buttons & 1)) {
      drag.current = null;
      setDragging(false);
      return;
    }
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    el.scrollTop = d.top - dy;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || !list.current) return;
    setDragging(false);
    goTo(Math.round(list.current.scrollTop / ROW));
  };

  return (
    <div className={clsx("relative select-none", className)}>
      <Arrow dir="up" label={`${label}: меньше`} disabled={index <= 0} onClick={() => goTo(index - 1)} />
      <div className="relative" style={{ height: ROW * ROWS }}>
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
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          className={clsx(
            "no-scrollbar h-full snap-y overflow-y-auto overscroll-contain outline-none [mask-image:linear-gradient(transparent,black_28%,black_72%,transparent)] [perspective:600px] focus-visible:[&+span]:opacity-100",
            dragging ? "cursor-grabbing snap-none" : "cursor-grab snap-mandatory",
          )}
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
                onClick={() => !dragging && goTo(i)}
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
      <Arrow dir="down" label={`${label}: больше`} disabled={index >= options.length - 1} onClick={() => goTo(index + 1)} />
    </div>
  );
}

/** A small chevron above or below the drum: one row at a time. */
function Arrow({ dir, label, disabled, onClick }: { dir: "up" | "down"; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="mx-auto grid h-6 w-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {dir === "up" ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
      </svg>
    </button>
  );
}
