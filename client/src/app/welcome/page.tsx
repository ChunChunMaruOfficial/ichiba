"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { Noren } from "@/components/shop/noren";
import { SwipeDeck } from "@/components/swipe-deck";
import { Button, Chip, Field } from "@/components/ui";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Select } from "@/components/select";

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
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 flex items-center justify-between">
        <span className="tabular text-sm text-muted">{step === "swipe" ? `${Math.min(count, DECK)} / ${DECK}` : "Почти готово"}</span>
        <button className="text-sm font-medium text-ink-2 hover:text-ink" onClick={() => finish(false)}>
          Пропустить
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16">
        {/* left: what this step is about, under the shop's noren */}
        <div className="rise lg:sticky lg:top-24">
          <Noren className="mb-6 hidden w-72 lg:block" />
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{step === "swipe" ? "Что вам нравится?" : "Ваш размер и город"}</h1>
          <p className="mt-3 max-w-md text-lg text-ink-2">{step === "swipe" ? "Вправо — нравится, влево — не моё. Соберём ленту «Для вас»." : "Необязательно — поможет показывать подходящие вещи рядом."}</p>
        </div>

        <div className="rise" style={{ animationDelay: "100ms" }}>
          {step === "swipe" ? (
            <>
              <SwipeDeck context="onboarding" limit={DECK} onSwipe={setCount} onDone={() => setStep("profile")} />
              {count >= MIN_TO_FINISH && (
                <Button block size="lg" className="pop mt-6" onClick={() => setStep("profile")}>
                  Готово
                </Button>
              )}
            </>
          ) : (
            meta && (
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
                  <Select id="welcome-city" value={city} onChange={setCity} options={[{ value: "", label: "Не указан" }, ...meta.cities.map((c) => ({ value: c, label: c }))]} />
                </Field>
                <Button size="lg" block loading={busy} onClick={() => finish(true)}>
                  Готово
                </Button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
