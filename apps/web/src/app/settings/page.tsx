"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { tiersText } from "@/components/trust";
import { Button, Chip, Field, Input, inputClass, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { BodyMeasurements, BundleTier, Me, PreferredSizes } from "@/lib/types";

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
    <section id={id} className="scroll-mt-24 rounded-3xl bg-surface p-5 md:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 md:py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Настройки</h1>
        <p className="mt-1 text-muted">
          @{me.username}
          {me.email ? ` · ${me.email}` : ""}
        </p>
      </div>
      <ProfileSection me={me} />
      <SizesSection me={me} />
      <BundleSection me={me} />
      <EmailSection me={me} />
      <DangerSection me={me} />
      <p className="text-sm text-ink-2">
        Как мы обращаемся с вашими данными — в{" "}
        <Link href="/privacy" className="font-medium text-ink underline underline-offset-4">
          Политике конфиденциальности
        </Link>
        .
      </p>
      <button
        className="self-start text-sm text-ink-2 underline underline-offset-4 hover:text-ink"
        onClick={async () => {
          await logout();
          router.push("/");
        }}
      >
        Выйти из аккаунта
      </button>
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
    <Section title="Профиль">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ city: city || null, bio: bio || null, phone: phone || null });
        }}
      >
        <Field label="Город" htmlFor="city" hint="Подставляется в новые вещи">
          <select id="city" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass()}>
            <option value="">Не указан</option>
            {meta?.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
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
          <p className="mb-3 text-xs text-muted">Необязательно, но с ними подсказка точнее: сравним с замерами вещи с учётом свободы посадки.</p>
          <div className="grid gap-4 sm:grid-cols-2">
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
    <Section title="Скидка за комплект" hint="Покупатели, которые берут у вас несколько вещей сразу, получают скидку автоматически — в корзине и в запросе на покупку. Комплекты продаются быстрее.">
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

function EmailSection({ me }: { me: Me }) {
  const { saving, save } = useSave();
  const [deals, setDeals] = useState(me.emailPrefs.deals);
  return (
    <Section title="Письма на почту" hint="Коды подтверждения и восстановления пароля приходят всегда.">
      {!me.email ? (
        <p className="text-sm text-ink-2">Почта не указана — уведомления приходят только на сайте.</p>
      ) : (
        <>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="font-medium">События по сделкам</span>
              <span className="block text-sm text-ink-2">Новый запрос, подтверждение, передача, завершение, выигрыш в аукционе — на {me.email}</span>
              {!me.emailVerified && <span className="mt-1 block text-sm text-warn">Почта не подтверждена — письма придут после подтверждения</span>}
            </span>
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
              checked={deals}
              disabled={saving}
              onChange={async (e) => {
                const v = e.target.checked;
                setDeals(v);
                if (!(await save({ emailPrefs: { deals: v } }, v ? "Письма о сделках включены" : "Письма о сделках отключены"))) setDeals(!v);
              }}
            />
          </label>
        </>
      )}
    </Section>
  );
}

function DangerSection({ me }: { me: Me }) {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section id="danger" title="Удаление аккаунта" hint="Ник, телефон, почта, профиль, объявления в продаже, избранное и подписки будут удалены сразу. Завершённые сделки, переписка и отзывы останутся у второй стороны без вашего ника и контактов. Восстановить аккаунт будет нельзя.">
      {!open ? (
        <Button variant="secondary" className="text-danger" onClick={() => setOpen(true)}>
          Удалить аккаунт
        </Button>
      ) : (
        <form
          className="flex flex-col gap-3"
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
            <Button type="submit" loading={busy} disabled={confirm.replace(/^@/, "").toLowerCase() !== me.username.toLowerCase()} className="bg-danger hover:bg-danger/90">
              Удалить навсегда
            </Button>
            <Button type="button" variant="ghost" onClick={() => (setOpen(false), setConfirm(""), setError(null))}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
