"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Badge, Button, Field, Input } from "./ui";

/** What lands in the inbox (server: mail/templates NOTIFY_EMAIL_TYPES); the rest stays in 🔔 on the site. */
const WHAT = ["Хотят купить", "Предложения цены", "Итоги аукционов", "Отзывы", "Споры", "Решения модерации"];

type Start = { bound: true } | { bound: false; target: string; resendIn: number };

/**
 * Settings → «Уведомления на почту» for sellers and brands: one address, proven by a 6-digit code sent there.
 * The confirmed sign-in address is bound in one tap. Steps: the address → the code → bound (change or unbind).
 */
export function NotifyEmailSection({ me, Section }: { me: Me; Section: React.ComponentType<{ id?: string; title: string; hint?: string; children: React.ReactNode }> }) {
  const { refresh } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState(!me.notifyEmail);
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState<"send" | "login" | "code" | "unbind" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const fail = (e: unknown, field?: string) => {
    if (e instanceof ApiError) {
      if (typeof e.data.resendIn === "number") setResendIn(e.data.resendIn);
      const fields = field && !Object.keys(e.fields).length ? { [field]: e.message } : e.fields;
      setErrors(fields);
      if (!Object.keys(fields).length) toast(e.message, { tone: "error" });
    } else toast("Нет связи — попробуйте ещё раз", { tone: "error" });
  };

  const bound = async (address: string) => {
    await refresh();
    setEditing(false);
    setTarget(null);
    setEmail("");
    setCode("");
    toast(`Готово — уведомления будут приходить на ${address}`);
  };

  const send = async (address: string, kind: "send" | "login" = "send") => {
    setBusy(kind);
    setErrors({});
    try {
      const r = await api<Start>("/users/me/notify-email", { body: { email: address } });
      if (r.bound) return void (await bound(address));
      setTarget(r.target);
      setCode("");
      setResendIn(r.resendIn);
      requestAnimationFrame(() => codeInput.current?.focus());
    } catch (e) {
      fail(e, "email");
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (value: string) => {
    if (!target) return;
    setBusy("code");
    setErrors({});
    try {
      await api("/users/me/notify-email/confirm", { body: { email: target, code: value } });
      await bound(target);
    } catch (e) {
      setCode("");
      fail(e, "code");
      requestAnimationFrame(() => codeInput.current?.focus());
    } finally {
      setBusy(null);
    }
  };

  const unbind = async () => {
    setBusy("unbind");
    try {
      await api("/users/me/notify-email", { method: "DELETE" });
      await refresh();
      setEditing(true);
      toast("Почта отвязана — уведомления остаются на сайте");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  // The sign-in address, already confirmed: offered as a one-tap choice unless it is the bound one.
  const loginEmail = me.email && me.emailVerified && me.email !== me.notifyEmail ? me.email : null;

  return (
    <Section id="notify" title="Уведомления на почту" hint="Привяжите одну почту — и узнавайте о покупателях сразу, даже когда сайт закрыт.">
      {me.notifyEmail && !editing ? (
        <div className="rise flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--line-strong)] sm:p-5">
          <div className="flex items-center gap-4">
            <Stamp />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                Письма приходят на <Badge tone="ok">подтверждена</Badge>
              </p>
              <p className="truncate text-lg font-semibold" title={me.notifyEmail}>
                {me.notifyEmail}
              </p>
            </div>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Что приходит на почту">
            {WHAT.map((w) => (
              <li key={w}>
                <Badge tone="muted">{w}</Badge>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => (setEditing(true), setErrors({}))}>
              Сменить почту
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" loading={busy === "unbind"} onClick={() => void unbind()}>
              Отвязать
            </Button>
          </div>
        </div>
      ) : target ? (
        <form
          className="rise flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) void confirm(code);
          }}
        >
          <p className="text-[15px] text-ink-2">
            Отправили код на <b className="font-semibold text-ink">{target}</b>.{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => (setTarget(null), setErrors({}))}>
              Изменить
            </button>
          </p>
          <Field label="Код из 6 цифр" htmlFor="notify-code" error={errors.code}>
            <Input
              ref={codeInput}
              id="notify-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={6}
              value={code}
              disabled={busy === "code"}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                // Six digits typed or pasted → check right away.
                if (v.length === 6 && !busy) void confirm(v);
              }}
              error={errors.code}
              className="tabular h-14 max-w-64 text-center text-2xl tracking-[0.5em]"
              placeholder="••••••"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" loading={busy === "code"} disabled={code.length < 6}>
              Подтвердить
            </Button>
            <button type="button" disabled={resendIn > 0 || !!busy} onClick={() => void send(target)} className="text-sm text-ink-2 underline-offset-4 enabled:hover:underline disabled:text-muted">
              {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : "Отправить код ещё раз"}
            </button>
          </div>
          <p className="-mt-1 text-xs text-muted">Письма нет? Загляните в «Спам» и отметьте письмо как «Не спам» — тогда уведомления будут приходить во «Входящие».</p>
        </form>
      ) : (
        <div className="rise flex flex-col gap-4">
          {!me.notifyEmail && (
            <div className="flex items-start gap-4 rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--line-strong)]">
              <Stamp muted />
              <p className="text-[15px] text-ink-2">
                Сейчас уведомления только на сайте. На почту будут приходить: <span className="text-ink">{WHAT.join(", ").toLowerCase()}</span>.
              </p>
            </div>
          )}
          {loginEmail && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void send(loginEmail, "login")}
              className={clsx(
                "group flex items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-3 text-left shadow-[inset_0_0_0_1px_var(--line-strong)] transition-shadow hover:shadow-[inset_0_0_0_1.5px_var(--indigo)] disabled:opacity-60",
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm text-ink-2">Почта, с которой вы входите — без кода</span>
                <span className="block truncate font-semibold">{loginEmail}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-indigo">{busy === "login" ? "Привязываем…" : "Использовать →"}</span>
            </button>
          )}
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              void send(email.trim());
            }}
          >
            <div className="min-w-0 flex-1">
              <Field label={loginEmail ? "Или другая почта" : "Почта для уведомлений"} htmlFor="notify-email" error={errors.email}>
                <Input
                  id="notify-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={errors.email}
                  placeholder="shop@example.com"
                />
              </Field>
            </div>
            <Button type="submit" loading={busy === "send"} disabled={!email.includes("@") || !!busy} className="sm:mt-[30px]">
              Получить код
            </Button>
          </form>
          {me.notifyEmail && (
            <button type="button" className="self-start text-sm text-ink-2 underline underline-offset-4" onClick={() => (setEditing(false), setErrors({}))}>
              Оставить {me.notifyEmail}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

/** 便 («весточка») pressed like a postage seal: cinnabar when mail flows, a faint outline while it doesn't. */
function Stamp({ muted }: { muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "grid size-12 shrink-0 -rotate-6 place-items-center rounded-full font-brush text-2xl leading-none",
        muted ? "text-shu/70 shadow-[inset_0_0_0_1.5px_currentColor]" : "bg-shu text-paper shadow-[0_2px_0_rgb(0_0_0/0.08)]",
      )}
    >
      便
    </span>
  );
}
