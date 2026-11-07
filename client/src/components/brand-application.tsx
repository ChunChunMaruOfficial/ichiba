"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useToast } from "./toast";
import { Badge, BrandSeal, Button, ButtonLink, Chip, Field, Input, Spinner, Textarea } from "./ui";

export interface BrandApplication {
  id: string;
  /** BRAND: the «Бренд» status; CATALOG: a seller of others' original items asks for the main catalogue. */
  kind: "BRAND" | "CATALOG";
  brandName: string;
  legalForm: LegalForm;
  legalName: string | null;
  unp: string | null;
  contactName: string;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  links: string[];
  description: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export type LegalForm = "IP" | "LLC" | "SELF_EMPLOYED" | "PERSON";
export const LEGAL_FORM_LABEL: Record<LegalForm, string> = {
  IP: "ИП",
  LLC: "Организация (ООО, ЧУП…)",
  SELF_EMPLOYED: "Самозанятый / ремесленник",
  PERSON: "Пока без регистрации",
};

type Kind = BrandApplication["kind"];
interface Mine {
  brand: { name: string; since: string } | null;
  catalog: { since: string } | null;
  application: BrandApplication | null;
}

const KINDS: Array<{ kind: Kind; seal: string; title: string; who: string }> = [
  { kind: "BRAND", seal: "銘", title: "Бренд", who: "Шьёте или производите под своим именем" },
  { kind: "CATALOG", seal: "正", title: "Магазин оригиналов", who: "Продаёте новые оригинальные вещи других марок" },
];

const date = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

/**
 * The brand's form (/sellers/apply), for a signed-in account: who they are, the name, the social network or site the
 * admin checks them by, an email for the answer, a few words about them and, if they have them, the legal details.
 * Above it, where the last application stands. The admin reviews it in /admin/brands (server: brand-applications.ts).
 */
export function BrandApplicationPage({ me, initialKind }: { me: Me; initialKind: Kind }) {
  const { data, mutate } = useSWR<Mine>("/brand-application");
  const [again, setAgain] = useState(false);

  if (!data) {
    return (
      <div className="flex justify-center py-16 text-muted">
        <Spinner />
      </div>
    );
  }
  const a = data.application;

  if (data.brand) {
    return (
      <Card tone="ok">
        <div className="flex items-center gap-4">
          <BrandSeal />
          <div>
            <p className="text-lg font-semibold">«{data.brand.name}» — бренд на ichiba</p>
            <p className="mt-1 text-[15px] text-ink-2">Печать «Бренд» стоит на профиле и всех вещах с {date(data.brand.since)}.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href="/sell">Выставить вещь</ButtonLink>
          <ButtonLink href={`/u/${me.username}`} variant="secondary">
            Мой профиль
          </ButtonLink>
        </div>
      </Card>
    );
  }

  if (a?.status === "PENDING") {
    return (
      <Card tone="ai">
        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          Анкета «{a.brandName}» <Badge tone="ai">на проверке</Badge>
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Отправлена {date(a.createdAt)}. Обычно отвечаем за пару дней — ответ придёт на {a.email ?? "почту"} и в уведомления на сайте.
        </p>
      </Card>
    );
  }

  // A shop already in the catalogue may still ask for the «Бренд» seal; a declined one sees why and writes again.
  const catalogOnly = !!data.catalog && !again;
  if (catalogOnly) {
    return (
      <Card tone="ok">
        <p className="text-lg font-semibold">Ваш магазин в основном каталоге</p>
        <p className="mt-1 text-[15px] text-ink-2">Новые вещи с биркой показываются там с {date(data.catalog!.since)}, поношенные — на вторичке.</p>
        <Button variant="secondary" className="mt-4" onClick={() => setAgain(true)}>
          Анкета на статус бренда
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {a?.status === "REJECTED" && (
        <Card tone="warn">
          <p className="text-lg font-semibold">Анкету «{a.brandName}» пока не одобрили</p>
          {a.adminNote && <p className="mt-1 text-[15px] text-ink-2">Причина: {a.adminNote}</p>}
          <p className="mt-1 text-sm text-ink-2">Поправьте анкету ниже и отправьте снова.</p>
        </Card>
      )}
      <Form me={me} previous={a} initialKind={data.catalog ? "BRAND" : initialKind} lockKind={!!data.catalog} onSent={() => void mutate()} />
    </div>
  );
}

function Card({ tone, children }: { tone: "ok" | "ai" | "warn"; children: React.ReactNode }) {
  return <div className={clsx("rounded-[28px] p-6 md:p-7", tone === "ok" ? "bg-ok-soft" : tone === "ai" ? "bg-ai-soft" : "bg-warn-soft")}>{children}</div>;
}

function Form({ me, previous, initialKind, lockKind, onSent }: { me: Me; previous: BrandApplication | null; initialKind: Kind; lockKind: boolean; onSent: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(() => ({
    kind: lockKind ? "BRAND" : (previous?.kind ?? initialKind),
    brandName: previous?.brandName ?? "",
    links: previous?.links.length ? previous.links : [""],
    email: previous?.email ?? me.notifyEmail ?? me.email ?? "",
    contactName: previous?.contactName ?? "",
    phone: previous?.phone ?? "",
    telegram: previous?.telegram ?? "",
    description: previous?.description ?? "",
    legalForm: previous?.legalForm ?? ("PERSON" as LegalForm),
    legalName: previous?.legalName ?? "",
    unp: previous?.unp ?? "",
  }));
  const [legal, setLegal] = useState(!!previous && previous.legalForm !== "PERSON");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const shop = v.kind === "CATALOG";
  const needsUnp = v.legalForm === "IP" || v.legalForm === "LLC";
  const setLink = (i: number, value: string) => set({ links: v.links.map((l, j) => (j === i ? value : l)) });

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api("/brand-application", { body: { ...v, links: v.links.map((l) => l.trim()).filter(Boolean) } });
      toast("Анкета отправлена — ответ придёт на почту");
      window.scrollTo({ top: 0, behavior: "smooth" });
      onSent();
    } catch (e) {
      if (e instanceof ApiError) {
        // Zod reports a bad link as links.0 — shown under the links block.
        const fields = Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k.startsWith("links") ? "links" : k, m]));
        setErrors(fields);
        if (fields.unp || fields.legalName) setLegal(true);
        toast(Object.keys(fields).length ? "Проверьте отмеченные поля" : e.message, { tone: "error" });
      } else toast("Не удалось отправить анкету", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-8 rounded-[28px] bg-surface p-5 shadow-[var(--shadow-paper)] md:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!lockKind && (
        <fieldset className="min-w-0">
          <legend className="mb-3 text-sm font-medium text-ink-2">Кто вы</legend>
          <div role="radiogroup" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={v.kind === k.kind}
                onClick={() => set({ kind: k.kind })}
                className={clsx(
                  "flex items-start gap-4 rounded-2xl p-4 text-left transition-shadow",
                  v.kind === k.kind ? "bg-paper shadow-[inset_0_0_0_2px_var(--ink)]" : "bg-paper shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink)]",
                )}
              >
                <span aria-hidden className="font-brush text-3xl leading-none text-shu">
                  {k.seal}
                </span>
                <span>
                  <span className="block font-semibold">{k.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-2">{k.who}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <Field label={shop ? "Название магазина" : "Название бренда"} required htmlFor="ba-name" error={errors.brandName}>
        <Input id="ba-name" value={v.brandName} onChange={(e) => set({ brandName: e.target.value })} error={errors.brandName} placeholder={shop ? "Например, ne net store" : "Например, MIRARWEAR"} maxLength={60} />
      </Field>

      {/* The one thing that must be there: the admin opens these to see the brand is real. */}
      <div className="rounded-2xl bg-kraft/40 p-4 md:p-5">
        <p className="font-semibold">
          Соцсеть или сайт <span className="text-danger">★</span>
        </p>
        <p className="mt-0.5 text-sm text-ink-2">Instagram, Telegram-канал, сайт — по ним мы проверяем {shop ? "магазин" : "бренд"}.</p>
        <div className="mt-3 flex flex-col gap-2">
          {v.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Ссылка ${i + 1}`}
                value={l}
                onChange={(e) => setLink(i, e.target.value)}
                placeholder={i === 0 ? "instagram.com/вашбренд" : "t.me/канал или сайт"}
                inputMode="url"
                autoCapitalize="off"
                error={i === 0 ? errors.links : undefined}
                className="flex-1"
              />
              {v.links.length > 1 && (
                <Button type="button" variant="ghost" aria-label="Убрать ссылку" onClick={() => set({ links: v.links.filter((_, j) => j !== i) })}>
                  ✕
                </Button>
              )}
            </div>
          ))}
        </div>
        {errors.links && <p className="mt-2 text-sm text-danger">{errors.links}</p>}
        {v.links.length < 5 && (
          <button type="button" onClick={() => set({ links: [...v.links, ""] })} className="mt-3 text-sm font-medium text-indigo hover:underline">
            + ещё ссылка
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Почта для ответа" required htmlFor="ba-email" error={errors.email} hint="Сюда придёт решение по анкете">
          <Input id="ba-email" type="email" autoComplete="email" value={v.email} onChange={(e) => set({ email: e.target.value })} error={errors.email} />
        </Field>
        <Field label="Контактное лицо" required htmlFor="ba-contact" error={errors.contactName}>
          <Input id="ba-contact" autoComplete="name" value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} error={errors.contactName} placeholder="Как к вам обращаться" />
        </Field>
        <Field label="Телефон" htmlFor="ba-phone" error={errors.phone}>
          <Input id="ba-phone" type="tel" autoComplete="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} error={errors.phone} placeholder="+375…" />
        </Field>
        <Field label="Telegram" htmlFor="ba-tg" error={errors.telegram}>
          <Input id="ba-tg" value={v.telegram} onChange={(e) => set({ telegram: e.target.value })} error={errors.telegram} placeholder="@ник" autoCapitalize="off" />
        </Field>
      </div>

      <Field
        label={shop ? "О магазине" : "О бренде"}
        required
        htmlFor="ba-about"
        error={errors.description}
        hint={shop ? "Какие марки продаёте, откуда товар и чем подтверждаете оригинальность" : "Что шьёте или производите, с какого года, где"}
      >
        <Textarea id="ba-about" rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} maxLength={2000} />
      </Field>

      <div>
        <button type="button" aria-expanded={legal} onClick={() => setLegal((x) => !x)} className="text-sm font-medium text-ink-2 underline underline-offset-4 hover:text-ink">
          {legal ? "Скрыть юридические данные" : "Юридические данные — если есть"}
        </button>
        {legal && (
          <div className="mt-4 flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LEGAL_FORM_LABEL) as LegalForm[]).map((f) => (
                <Chip key={f} active={v.legalForm === f} onClick={() => set({ legalForm: f })}>
                  {LEGAL_FORM_LABEL[f]}
                </Chip>
              ))}
            </div>
            {v.legalForm !== "PERSON" && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="ФИО ИП или название организации" htmlFor="ba-legal" error={errors.legalName}>
                  <Input id="ba-legal" value={v.legalName} onChange={(e) => set({ legalName: e.target.value })} error={errors.legalName} />
                </Field>
                <Field label="УНП" required={needsUnp} htmlFor="ba-unp" error={errors.unp}>
                  <Input id="ba-unp" inputMode="numeric" value={v.unp} onChange={(e) => set({ unp: e.target.value.replace(/\D/g, "").slice(0, 9) })} error={errors.unp} placeholder="9 цифр" />
                </Field>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-2">
          Проверим за пару дней. После одобрения на профиле и вещах появится печать «Бренд».{" "}
          <Link href="/rules" className="underline underline-offset-4">
            Правила
          </Link>
        </p>
        <Button type="submit" size="lg" loading={busy} className="shrink-0">
          Отправить анкету
        </Button>
      </div>
    </form>
  );
}
