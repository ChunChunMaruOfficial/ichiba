"use client";

import clsx from "clsx";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/lib/presence";
import { IconCheck, IconChevronDown } from "./ui";

export interface SelectOption {
  value: string;
  label: string;
}

const GAP = 6;
const MAX_H = 288;

/**
 * The site's dropdown instead of the browser's: a button in the site's style opening a sheet of paper with the
 * options, the chosen one checked in cinnabar. Keyboard: arrows, Home/End, Enter/Space, Esc, and typing jumps to an
 * option. The list is portalled and fixed, so drawers and modals with scrolling never clip it; it opens upwards
 * when there is no room below.
 * `field` looks like an input (forms); `pill` is the small rounded one (sorting); `text` is a bare label with a
 * chevron (sorting next to a search bar).
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  id,
  "aria-label": ariaLabel,
  variant = "field",
  error,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  variant?: "field" | "pill" | "text";
  error?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const pop = usePresence(open, 120);
  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected];

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - GAP - 8;
    const above = b.top - GAP - 8;
    const up = below < Math.min(MAX_H, 200) && above > below;
    const width = Math.max(b.width, 180);
    const left = Math.min(Math.max(8, b.left), window.innerWidth - width - 8);
    setPos(up ? { left, bottom: window.innerHeight - b.top + GAP, width, maxHeight: Math.min(MAX_H, above), up } : { left, top: b.bottom + GAP, width, maxHeight: Math.min(MAX_H, below), up });
  }, []);

  const show = (at = selected >= 0 ? selected : 0) => {
    if (disabled) return;
    place();
    setActive(at);
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close();
  };

  // Keep the list next to the button while anything scrolls; close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) place();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // The active option stays in view.
  useLayoutEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show(e.key === "ArrowUp" ? (selected > 0 ? selected - 1 : 0) : undefined);
      }
      return;
    }
    if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") return close(false);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      // Typing jumps to the first option starting with what was typed (within a second).
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={!!error || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        className={clsx(
          "group/select inline-flex items-center justify-between gap-2 text-left outline-none transition-[border-color,box-shadow,background-color] disabled:cursor-not-allowed disabled:opacity-50",
          variant === "field"
            ? ["h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] hover:border-ink-2 focus-visible:border-indigo focus-visible:ring-3 focus-visible:ring-indigo/20", error ? "border-2 border-danger" : "border-line-control"]
            : variant === "pill"
              ? "chip h-9 shrink-0 px-4 text-sm font-medium focus-visible:ring-3 focus-visible:ring-indigo/25"
              : "-mx-1 h-9 shrink-0 rounded-lg px-1 text-[15px] font-semibold text-ink hover:text-indigo focus-visible:ring-3 focus-visible:ring-indigo/25",
          open && variant === "field" && "border-indigo ring-3 ring-indigo/20",
          className,
        )}
      >
        <span className={clsx("min-w-0 truncate", !current?.value && variant === "field" && "text-muted")}>{current?.label ?? placeholder ?? "Выберите"}</span>
        <IconChevronDown className={clsx("size-4 shrink-0 text-ink-2 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {pop.mounted &&
        pos &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            data-closing={pop.closing || undefined}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxHeight: pos.maxHeight, transformOrigin: pos.up ? "bottom left" : "top left" }}
            className="panel menu-pop fixed z-[90] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-2xl p-1.5"
          >
            {options.map((o, i) => {
              const on = i === selected;
              return (
                <li
                  key={o.value || "∅"}
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  onPointerEnter={() => setActive(i)}
                  // Pointer down, not click: the button must not lose the choice to a blur first.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={clsx(
                    "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                    i === active ? "bg-ink/[0.06]" : "",
                    on ? "font-semibold text-ink" : "text-ink-2",
                  )}
                >
                  <span className={clsx("grid size-5 shrink-0 place-items-center rounded-full", on ? "bg-shu text-on-shu" : "")}>{on && <IconCheck className="size-3.5" />}</span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
