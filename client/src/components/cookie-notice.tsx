"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ANALYTICS, consentReopened, readConsent, saveConsent, subscribeConsent, type Consent } from "@/lib/analytics";
import { EXIT_MS } from "@/lib/presence";
import { Button } from "./ui";

/**
 * The cookie notice. With analytics configured (lib/analytics.ts) it asks: analytics cookies load only after
 * «Разрешить»; «Только необходимые» keeps the site as it is. Without analytics it only informs, and «Понятно» is the
 * same as «necessary only». «Настройки cookie» in the footer brings it back to change the choice.
 */
export function CookieNotice() {
  // Server render and hydration: hidden; the real value is read on the client, so markup never mismatches.
  const shown = useSyncExternalStore(subscribeConsent, () => consentReopened() || readConsent() === null, () => false);
  const [leaving, setLeaving] = useState(false);
  if (!shown) return null;

  // Fade out first, then remember the choice (which unmounts the notice).
  const choose = (value: Consent) => {
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      saveConsent(value);
    }, EXIT_MS);
  };

  const policy = (
    <Link href="/privacy#cookies" className="font-medium text-ink underline underline-offset-4">
      Политике конфиденциальности
    </Link>
  );
  return (
    <section
      role="region"
      aria-label="Уведомление о cookie"
      data-closing={leaving || undefined}
      data-chrome="cookie"
      className="panel fade-in fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-50 rounded-3xl p-4 md:inset-x-auto md:bottom-5 md:left-5 md:max-w-sm"
    >
      {ANALYTICS ? (
        <>
          <p className="text-sm leading-relaxed text-ink-2">
            <b className="font-semibold text-ink">Cookie на ichiba.</b> Необходимые держат вас в аккаунте. Аналитические (Яндекс Метрика, Google Analytics) — только с
            вашего разрешения: они показывают, как люди пользуются сайтом, чтобы мы делали его удобнее. Рекламы нет. Подробнее — в {policy}.
          </p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <Button size="sm" className="md:px-6" onClick={() => choose("all")} autoFocus={false}>
              Разрешить
            </Button>
            <Button size="sm" variant="secondary" className="md:px-5" onClick={() => choose("necessary")}>
              Только необходимые
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-ink-2">
            <b className="font-semibold text-ink">Мы используем только необходимые cookie</b> — чтобы вы оставались в аккаунте, — и не подключаем рекламные трекеры. Подробнее —
            в {policy}.
          </p>
          <Button size="sm" className="mt-3 w-full md:w-auto md:px-6" onClick={() => choose("necessary")} autoFocus={false}>
            Понятно
          </Button>
        </>
      )}
    </section>
  );
}
