"use client";

import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { usePresence } from "@/lib/presence";
import { inputClass } from "./ui";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Suggestions from the ~5 000-brand catalogue (GET /brands): typo- and Cyrillic-tolerant, "найк" finds Nike. */
export function useBrandSuggestions(query: string, enabled: boolean, limit = 8) {
  const q = useDebounced(query.trim(), 150);
  const { data, isLoading } = useSWR<{ items: string[] }>(enabled ? `/brands?limit=${limit}&q=${encodeURIComponent(q)}` : null, { keepPreviousData: true });
  return { items: data?.items ?? [], loading: isLoading };
}

/**
 * Brand combobox: pick from the catalogue or keep your own spelling for a small label.
 * Arrow keys move, Enter picks, Esc closes.
 */
export function BrandPicker({
  value,
  onChange,
  className,
  placeholder = "Например, Zara",
  error,
  id,
  "aria-describedby": describedBy,
}: {
  value: string;
  onChange: (brand: string) => void;
  className?: string;
  placeholder?: string;
  error?: string;
  /** Put on the input, so a <label htmlFor> (ui.tsx Field) names the combobox. */
  id?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const pop = usePresence(open);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { items } = useBrandSuggestions(value, pop.mounted);
  const typed = value.trim();
  const exact = items.some((b) => b.toLowerCase() === typed.toLowerCase());
  const options = typed && !exact ? [...items, `__custom__`] : items;

  useEffect(() => {
    // pointerdown, not mousedown: iOS Safari fires no mousedown for a tap on a non-clickable area.
    const onDoc = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  const pick = (b: string) => {
    onChange(b === "__custom__" ? typed : b);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        aria-describedby={describedBy}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={!!error || undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className={clsx(inputClass(error), className)}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" && open && active >= 0) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape" || e.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      {pop.mounted && options.length > 0 && (
        <ul
          data-closing={pop.closing || undefined}
          id={listId}
          role="listbox"
          className="fade-in absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
        >
          {!typed && <li className="px-3 pb-1 pt-1.5 text-xs text-muted">Популярные бренды</li>}
          {options.map((b, i) => (
            <li
              key={b}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(b)}
              className={clsx("cursor-pointer rounded-xl px-3 py-2 text-[15px]", i === active && "bg-paper")}
            >
              {b === "__custom__" ? (
                <span className="text-ink-2">
                  Оставить «<span className="font-medium text-ink">{typed}</span>» — бренда нет в каталоге
                </span>
              ) : (
                <Highlight text={b} query={typed} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold">{text.slice(i, i + query.length)}</span>
      {text.slice(i + query.length)}
    </>
  );
}
