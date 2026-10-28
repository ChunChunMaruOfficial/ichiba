"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { EXIT_MS } from "@/lib/presence";
import { Button } from "./ui";

/**
 * One-time notice about cookies. The site uses only strictly necessary storage (session cookie, local
 * preferences), so this informs rather than asks; "Понятно" hides it on this device.
 * Bump VERSION when the cookie set changes so everyone sees the notice again.
 */
const KEY = "ichiba:cookie-notice";
const VERSION = "1";
const listeners = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) === VERSION;
  } catch {
    // Storage blocked (private mode): don't nag on every page.
    return true;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function CookieNotice() {
  // Server render and hydration: hidden; the real value is read on the client, so markup never mismatches.
  const seen = useSyncExternalStore(subscribe, read, () => true);
  const [leaving, setLeaving] = useState(false);
  if (seen) return null;

  // Fade out first, then remember the choice (which unmounts the notice).
  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => {
      try {
        localStorage.setItem(KEY, VERSION);
      } catch {
        /* storage blocked — the notice just closes for this page view */
      }
      listeners.forEach((l) => l());
    }, EXIT_MS);
  };

  return (
    <section
      role="region"
      aria-label="Уведомление о cookie"
      data-closing={leaving || undefined}
      data-chrome="cookie"
      className="panel fade-in fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-50 rounded-3xl p-4 md:inset-x-auto md:bottom-5 md:left-5 md:max-w-sm"
    >
      <p className="text-sm leading-relaxed text-ink-2">
        <b className="font-semibold text-ink">Мы используем только необходимые cookie</b> — чтобы вы оставались в аккаунте, — и не подключаем рекламные трекеры. Подробнее — в{" "}
        <Link href="/privacy#cookies" className="font-medium text-ink underline underline-offset-4">
          Политике конфиденциальности
        </Link>
        .
      </p>
      <Button size="sm" className="mt-3 w-full md:w-auto md:px-6" onClick={dismiss} autoFocus={false}>
        Понятно
      </Button>
    </section>
  );
}
