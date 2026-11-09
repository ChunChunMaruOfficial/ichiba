"use client";

import { NotifyEmailSection } from "@/components/notify-email";
import { TelegramSection } from "@/components/telegram-settings";
import { TitleWithKanji } from "@/components/sections";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMeta, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { tiersText } from "@/components/trust";
import { Button, Chip, Field, IconPhone, IconX, Input, Modal, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { plural } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import { DARK_THEME_ENABLED, type ThemeChoice } from "@/lib/theme";
import type { BodyMeasurements, BundleTier, Me, PreferredSizes } from "@/lib/types";

export default function SettingsPage() {
  const { me, loading } = useSession();
  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }
  return me ? <Settings me={me} /> : <GuestSettings />;
}

/** Signed out: the look settings live on this device; everything else needs an account. */
function GuestSettings() {
  const { openAuth } = useSession();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <div className="mb-8">
        <TitleWithKanji kanji="設定">
          <h1 className="rise text-4xl font-bold">Настройки</h1>
        </TitleWithKanji>
      </div>
      <div className="flex flex-col gap-10">
        <AppearanceSection me={null} />
        <Section title="Аккаунт" hint="Телефон, размеры и уведомления — после входа. Выбранный здесь вид карточек перейдёт в аккаунт.">
          <Button onClick={openAuth}>Войти</Button>
        </Section>
      </div>
    </div>
  );
}

/** Saves one settings section; shows field errors and a toast. */
function useSave() {
  const { refresh } = useSession();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = async (body: Record<string, unknown>, done = "Изменения сохранены") => {
    setSaving(true);
    setFields({});
    try {
      await api("/users/me", { method: "PATCH", body });
      await refresh();
      toast(done);
      return true;
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      toast(e instanceof ApiError ? e.message : "Не удалось сохранить", { tone: "error" });
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { saving, fields, save };
}

function Section({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rise scroll-mt-24 border-t border-line pt-8 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-bold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * Section index: glides to the section instead of jumping, and follows the reading position — the section in
 * view is marked with a cinnabar bar that slides between items.
 */
function SettingsNav({ items }: { items: ReadonlyArray<readonly [string, string, string]> }) {
  const [active, setActive] = useState(items[0]?.[0] ?? "");
  useEffect(() => {
    const sections = items.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    // The section whose top has passed a line a third down the screen is the one being read.
    const onScroll = () => {
      const line = window.innerHeight / 3;
      let current: string | undefined = sections[0]?.id;
      for (const el of sections) if (el.getBoundingClientRect().top <= line) current = el.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1)?.id;
      if (current) setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);
  const index = Math.max(0, items.findIndex(([id]) => id === active));
  return (
    <nav aria-label="Разделы настроек" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
      <ul className="relative flex flex-col gap-0.5">
        <span aria-hidden className="absolute left-0 top-0 h-11 w-[3px] rounded-full bg-shu transition-transform duration-300 ease-out" style={{ transform: `translateY(${index * 46}px)` }} />
        {items.map(([id, kanji, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
                history.replaceState(null, "", `#${id}`);
                setActive(id);
              }}
              className={clsx("group flex h-11 items-center gap-3 rounded-xl px-4 text-[15px] transition-colors hover:bg-ink/5", active === id ? "font-medium text-ink" : "text-ink-2 hover:text-ink")}
            >
              <span aria-hidden className={clsx("font-brush text-lg leading-none transition-colors", active === id ? "text-shu" : "text-shu/60 group-hover:text-shu")}>
                {kanji}
              </span>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Settings({ me }: { me: Me }) {
  const { logout } = useSession();
  const router = useRouter();
  const toast = useToast();
  // Links like /settings#sizes land on the section once the page (rendered after the session loads) exists.
  // getElementById, not querySelector: a hash like "#1" or "#a:b" is not a valid selector and used to throw.
  useEffect(() => {
    try {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    } catch {
      // A malformed %-escape in the hash: just stay at the top.
    }
  }, []);
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <div className="mb-8">
        <TitleWithKanji kanji="設定">
          <h1 className="rise text-4xl font-bold">Настройки</h1>
        </TitleWithKanji>
        <p className="rise mt-1 text-muted">
          @{me.username}
          {me.email ? ` · ${me.email}` : ""}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <SettingsNav
        items={[
          ["appearance", "装", "Карточки вещей"],
          ["phone", "電", "Телефон"],
          ["sizes", "寸", "Мои размеры"],
          ...(me.isSeller ? ([["bundle", "組", "Скидка за комплект"]] as const) : []),
          ...(me.isSeller || me.isBrand ? ([["notify", "便", "Уведомления на почту"]] as const) : []),
          ...(me.telegram?.available || me.telegram?.linked ? ([["telegram", "報", "Telegram"]] as const) : []),
          ["danger", "出", "Выход и удаление"],
        ]}
      />
      <div className="flex min-w-0 max-w-3xl flex-col gap-10">
      <AppearanceSection me={me} />
      <PhoneSection me={me} />
      <SizesSection me={me} />
      {me.isSeller && <BundleSection me={me} />}
      {(me.isSeller || me.isBrand) && <NotifyEmailSection me={me} Section={Section} />}
      <TelegramSection me={me} Section={Section} />
      {/* The only place to sign out (it is not in the account menu) and to delete the account. */}
      <AccountActions
        me={me}
        onLogout={async () => {
          try {
            await logout();
          } catch (e) {
            // No connection or the API is down: the session is still there, so say so instead of failing silently.
            toast(e instanceof ApiError ? e.message : "Не удалось выйти. Повторите", { tone: "error" });
            return;
          }
          router.push("/");
        }}
      />
      <p className="text-sm text-ink-2">
        Как мы обращаемся с вашими данными — в{" "}
        <Link href="/privacy" className="font-medium text-ink underline underline-offset-4">
          Политике конфиденциальности
        </Link>
        .
      </p>
      </div>
      </div>
    </div>
  );
}

/** A row of exclusive choices drawn as cards (card style, theme); a choice may carry a small picture of itself. */
function Choices<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string, string, React.ReactNode?]>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("grid grid-cols-1 gap-2", options.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
      {options.map(([v, title, hint, picture]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={clsx(
            "flex items-start gap-4 rounded-2xl p-3.5 text-left transition-shadow",
            value === v ? "bg-indigo-soft shadow-[inset_0_0_0_1.5px_var(--indigo)]" : "bg-paper shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--line-control)]",
          )}
        >
          {picture}
          <span className="flex min-w-0 flex-col gap-1">
            <span className={clsx("text-[15px] font-semibold", value === v && "text-indigo")}>{title}</span>
            <span className="text-xs text-ink-2">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** A small drawing of an item card in one of the two styles: the photo with a price tag, or with the lines under it. */
function CardPicture({ detailed }: { detailed: boolean }) {
  return (
    <span aria-hidden className="block w-[76px] shrink-0">
      <span className="relative block aspect-[4/5] overflow-hidden rounded-[10px] bg-gradient-to-br from-skeleton to-line">
        {/* A tee, folded flat. */}
        <svg viewBox="0 0 40 50" className="absolute inset-0 size-full text-ink/15">
          <path d="M12 11 20 8l8 3 7 5-4 6-3-2v21H12V20l-3 2-4-6Z" fill="currentColor" />
        </svg>
        {!detailed && <span className="absolute bottom-1.5 left-1.5 h-3.5 w-7 rounded-[3px] bg-kraft" />}
      </span>
      {detailed && (
        <span className="mt-1.5 flex flex-col gap-[5px]">
          <span className="h-2.5 w-8 rounded-full bg-ink/75" />
          <span className="h-1.5 w-full rounded-full bg-ink/35" />
          <span className="h-1.5 w-2/3 rounded-full bg-ink/20" />
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-full bg-shu/70" />
            <span className="h-1.5 w-6 rounded-full bg-ink/20" />
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * How the site looks: the card style everywhere items are listed, and the theme («Васи» light / «Ёру» dark / as the
 * device) while it is on. Kept on this device and, with an account, in it (lib/prefs.ts).
 */
function AppearanceSection({ me }: { me: Me | null }) {
  const { prefs, set } = usePrefs();
  const cards: Array<["minimal" | "detailed", string, string, React.ReactNode]> = [
    ["minimal", "Минималистичные", "Фото и ценник; название, размер и кнопки появляются при наведении", <CardPicture key="m" detailed={false} />],
    ["detailed", "Подробные", "Цена, размер, название, состояние и продавец под каждым фото", <CardPicture key="d" detailed />],
  ];
  const themes: Array<[ThemeChoice, string, string]> = [
    ["system", "Как на устройстве", "Светлая днём, тёмная ночью — если так настроен телефон"],
    ["light", "Светлая", "Бумага васи и тушь"],
    ["dark", "Тёмная", "Ночная тушь, тёплая, не серая"],
  ];
  return (
    <>
      <Section id="appearance" title="Карточки вещей" hint={me ? undefined : "После входа выбор перейдёт в аккаунт"}>
        <Choices label="Карточки вещей" value={prefs.cardStyle} options={cards} onChange={(v) => void set({ cardStyle: v })} />
      </Section>
      {DARK_THEME_ENABLED && (
        <Section id="theme" title="Тема">
          <Choices label="Тема" value={prefs.theme} options={themes} onChange={(v) => void set({ theme: v })} />
        </Section>
      )}
    </>
  );
}

/**
 * The phone: the one profile field that stays in the settings — it is shown to the other side of a deal, not on the
 * page. The photo, the nickname, the city and the «о себе» line are changed on the wardrobe page itself.
 */
function PhoneSection({ me }: { me: Me }) {
  const { saving, fields, save } = useSave();
  const [phone, setPhone] = useState(me.phone ?? "");
  return (
    <Section id="phone" title="Телефон" hint="Покажем другой стороне только после подтверждения сделки">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ phone: phone || null }, phone ? "Телефон сохранён" : "Телефон убран");
        }}
      >
        <div className="min-w-0 flex-1">
          <label
            className={clsx(
              "flex h-14 items-center gap-3 rounded-2xl bg-paper px-4 transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--indigo)]",
              fields.phone ? "shadow-[inset_0_0_0_1.5px_var(--danger)]" : "shadow-[inset_0_0_0_1px_var(--line-strong)]",
            )}
          >
            <IconPhone className="size-5 shrink-0 text-ink-2" />
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              aria-label="Телефон"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+375 29 123-45-67"
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] tabular outline-none placeholder:text-muted"
            />
            {phone && (
              <button type="button" aria-label="Очистить" onClick={() => setPhone("")} className="-mr-1 rounded-full p-1 text-muted hover:bg-ink/5 hover:text-ink">
                <IconX className="size-4" />
              </button>
            )}
          </label>
          {fields.phone && <p className="mt-1.5 text-sm text-danger">{fields.phone}</p>}
        </div>
        <Button type="submit" loading={saving} disabled={phone === (me.phone ?? "")} className="h-14 shrink-0 px-6">
          Сохранить
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-2">
        Фото, ник, город и «о себе» меняются прямо в{" "}
        <Link href={`/u/${me.username}`} className="font-medium text-ink underline underline-offset-4">
          вашем гардеробе
        </Link>
        : наведите на имя, описание или фото.
      </p>
    </Section>
  );
}

const BODY: Array<{ key: keyof BodyMeasurements; label: string; hint: string; min: number; max: number }> = [
  { key: "chest", label: "Обхват груди", hint: "По самым выступающим точкам, лента горизонтально", min: 60, max: 170 },
  { key: "waist", label: "Обхват талии", hint: "По самой узкой части, не втягивая живот", min: 45, max: 170 },
  { key: "hips", label: "Обхват бёдер", hint: "По самым выступающим точкам ягодиц", min: 60, max: 180 },
  { key: "footLength", label: "Длина стопы", hint: "Встаньте на лист бумаги, от пятки до большого пальца", min: 18, max: 35 },
  { key: "height", label: "Рост", hint: "Без обуви", min: 120, max: 220 },
];

function SizesSection({ me }: { me: Me }) {
  const meta = useMeta();
  const { saving, fields, save } = useSave();
  const [sizes, setSizes] = useState<PreferredSizes>(me.sizes ?? {});
  const [body, setBody] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(me.bodyMeasurements ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])));
  const toggle = (group: keyof PreferredSizes, v: string) => setSizes((s) => ({ ...s, [group]: (s[group] ?? []).includes(v) ? (s[group] ?? []).filter((x) => x !== v) : [...(s[group] ?? []), v] }));
  const groups: Array<[keyof PreferredSizes, string, string[]]> = meta
    ? [
        ["clothing", "Одежда", meta.sizes.ALPHA],
        ["jeans", "Джинсы и брюки (талия, дюймы)", meta.sizes.JEANS_W],
        ["shoes", "Обувь (EU)", meta.sizes.SHOE_EU],
      ]
    : [];
  const submit = () => {
    const bodyMeasurements: Record<string, number> = {};
    for (const b of BODY) {
      const v = Number(body[b.key]?.replace(",", "."));
      if (body[b.key] && Number.isFinite(v)) bodyMeasurements[b.key] = v;
    }
    void save({ sizes, bodyMeasurements: Object.keys(bodyMeasurements).length ? bodyMeasurements : null }, "Размеры сохранены — подсказки обновятся на всех вещах");
  };
  return (
    <Section id="sizes" title="Мои размеры" hint="По ним на каждой вещи мы подскажем, подойдёт ли она, и включим фильтр «Мой размер» в поиске. Видны только вам.">
      <div className="flex flex-col gap-5">
        {groups.map(([key, label, options]) => (
          <fieldset key={key}>
            <legend className="mb-2 text-sm font-medium">{label}</legend>
            <div className="flex flex-wrap gap-2">
              {options.map((v) => (
                <Chip key={v} active={(sizes[key] ?? []).includes(v)} onClick={() => toggle(key, v)}>
                  {v}
                </Chip>
              ))}
            </div>
          </fieldset>
        ))}
        <div>
          <p className="text-sm font-medium">Замеры тела, см</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {BODY.map((b) => (
              <Field key={b.key} label={b.label} htmlFor={`body-${b.key}`} hint={b.hint} error={fields[`bodyMeasurements.${b.key}`] ? `От ${b.min} до ${b.max} см` : undefined}>
                <Input id={`body-${b.key}`} inputMode="decimal" value={body[b.key] ?? ""} onChange={(e) => setBody((s) => ({ ...s, [b.key]: e.target.value.replace(/[^\d.,]/g, "").slice(0, 5) }))} placeholder="—" />
              </Field>
            ))}
          </div>
        </div>
        <Button loading={saving} className="self-start" onClick={submit}>
          Сохранить размеры
        </Button>
      </div>
    </Section>
  );
}

/**
 * A number typed inside a sentence: no box, the type of the text around it but larger and bold, a dotted line under
 * it saying it can be changed (solid while typed in). As wide as its digits.
 */
function TierNumber({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <span className="inline-flex items-baseline">
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onFocus={(e) => e.currentTarget.select()}
        style={{ width: `${Math.max(1, value.length)}ch` }}
        className="tabular min-w-[1ch] appearance-none border-0 border-b-2 border-dotted border-ink/30 bg-transparent p-0 text-center font-display text-2xl font-bold text-ink caret-shu outline-none transition-colors hover:border-ink/60 focus:border-solid focus:border-shu"
      />
      {suffix && <span className="ml-0.5 font-display text-2xl font-bold">{suffix}</span>}
    </span>
  );
}

function BundleSection({ me }: { me: Me }) {
  const { saving, fields, save } = useSave();
  const [tiers, setTiers] = useState<Array<{ minItems: string; percent: string }>>(() => me.bundleDiscounts.map((t) => ({ minItems: String(t.minItems), percent: String(t.percent) })));
  const parsed: BundleTier[] = tiers.filter((t) => t.minItems && t.percent).map((t) => ({ minItems: Number(t.minItems), percent: Number(t.percent) }));
  const valid = parsed.every((t, i) => t.minItems >= 2 && t.minItems <= 10 && t.percent >= 1 && t.percent <= 50 && (i === 0 || (t.minItems > parsed[i - 1].minItems && t.percent > parsed[i - 1].percent)));
  const add = () => {
    const last = parsed.at(-1);
    setTiers((t) => [...t, { minItems: String(last ? last.minItems + 1 : 2), percent: String(last ? Math.min(50, last.percent + 5) : 10) }]);
  };
  return (
    <Section id="bundle" title="Скидка за комплект" hint="Покупатели, которые берут у вас несколько вещей сразу, получают скидку автоматически — в корзине и в запросе на покупку. Комплекты продаются быстрее.">
      <div className="flex flex-col gap-3">
        {tiers.map((t, i) => (
          // One sentence, its two numbers typed where they stand: «От 2 вещей — скидка 10 %».
          <div key={i} className="group flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg">
            <span>От</span>
            <TierNumber label="Количество вещей" value={t.minItems} onChange={(v) => setTiers((all) => all.map((x, j) => (j === i ? { ...x, minItems: v } : x)))} />
            <span>{plural(Number(t.minItems) || 0, "вещи", "вещей", "вещей")} — скидка</span>
            <TierNumber label="Скидка, %" value={t.percent} onChange={(v) => setTiers((all) => all.map((x, j) => (j === i ? { ...x, percent: v } : x)))} suffix="%" />
            <button type="button" aria-label="Удалить ступень" className="ml-2 text-sm text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setTiers((all) => all.filter((_, j) => j !== i))}>
              Удалить
            </button>
          </div>
        ))}
        {tiers.length < 3 && (
          <button type="button" className={clsx("self-start text-sm font-medium underline underline-offset-4", tiers.length ? "text-ink-2" : "text-ink")} onClick={add}>
            + {tiers.length ? "Добавить ступень" : "Включить скидку за комплект"}
          </button>
        )}
        {!valid && <p className="text-sm text-danger">От 2 до 10 вещей, скидка 1–50%; каждая следующая ступень — больше вещей и больше скидка.</p>}
        {fields.bundleDiscounts && <p className="text-sm text-danger">{fields.bundleDiscounts}</p>}
        {valid && parsed.length > 0 && <p className="text-sm text-ink-2">Покупатели увидят: «{tiersText(parsed)}»</p>}
        <Button loading={saving} disabled={!valid} className="mt-2 self-start" onClick={() => void save({ bundleDiscounts: parsed }, parsed.length ? "Скидка за комплект сохранена" : "Скидка за комплект отключена")}>
          Сохранить
        </Button>
      </div>
    </Section>
  );
}

/** Sign out and delete the account side by side; deletion is confirmed in a dialog by typing the nickname. */
function AccountActions({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (setOpen(false), setConfirm(""), setError(null));
  return (
    <div id="danger" className="rise flex scroll-mt-24 flex-wrap gap-3 border-t border-line pt-8">
      <Button variant="secondary" onClick={onLogout}>
        Выйти из аккаунта
      </Button>
      <Button variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        Удалить аккаунт
      </Button>
      <Modal open={open} onClose={close} title="Удалить аккаунт?">
        <p className="text-sm text-ink-2">Профиль, контакты, объявления, фото и видео, избранное, образы и статьи удалятся: с сайта — сразу, с сервера — в течение суток, из резервных копий — в течение 15 дней. Завершённые сделки и переписка останутся у второй стороны без вашего ника и без фото. Восстановить аккаунт нельзя.</p>
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("/users/me", { method: "DELETE", body: { confirm } });
              await refresh();
              toast("Аккаунт удалён");
              router.push("/");
            } catch (err) {
              setError(err instanceof ApiError ? (err.fields.confirm ?? err.message) : "Не удалось удалить аккаунт");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={`Введите ник @${me.username}, чтобы подтвердить`} htmlFor="delete-confirm" error={error ?? undefined}>
            <Input id="delete-confirm" autoComplete="off" spellCheck={false} autoCapitalize="none" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={error ?? undefined} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={confirm.replace(/^@/, "").toLowerCase() !== me.username.toLowerCase()}>
              Удалить навсегда
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
