"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { usePresence } from "@/lib/presence";
import { Button, Input } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
/** Value for <input type="datetime-local"> in the user's time zone. */
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "сегодня в 19:00", "завтра в 10:00", "12 октября в 19:00". */
export function scheduleLabel(iso: string) {
  const d = new Date(iso);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  const date = diff === 0 ? "сегодня" : diff === 1 ? "завтра" : d.toLocaleDateString("ru", { day: "numeric", month: "long" });
  return `${date} в ${time}`;
}

/** Evenings and weekend mornings are when people browse; offered as one-tap options. */
function presets() {
  const now = new Date();
  const at = (days: number, h: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  return [at(0, 19), at(1, 10), at(1, 19), at(2, 19)].filter((d) => d.getTime() - now.getTime() > 15 * 60_000).slice(0, 3);
}

/** "Опубликовать позже" (eBay scheduled listings): pick a time up to 30 days ahead. */
/** `compact`: on phones the button is just a clock icon, so it fits next to the main action. */
export function SchedulePicker({
  onSchedule,
  disabled,
  className,
  buttonClassName,
  compact,
}: {
  onSchedule: (at: Date) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pop = usePresence(open);
  const [value, setValue] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Bounds are fixed when the picker mounts (the server re-checks: at least 5 minutes ahead, at most 30 days).
  const [bounds] = useState(() => ({ min: toLocalInput(new Date(Date.now() + 10 * 60_000)), max: toLocalInput(new Date(Date.now() + 30 * 86_400_000)), presets: presets() }));
  const chosen = value ? new Date(value) : null;
  const valid = !!chosen && value >= bounds.min && value <= bounds.max;

  return (
    <div ref={box} className={clsx("relative", className)}>
      <Button type="button" variant="secondary" size="lg" disabled={disabled} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Запланировать" className={buttonClassName}>
        {compact && (
          <svg viewBox="0 0 24 24" className="size-5 md:hidden" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        )}
        <span className={compact ? "hidden md:inline" : undefined}>Запланировать</span>
      </Button>
      {pop.mounted && (
        <div data-closing={pop.closing || undefined} className="fade-in absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(88vw,320px)] rounded-2xl border border-line bg-surface p-4 shadow-xl md:left-auto md:right-0">
          <p className="font-semibold">Опубликовать позже</p>
          <p className="mt-1 text-sm text-muted">Проверим объявление сейчас, а в каталоге оно появится в выбранное время.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {bounds.presets.map((d) => (
              <button key={d.toISOString()} type="button" onClick={() => setValue(toLocalInput(d))} className="rounded-full border border-line-strong px-3 py-1.5 text-sm hover:border-ink">
                {scheduleLabel(d.toISOString())}
              </button>
            ))}
          </div>
          <Input type="datetime-local" aria-label="Дата и время публикации" min={bounds.min} max={bounds.max} value={value} onChange={(e) => setValue(e.target.value)} className="mt-3" />
          <Button
            type="button"
            block
            className="mt-3"
            disabled={!valid || disabled}
            onClick={() => {
              setOpen(false);
              onSchedule(chosen!);
            }}
          >
            {valid ? `Запланировать на ${scheduleLabel(chosen!.toISOString())}` : "Выберите время"}
          </Button>
        </div>
      )}
    </div>
  );
}
