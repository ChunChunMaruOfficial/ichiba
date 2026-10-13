"use client";

import { TitleWithKanji } from "@/components/sections";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { tiersText } from "@/components/trust";
import { Button, Chip, Field, Input, Modal, Spinner, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { uploadPhoto } from "@/lib/upload";
import { DARK_THEME_ENABLED, getTheme, setTheme, type ThemeChoice } from "@/lib/theme";
import type { BodyMeasurements, BundleTier, Me, PreferredSizes } from "@/lib/types";
import { Select } from "@/components/select";

export default function SettingsPage() {
  return <RequireAuth reason="чтобы открыть настройки">{(me) => <Settings me={me} />}</RequireAuth>;
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
  // Links like /settings#sizes land on the section once the page (rendered after the session loads) exists.
  useEffect(() => {
    if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView({ block: "start" });
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
          ["profile", "個", "Профиль"],
          ["sizes", "寸", "Мои размеры"],
          ...(me.isSeller ? ([["bundle", "組", "Скидка за комплект"]] as const) : []),
          ["danger", "出", "Выход и удаление"],
        ]}
      />
      <div className="flex min-w-0 max-w-3xl flex-col gap-10">
      <ProfileSection me={me} />
      <SizesSection me={me} />
      {me.isSeller && <BundleSection me={me} />}
      {DARK_THEME_ENABLED && <ThemeSection />}
      {/* The only place to sign out (it is not in the account menu) and to delete the account. */}
      <AccountActions
        me={me}
        onLogout={async () => {
          await logout();
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

/** «Васи» (light) / «Ёру» (dark) / as the device. Stored on this device only. */
function ThemeSection() {
  // Settings render only on the client (after the session loads), so localStorage is there.
  const [theme, setChoice] = useState<ThemeChoice>(getTheme);
  const options: Array<[ThemeChoice, string, string]> = [
    ["system", "Как на устройстве", "Светлая днём, тёмная ночью — если так настроен телефон"],
    ["light", "Светлая", "Бумага васи и тушь"],
    ["dark", "Тёмная", "Ночная тушь, тёплая, не серая"],
  ];
  return (
    <Section title="Оформление" hint="Сохраняется на этом устройстве">
      <div role="radiogroup" aria-label="Тема" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map(([value, label, hint]) => (
          <button
            key={value}
            role="radio"
            aria-checked={theme === value}
            onClick={() => {
              setTheme(value);
              setChoice(value);
            }}
            className={clsx(
              "flex flex-col items-start gap-1 rounded-2xl p-3.5 text-left transition-shadow",
              theme === value ? "bg-indigo-soft shadow-[inset_0_0_0_1.5px_var(--indigo)]" : "bg-paper shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--line-control)]",
            )}
          >
            <span className={clsx("text-[15px] font-semibold", theme === value && "text-indigo")}>{label}</span>
            <span className="text-xs text-ink-2">{hint}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Profile photo: shown on the seller card of every item and on wardrobe cards. */
function AvatarPicker({ me }: { me: Me }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const set = async (avatarId: string | null, done: string) => {
    await api("/users/me", { method: "PATCH", body: { avatarId } });
    toast(done);
    await refresh();
  };
  return (
    <div className="flex items-center gap-4">
      <Avatar username={me.username} avatar={me.avatar} ring className="size-20" />
      <div className="flex flex-wrap gap-2">
        <label className={clsx("btn-wa btn-wa-paper inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold", busy && "pointer-events-none opacity-60")}>
          {busy && <Spinner />} {me.avatar ? "Сменить фото" : "Добавить фото"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              try {
                const photo = await uploadPhoto(file, undefined, undefined, "avatar");
                await set(photo.id, "Фото профиля обновлено");
              } catch (err) {
                toast(err instanceof ApiError ? err.message : "Не получилось загрузить фото", { tone: "error" });
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {me.avatar && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void set(null, "Фото убрано")}>
            Убрать
          </Button>
        )}
      </div>
    </div>
  );
}

function ProfileSection({ me }: { me: Me }) {
  const meta = useMeta();
  const { saving, fields, save } = useSave();
  const [city, setCity] = useState(me.city ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  return (
    <Section id="profile" title="Профиль">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ city: city || null, bio: bio || null, phone: phone || null });
        }}
      >
        <AvatarPicker me={me} />
        <Field label="Город" htmlFor="city" hint="Подставляется в новые вещи">
          <Select id="city" value={city} onChange={setCity} options={[{ value: "", label: "Не указан" }, ...(meta?.cities ?? []).map((c) => ({ value: c, label: c }))]} />
        </Field>
        <Field label="О себе" htmlFor="bio" error={fields.bio} hint={`${bio.length}/160 · видно в гардеробе`}>
          <Textarea id="bio" maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} className="min-h-20" />
        </Field>
        <Field label="Телефон" htmlFor="phone" hint="Покажем другой стороне только после подтверждения сделки">
          <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 …" />
        </Field>
        <Button type="submit" loading={saving} className="self-start">
          Сохранить
        </Button>
      </form>
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
          <div key={i} className="flex flex-wrap items-center gap-2 text-[15px]">
            <span>От</span>
            <Input aria-label="Количество вещей" inputMode="numeric" value={t.minItems} onChange={(e) => setTiers((all) => all.map((x, j) => (j === i ? { ...x, minItems: e.target.value.replace(/\D/g, "").slice(0, 2) } : x)))} className="h-10 w-16 text-center" />
            <span>вещей — скидка</span>
            <Input aria-label="Скидка, %" inputMode="numeric" value={t.percent} onChange={(e) => setTiers((all) => all.map((x, j) => (j === i ? { ...x, percent: e.target.value.replace(/\D/g, "").slice(0, 2) } : x)))} className="h-10 w-16 text-center" />
            <span>%</span>
            <button type="button" aria-label="Удалить ступень" className="ml-1 text-sm text-ink-2 underline underline-offset-4" onClick={() => setTiers((all) => all.filter((_, j) => j !== i))}>
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
        <p className="text-sm text-ink-2">Профиль, контакты, объявления и избранное удалятся сразу. Завершённые сделки и переписка останутся у второй стороны без вашего ника. Восстановить аккаунт нельзя.</p>
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
