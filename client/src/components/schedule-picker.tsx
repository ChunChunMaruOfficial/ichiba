"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { usePresence } from "@/lib/presence";
import { Button } from "./ui";
import { WheelPicker } from "./wheel-picker";

const pad = (n: number) => String(n).padStart(2, "0");

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

/** Days on the first wheel: today and the 30 after it (the server allows a month ahead). */
const DAYS = 31;
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: pad(h) }));
const MINUTES = Array.from({ length: 12 }, (_, i) => ({ value: String(i * 5), label: pad(i * 5) }));

/** The first sensible time to offer: this evening at 19:00, or tomorrow at 10:00 once the evening is too close. */
function firstChoice(today: Date) {
  const now = Date.now();
  for (const [days, h] of [[0, 19], [1, 10], [1, 19]] as const) {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    if (d.getTime() - now > 15 * 60_000) return { day: days, hour: h, minute: 0 };
  }
  return { day: 1, hour: 10, minute: 0 };
}

/** "Опубликовать позже" (eBay scheduled listings): a day, an hour and a minute on three drums, up to 30 days ahead. */
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
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // pointerdown, not mousedown: iOS Safari fires no mousedown for a tap on a non-clickable area.
    const onDoc = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  // The days are counted from the moment the picker mounts (the server re-checks: at least 5 minutes ahead, at most 30 days).
  const [setup] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const label = i === 0 ? "Сегодня" : i === 1 ? "Завтра" : d.toLocaleDateString("ru", { weekday: "short", day: "numeric", month: "short" });
      return { value: String(i), label };
    });
    return { today, days, first: firstChoice(today) };
  });
  const [pick, setPick] = useState(setup.first);
  /** The clock as of opening the menu: «already passed» is judged against it, not against every render. */
  const [now, setNow] = useState(() => setup.today.getTime());
  const chosen = new Date(setup.today);
  chosen.setDate(chosen.getDate() + pick.day);
  chosen.setHours(pick.hour, pick.minute, 0, 0);
  const ahead = chosen.getTime() - now;
  const valid = ahead >= 10 * 60_000 && ahead <= 30 * 86_400_000;

  return (
        // Compact (phone bar): the menu is anchored to the fixed bottom bar and spans it, so it never leaves the screen.
    <div ref={box} className={clsx(compact ? "md:relative" : "relative", className)}>
      <Button type="button" variant="secondary" size={compact ? "lgTight" : "lg"} disabled={disabled} onClick={() => {
          setNow(Date.now());
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label="Запланировать" className={buttonClassName}>
        {compact && (
          <svg viewBox="0 0 24 24" className="size-6 shrink-0 md:hidden" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        )}
        <span className={compact ? "hidden md:inline" : undefined}>Запланировать</span>
      </Button>
      {pop.mounted && (
        <div data-closing={pop.closing || undefined} className={clsx("fade-in absolute bottom-[calc(100%+8px)] z-50 rounded-2xl border border-line bg-surface p-4 shadow-xl md:left-auto md:right-0 md:w-80", compact ? "inset-x-3" : "left-0 w-[min(88vw,320px)]")}>
          <p className="font-semibold">Опубликовать позже</p>
          <p className="mt-1 text-sm text-muted">Проверим объявление сейчас, а в каталоге оно появится в выбранное время.</p>
          {/* Day, hour and minute on drums, like the wheels for measurements in onboarding. */}
          <div className="mt-3 flex items-stretch gap-1">
            <WheelPicker label="День" options={setup.days} value={String(pick.day)} onChange={(v) => setPick((p) => ({ ...p, day: Number(v) }))} className="min-w-0 flex-[1.7]" />
            <WheelPicker label="Час" options={HOURS} value={String(pick.hour)} onChange={(v) => setPick((p) => ({ ...p, hour: Number(v) }))} className="min-w-0 flex-1" />
            <span aria-hidden className="grid place-items-center pb-0.5 text-lg font-semibold text-ink-2">:</span>
            <WheelPicker label="Минуты" options={MINUTES} value={String(pick.minute)} onChange={(v) => setPick((p) => ({ ...p, minute: Number(v) }))} className="min-w-0 flex-1" />
          </div>
          <Button
            type="button"
            block
            className="mt-3"
            disabled={!valid || disabled}
            onClick={() => {
              setOpen(false);
              onSchedule(chosen);
            }}
          >
            {valid ? `Запланировать на ${scheduleLabel(chosen.toISOString())}` : ahead < 10 * 60_000 ? "Это время уже прошло" : "Не дальше чем через 30 дней"}
          </Button>
        </div>
      )}
    </div>
  );
}
