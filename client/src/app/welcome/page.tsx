"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { Daruma } from "@/components/shop/daruma";
import { Kamon } from "@/components/shop/kamon";
import { Noren } from "@/components/shop/noren";
import { SwipeDeck } from "@/components/swipe-deck";
import { Button, Chip, Field, IconCheck, Textarea } from "@/components/ui";
import { WheelPicker } from "@/components/wheel-picker";
import { api } from "@/lib/api";
import type { BodyMeasurements, Me } from "@/lib/types";
import { Select } from "@/components/select";

const DECK = 20;
const MIN_TO_FINISH = 10;

type Who = "buyer" | "brand";
type Step = "who" | "swipe" | "sizes" | "body" | "brand" | "next";
const PATH: Record<Who, Step[]> = { buyer: ["who", "swipe", "sizes", "body"], brand: ["who", "brand", "next"] };

/** The body measurements, each on its own wheel; «—» leaves one out. */
const WHEELS: Array<{ key: keyof BodyMeasurements; label: string; hint: string; from: number; to: number; step?: number }> = [
  { key: "height", label: "Рост", hint: "без обуви", from: 140, to: 210 },
  { key: "chest", label: "Грудь", hint: "по широкой части", from: 70, to: 140 },
  { key: "waist", label: "Талия", hint: "по узкой части", from: 55, to: 130 },
  { key: "hips", label: "Бёдра", hint: "по широкой части", from: 75, to: 140 },
  { key: "footLength", label: "Стопа", hint: "от пятки до пальца", from: 20, to: 32, step: 0.5 },
];
const wheelOptions = (w: (typeof WHEELS)[number]) => {
  const out = [{ value: "", label: "—" }];
  for (let v = w.from; v <= w.to + 1e-9; v += w.step ?? 1) {
    const s = String(Math.round(v * 10) / 10);
    out.push({ value: s, label: s });
  }
  return out;
};

export default function WelcomePage() {
  return <RequireAuth reason="чтобы настроить ленту">{(me) => <Welcome me={me} />}</RequireAuth>;
}

/**
 * Optional onboarding (frame 18). A buyer: 20 swipes → sizes and city → body measurements on drum wheels → Home
 * with «Для вас». A brand or a shop: the city and a line about the brand → the «Бренд» seal and the first item.
 * Every step can be skipped; what was filled in is kept.
 */
function Welcome({ me }: { me: Me }) {
  const router = useRouter();
  const meta = useMeta();
  const { refresh } = useSession();
  const [who, setWho] = useState<Who>("buyer");
  const [step, setStep] = useState<Step>("who");
  const [count, setCount] = useState(0);
  const [clothing, setClothing] = useState<string[]>([]);
  const [shoes, setShoes] = useState<string[]>([]);
  const [city, setCity] = useState(me.city ?? "");
  const [body, setBody] = useState<Record<string, string>>({});
  const [bio, setBio] = useState(me.bio ?? "");
  const [busy, setBusy] = useState(false);

  const path = PATH[who];
  const at = path.indexOf(step);
  const next = () => setStep(path[at + 1] ?? step);

  /** Saves what was filled in so far and ends the onboarding; `to` is the page that follows. */
  const finish = async (to: string) => {
    setBusy(true);
    const bodyMeasurements: Record<string, number> = {};
    for (const [k, v] of Object.entries(body)) if (v) bodyMeasurements[k] = Number(v);
    await api("/users/me", {
      method: "PATCH",
      body: {
        onboarded: true,
        ...(city ? { city } : {}),
        ...(who === "buyer" && (clothing.length || shoes.length) ? { sizes: { clothing, shoes } } : {}),
        ...(Object.keys(bodyMeasurements).length ? { bodyMeasurements } : {}),
        ...(who === "brand" && bio.trim() ? { bio: bio.trim() } : {}),
      },
    }).catch(() => {});
    await refresh();
    router.replace(to);
  };
  const skip = () => finish("/");
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const title: Record<Step, [string, string]> = {
    who: ["Добро пожаловать на ichiba", "Пара вопросов — и площадка подстроится под вас. Всё можно пропустить."],
    swipe: ["Что вам нравится?", "Вправо — нравится, влево — не моё. Соберём ленту «Для вас»."],
    sizes: ["Ваш размер и город", "Подскажем, что подойдёт, и покажем вещи рядом. Необязательно."],
    body: ["Ваши мерки", "Крутите барабаны — по меркам подберём вещи точнее размера на бирке и пошьём по фигуре. Необязательно."],
    brand: ["Расскажите о бренде", "Город и пара слов — их увидят покупатели в вашем гардеробе."],
    next: ["Почти готово", "Лавку бренда с печатью «Бренд» и местом в каталоге открываем мы — одним письмом. А первую вещь можно выставить прямо сейчас."],
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 flex items-center justify-between">
        {/* Where you are on the way: a dot per step, the passed ones in ink. */}
        <ol className="flex items-center gap-2" aria-label="Шаги">
          {path.map((s, i) => (
            <li key={s} aria-current={i === at ? "step" : undefined} className={clsx("h-1.5 rounded-full transition-[width,background-color] duration-300", i === at ? "w-6 bg-shu" : i < at ? "w-1.5 bg-ink" : "w-1.5 bg-line-strong")} />
          ))}
          {step === "swipe" && <li className="ml-2 tabular text-sm text-muted">{Math.min(count, DECK)} / {DECK}</li>}
        </ol>
        <button className="text-sm font-medium text-ink-2 hover:text-ink" onClick={skip} disabled={busy}>
          Пропустить
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16">
        {/* left: what this step is about, under the shop's noren */}
        <div key={step} className="rise lg:sticky lg:top-24">
          {who === "brand" && step !== "who" ? <Kamon className="mb-6 hidden w-24 lg:block" /> : <Noren className="mb-6 hidden w-72 lg:block" />}
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{title[step][0]}</h1>
          <p className="mt-3 max-w-md text-lg text-ink-2">{title[step][1]}</p>
        </div>

        <div key={`${step}-form`} className="rise" style={{ animationDelay: "100ms" }}>
          {step === "who" && (
            <div className="flex flex-col gap-3">
              {(
                [
                  ["buyer", "Ищу и продаю своё", "Лента под мой вкус, подходящие размеры, продажа из своего гардероба"],
                  ["brand", "Бренд или магазин", "Выставляю коллекцию: печать «Бренд», место в каталоге, пошив по меркам"],
                ] as Array<[Who, string, string]>
              ).map(([w, name, hint]) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => {
                    setWho(w);
                    setStep(PATH[w][1]);
                  }}
                  className="flex items-start gap-4 rounded-[22px] bg-paper p-5 text-left shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1.5px_var(--indigo),var(--shadow-paper)]"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-shu font-brush text-xl text-on-shu">{w === "buyer" ? "好" : "銘"}</span>
                  <span>
                    <span className="block text-lg font-bold">{name}</span>
                    <span className="mt-0.5 block text-sm text-ink-2">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === "swipe" && (
            <>
              <SwipeDeck context="onboarding" limit={DECK} onSwipe={setCount} onDone={next} />
              {count >= MIN_TO_FINISH && (
                <Button block size="lg" className="pop mt-6" onClick={next}>
                  Дальше
                </Button>
              )}
            </>
          )}

          {step === "sizes" && meta && (
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
              <Button size="lg" block onClick={next}>
                Дальше
              </Button>
            </div>
          )}

          {step === "body" && (
            <div className="flex flex-col gap-6">
              {/* The wheels in a row; on a phone the row scrolls sideways and snaps wheel by wheel. */}
              <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-2 sm:px-0">
                {WHEELS.map((w) => (
                  <div key={w.key} className="w-[31%] shrink-0 snap-center rounded-[20px] bg-paper px-1 py-3 text-center shadow-[inset_0_0_0_1px_var(--line-strong)] sm:w-auto">
                    <p className="text-sm font-semibold">{w.label}</p>
                    <p className="mt-0.5 h-8 px-1 text-[11px] leading-tight text-muted">{w.hint}</p>
                    <WheelPicker label={w.label} options={wheelOptions(w)} value={body[w.key] ?? ""} onChange={(v) => setBody((b) => ({ ...b, [w.key]: v }))} />
                    <p className="mt-1 text-xs text-muted">см</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-ink-2">Мерки видны только вам; при пошиве по меркам они уйдут бренду вместе с заказом.</p>
              <Button size="lg" block loading={busy} onClick={() => finish(count > 0 ? "/?chip=for_you" : "/")}>
                <IconCheck className="size-5" /> Готово
              </Button>
            </div>
          )}

          {step === "brand" && meta && (
            <div className="flex flex-col gap-7">
              <Field label="Город" htmlFor="welcome-city" hint="Подставляется в новые вещи">
                <Select id="welcome-city" value={city} onChange={setCity} options={[{ value: "", label: "Не указан" }, ...meta.cities.map((c) => ({ value: c, label: c }))]} />
              </Field>
              <Field label="О бренде" htmlFor="welcome-bio" hint={`${bio.length}/160 · видно в гардеробе`}>
                <Textarea id="welcome-bio" maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Например: streetwear из Минска, шьём сами, доставка по Беларуси" className="min-h-24" />
              </Field>
              <Button size="lg" block onClick={next}>
                Дальше
              </Button>
            </div>
          )}

          {step === "next" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-5 rounded-[22px] bg-paper p-5 shadow-[inset_0_0_0_1px_var(--line-strong)]">
                <Daruma eyes={1} className="h-24 shrink-0" />
                <div>
                  <p className="font-bold">Лавка бренда</p>
                  <p className="mt-1 text-sm text-ink-2">Напишите нам пару слов о бренде — и на всех ваших вещах появится печать «Бренд», а гардероб попадёт в каталог на главной.</p>
                </div>
              </div>
              <Button size="lg" block loading={busy} onClick={() => finish("/sell")}>
                Добавить первую вещь
              </Button>
              <Button size="lg" block variant="secondary" disabled={busy} onClick={() => finish("/contacts")}>
                Написать нам о бренде
              </Button>
              <Button variant="link" className="self-center" disabled={busy} onClick={() => finish("/")}>
                На главную
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
