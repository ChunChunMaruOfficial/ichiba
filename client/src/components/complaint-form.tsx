"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { TitleWithKanji } from "./sections";
import { Button, Chip, Field, Input, Textarea } from "./ui";
import { useSession } from "./session";

/** Must match TOPICS in server/src/complaints/complaints.ts. */
export const COMPLAINT_TOPICS = {
  DEAL: "Сделка",
  SELLER: "Продавец",
  ITEM: "Вещь",
  SITE: "Работа сайта",
  DATA: "Персональные данные",
  OTHER: "Другое",
} as const;
export type ComplaintTopic = keyof typeof COMPLAINT_TOPICS;

/** `email` null: not typed yet — a signed-in author's own address is used. */
const empty = { topic: "" as ComplaintTopic | "", about: "", text: "", name: "", email: null as string | null, website: "" };

/**
 * The complaint form (/complaint): a topic, what it is about, what happened, a name and the email the answer goes to.
 * After sending, the number of the complaint and where the answer will come.
 */
export function ComplaintForm() {
  const { me } = useSession();
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ number: number; email: string } | null>(null);
  const set = (p: Partial<typeof empty>) => setV((x) => ({ ...x, ...p }));
  // A signed-in author's email is where the answer goes unless they type another one.
  const email = v.email ?? me?.email ?? "";

  if (sent) {
    return (
      <div className="rounded-3xl bg-surface p-6 shadow-[var(--shadow-paper)] md:p-8" role="status">
        <TitleWithKanji kanji="受付">
          <h2 className="font-display text-2xl font-bold">Обращение № {sent.number} принято</h2>
        </TitleWithKanji>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Ответ придёт на <b className="font-semibold text-ink">{sent.email}</b> в течение 15 дней, обычно быстрее. Копию обращения с номером мы уже отправили туда же. Если письма нет, загляните в «Спам».
        </p>
        <Button
          variant="secondary"
          className="mt-6"
          onClick={() => {
            setSent(null);
            setV({ ...empty, name: v.name, email: v.email });
          }}
        >
          Написать ещё одно
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.topic) return setErrors({ topic: "Выберите тему" });
        setBusy(true);
        setErrors({});
        try {
          const r = await api<{ number: number }>("/complaints", { body: { ...v, email, about: v.about || null } });
          setSent({ number: r.number, email: email.trim() });
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err) {
          if (err instanceof ApiError) setErrors(Object.keys(err.fields).length ? err.fields : { _: err.message });
          else setErrors({ _: "Не получилось отправить. Проверьте интернет и попробуйте ещё раз." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Тема" required error={errors.topic}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Тема">
          {(Object.keys(COMPLAINT_TOPICS) as ComplaintTopic[]).map((t) => (
            <Chip key={t} active={v.topic === t} onClick={() => set({ topic: t })}>
              {COMPLAINT_TOPICS[t]}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="О чём речь" htmlFor="complaint-about" hint="Ссылка на вещь, ник продавца или номер сделки — если есть" error={errors.about}>
        <Input id="complaint-about" value={v.about} onChange={(e) => set({ about: e.target.value })} error={errors.about} maxLength={300} />
      </Field>
      <Field label="Что случилось" required htmlFor="complaint-text" hint="Что произошло, когда, и чего вы ждёте от нас или от продавца" error={errors.text}>
        <Textarea id="complaint-text" rows={6} value={v.text} onChange={(e) => set({ text: e.target.value })} error={errors.text} maxLength={4000} />
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Как к вам обращаться" required htmlFor="complaint-name" error={errors.name}>
          <Input id="complaint-name" autoComplete="name" value={v.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} />
        </Field>
        <Field label="Почта для ответа" required htmlFor="complaint-email" error={errors.email}>
          <Input id="complaint-email" type="email" autoComplete="email" value={email} onChange={(e) => set({ email: e.target.value })} error={errors.email} />
        </Field>
      </div>
      {/* Hidden from people, filled by bots: the server refuses a form with it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={v.website} onChange={(e) => set({ website: e.target.value })} />
      {errors._ && (
        <p className="text-sm text-danger" role="alert">
          {errors._}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <Button type="submit" size="lg" loading={busy} className="self-start">
          Отправить
        </Button>
        <p className="text-sm text-muted">
          Имя и почту используем только чтобы ответить.{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
            Политика конфиденциальности
          </Link>
        </p>
      </div>
    </form>
  );
}
