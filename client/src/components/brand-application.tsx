"use client";

import useSWR from "swr";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "./toast";
import { Badge, Button, Chip, Field, Input, Textarea } from "./ui";
import { BrandSeal } from "./ui";

export interface BrandApplication {
  id: string;
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

const empty = { brandName: "", legalForm: "IP" as LegalForm, legalName: "", unp: "", contactName: "", email: "", phone: "", telegram: "", links: "", description: "" };

/**
 * Settings → «Статус бренда»: the form, then the application's state (on review, approved, declined with the
 * reason and a way to apply again). Approved brands get the «Бренд» seal on every item and on the profile.
 */
export function BrandSection({ Section }: { Section: React.ComponentType<{ id?: string; title: string; hint?: string; children: React.ReactNode }> }) {
  const { data, mutate } = useSWR<{ brand: { name: string; since: string } | null; application: BrandApplication | null }>("/brand-application");
  const toast = useToast();
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  const set = (p: Partial<typeof empty>) => setV((x) => ({ ...x, ...p }));
  const needsUnp = v.legalForm === "IP" || v.legalForm === "LLC";

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api("/brand-application", { body: { ...v, links: v.links.split(/[\s,]+/).filter(Boolean) } });
      toast("Заявка отправлена — мы ответим в уведомлениях");
      setAgain(false);
      await mutate();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        if (!Object.keys(e.fields).length) toast(e.message, { tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const a = data?.application;
  return (
    <Section id="brand" title="Статус бренда" hint="Для брендов и магазинов: на ваших вещах и в профиле появится печать «Бренд», покупатели сразу видят, что это не частный гардероб.">
      {!data ? null : data.brand ? (
        <div className="flex items-center gap-4 rounded-2xl bg-surface p-4">
          <BrandSeal />
          <p className="text-[15px]">
            <b>{data.brand.name}</b> — статус бренда подтверждён. Печать стоит на всех ваших вещах.
          </p>
        </div>
      ) : a && !again && a.status !== "APPROVED" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 text-[15px]">
          <p className="flex flex-wrap items-center gap-2">
            Заявка «{a.brandName}»
            {a.status === "PENDING" ? <Badge tone="warn">на рассмотрении</Badge> : <Badge tone="danger">отклонена</Badge>}
          </p>
          {a.status === "PENDING" && <p className="text-sm text-ink-2">Обычно отвечаем в течение пары дней. Решение придёт в уведомления.</p>}
          {a.status === "REJECTED" && (
            <>
              {a.adminNote && <p className="text-sm text-ink-2">Причина: {a.adminNote}</p>}
              <Button variant="secondary" className="self-start" onClick={() => (setV({ ...empty, ...Object.fromEntries(Object.entries(a).filter(([k]) => k in empty).map(([k, x]) => [k, Array.isArray(x) ? x.join(" ") : (x ?? "")])) }), setAgain(true))}>
                Подать заново
              </Button>
            </>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Название бренда" required htmlFor="brand-name" error={errors.brandName}>
            <Input id="brand-name" value={v.brandName} onChange={(e) => set({ brandName: e.target.value })} error={errors.brandName} placeholder="Например, MIRARWEAR" />
          </Field>
          <Field label="Форма" required>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LEGAL_FORM_LABEL) as LegalForm[]).map((f) => (
                <Chip key={f} active={v.legalForm === f} onClick={() => set({ legalForm: f })}>
                  {LEGAL_FORM_LABEL[f]}
                </Chip>
              ))}
            </div>
          </Field>
          {(needsUnp || v.legalForm === "SELF_EMPLOYED") && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="ФИО ИП или название организации" htmlFor="brand-legal" error={errors.legalName}>
                <Input id="brand-legal" value={v.legalName} onChange={(e) => set({ legalName: e.target.value })} error={errors.legalName} />
              </Field>
              <Field label="УНП" required={needsUnp} htmlFor="brand-unp" error={errors.unp}>
                <Input id="brand-unp" inputMode="numeric" value={v.unp} onChange={(e) => set({ unp: e.target.value.replace(/\D/g, "").slice(0, 9) })} error={errors.unp} placeholder="9 цифр" />
              </Field>
            </div>
          )}
          <Field label="Контактное лицо" required htmlFor="brand-contact" error={errors.contactName}>
            <Input id="brand-contact" value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} error={errors.contactName} placeholder="Как к вам обращаться" />
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="Почта" htmlFor="brand-email" error={errors.email}>
              <Input id="brand-email" type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} error={errors.email} />
            </Field>
            <Field label="Телефон" htmlFor="brand-phone" error={errors.phone}>
              <Input id="brand-phone" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} error={errors.phone} placeholder="+375…" />
            </Field>
            <Field label="Telegram" htmlFor="brand-tg" error={errors.telegram}>
              <Input id="brand-tg" value={v.telegram} onChange={(e) => set({ telegram: e.target.value })} error={errors.telegram} placeholder="@ник" />
            </Field>
          </div>
          <Field label="Ссылки" htmlFor="brand-links" hint="Сайт, Instagram, Telegram-канал — через пробел" error={errors.links}>
            <Input id="brand-links" value={v.links} onChange={(e) => set({ links: e.target.value })} error={errors.links} placeholder="https://t.me/…" />
          </Field>
          <Field label="О бренде" required htmlFor="brand-about" error={errors.description} hint="Что производите или продаёте, с какого года, где шьёте">
            <Textarea id="brand-about" rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} />
          </Field>
          <Button type="submit" loading={busy} className="self-start">
            Отправить заявку
          </Button>
        </form>
      )}
    </Section>
  );
}
