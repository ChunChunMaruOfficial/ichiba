"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { SwipeDeck } from "@/components/swipe-deck";
import { Button, Chip, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

const DECK = 20;
const MIN_TO_FINISH = 10;

export default function WelcomePage() {
  return <RequireAuth reason="чтобы настроить ленту">{(me) => <Welcome me={me} />}</RequireAuth>;
}

/** Optional onboarding (frame 18): 20 swipes → sizes & city → Home with «Для вас». */
function Welcome({ me }: { me: Me }) {
  const router = useRouter();
  const meta = useMeta();
  const { refresh } = useSession();
  const [step, setStep] = useState<"swipe" | "profile">("swipe");
  const [count, setCount] = useState(0);
  const [clothing, setClothing] = useState<string[]>([]);
  const [shoes, setShoes] = useState<string[]>([]);
  const [city, setCity] = useState(me.city ?? "");
  const [busy, setBusy] = useState(false);

  const finish = async (withProfile: boolean) => {
    setBusy(true);
    await api("/users/me", {
      method: "PATCH",
      body: withProfile ? { onboarded: true, city: city || null, sizes: { clothing, shoes } } : { onboarded: true },
    }).catch(() => {});
    await refresh();
    router.replace(withProfile && count > 0 ? "/?chip=for_you" : "/");
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:py-10">
      <div className="mb-6 flex items-center justify-between">
        <span className="tabular text-sm text-muted">{step === "swipe" ? `${Math.min(count, DECK)} / ${DECK}` : "Почти готово"}</span>
        <button className="text-sm font-medium text-ink-2 hover:text-ink" onClick={() => finish(false)}>
          Пропустить
        </button>
      </div>

      {step === "swipe" ? (
        <>
          <h1 className="mb-1 text-3xl font-semibold tracking-tight">Что вам нравится?</h1>
          <p className="mb-6 text-ink-2">Вправо — нравится, влево — не моё. По этим свайпам соберём ленту «Для вас».</p>
          <SwipeDeck context="onboarding" limit={DECK} onSwipe={setCount} onDone={() => setStep("profile")} />
          {count >= MIN_TO_FINISH && (
            <Button block size="lg" className="mt-6" onClick={() => setStep("profile")}>
              Готово
            </Button>
          )}
        </>
      ) : (
        <>
          <h1 className="mb-1 text-3xl font-semibold tracking-tight">Ваш размер и город</h1>
          <p className="mb-8 text-ink-2">Необязательно — поможет показывать подходящие вещи рядом.</p>
          {meta && (
            <div className="flex flex-col gap-7">
              <Field label="Одежда">
                <div className="flex flex-wrap gap-2">
                  {meta.sizes.ALPHA.map((s) => (
                    <Chip key={s} active={clothing.includes(s)} onClick={() => setClothing((l) => toggle(l, s))} className="min-w-12 justify-center">
                      {s}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Обувь">
                <div className="flex flex-wrap gap-2">
                  {meta.sizes.SHOE_EU.map((s) => (
                    <Chip key={s} active={shoes.includes(s)} onClick={() => setShoes((l) => toggle(l, s))} className="min-w-12 justify-center">
                      {s}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Город" htmlFor="welcome-city">
                <select id="welcome-city" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass()}>
                  <option value="">Не указан</option>
                  {meta.cities.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Button size="lg" block loading={busy} onClick={() => finish(true)}>
                Готово
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
