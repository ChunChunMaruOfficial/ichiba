"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Button, Field, Input, Modal } from "./ui";

type Step = "login" | "register" | "verify" | "reset" | "reset-confirm";
type SessionResult = { user: Me; isNew: boolean };

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
    AppleID?: { auth: { init: (o: object) => void; signIn: () => Promise<{ authorization: { id_token: string } }> } };
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
}

interface AuthModalProps {
  open: boolean;
  reason?: string;
  onClose: () => void;
  onSignedIn: (me: Me, isNew?: boolean) => void;
}

/** Login / Sign up / code / reset in one modal (frame 18). Mounted fresh on every open, so it always starts at "login". */
export function AuthModal(props: AuthModalProps) {
  return props.open ? <AuthForm {...props} /> : null;
}

function AuthForm({ open, reason, onClose, onSignedIn }: AuthModalProps) {
  const [step, setStep] = useState<Step>("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [terms, setTerms] = useState(false);
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [usernameHint, setUsernameHint] = useState<{ ok: boolean; text: string; suggestion?: string } | null>(null);
  const hint = step === "register" && username.length >= 3 ? usernameHint : null;
  const { data: providers } = useSWR<{ google: string | null; apple: string | null; devAnyCode?: boolean }>(open ? "/auth/providers" : null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Live username availability check (debounced).
  useEffect(() => {
    if (step !== "register" || username.length < 3) return;
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean; reason?: string; suggestion?: string }>(`/auth/username-available?u=${encodeURIComponent(username)}`).catch(() => null);
      if (!r) return;
      setUsernameHint(r.available ? { ok: true, text: `@${username.toLowerCase()} свободен` } : { ok: false, text: r.reason ?? "Ник занят", suggestion: r.suggestion });
    }, 350);
    return () => clearTimeout(t);
  }, [username, step]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields);
      } else setError("Что-то пошло не так. Повторите");
    } finally {
      setBusy(false);
    }
  };

  const finish = (r: SessionResult) => onSignedIn(r.user, r.isNew);

  const submitLogin = () =>
    run(async () => {
      const r = await api<SessionResult | { needsVerification: true }>("/auth/login", { body: { login, password } });
      if ("needsVerification" in r) {
        setStep("verify");
        setResendIn(60);
      } else finish(r);
    });

  const submitRegister = () =>
    run(async () => {
      await api("/auth/register", { body: { login, password, username, acceptTerms: terms } });
      setStep("verify");
      setResendIn(60);
    });

  const submitVerify = () => run(async () => finish(await api<SessionResult>("/auth/verify", { body: { login, code } })));

  const submitReset = () =>
    run(async () => {
      await api("/auth/reset/request", { body: { login } });
      setStep("reset-confirm");
      setResendIn(60);
    });

  const submitResetConfirm = () => run(async () => finish(await api<SessionResult>("/auth/reset/confirm", { body: { login, code, password } })));

  const resend = () =>
    run(async () => {
      await api("/auth/resend", { body: { login, purpose: step === "reset-confirm" ? "RESET" : "VERIFY" } });
      setResendIn(60);
    });

  const title =
    step === "register" ? "Создать аккаунт" : step === "verify" ? "Введите код" : step === "reset" || step === "reset-confirm" ? "Восстановить пароль" : "Войдите, чтобы продолжить";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {reason && (step === "login" || step === "register") && <p className="-mt-2 mb-5 text-sm text-muted">{reason}</p>}

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          ({ login: submitLogin, register: submitRegister, verify: submitVerify, reset: submitReset, "reset-confirm": submitResetConfirm })[step]();
        }}
      >
        {(step === "login" || step === "register" || step === "reset") && (
          <Field label="Email или телефон" htmlFor="auth-login" error={fields.login}>
            <Input id="auth-login" name="login" spellCheck={false} autoCapitalize="none" autoComplete="username" inputMode="email" value={login} onChange={(e) => setLogin(e.target.value)} error={fields.login} placeholder="you@mail.com или +375…" />
          </Field>
        )}

        {step === "register" && (
          <Field
            label="Ник"
            htmlFor="auth-username"
            error={fields.username ?? (hint && !hint.ok ? hint.text : undefined)}
            hint={hint?.ok ? hint.text : "Латиница, цифры и _ — так вас увидят покупатели"}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">@</span>
              <Input id="auth-username" name="username" spellCheck={false} autoCapitalize="none" className="pl-8" autoComplete="nickname" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} error={fields.username} />
            </div>
            {hint?.suggestion && (
              <button type="button" className="self-start text-sm text-accent underline-offset-4 hover:underline" onClick={() => setUsername(hint.suggestion!)}>
                Взять @{hint.suggestion}
              </button>
            )}
          </Field>
        )}

        {(step === "login" || step === "register" || step === "reset-confirm") && (
          <Field
            label={step === "reset-confirm" ? "Новый пароль" : "Пароль"}
            htmlFor="auth-password"
            error={fields.password}
            hint={step !== "login" ? "Минимум 8 символов" : undefined}
          >
            <div className="relative">
              <Input
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={step === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={fields.password}
                className="pr-24"
              />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-2" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "Скрыть" : "Показать"}
              </button>
            </div>
            {step !== "login" && password.length > 0 && <PasswordMeter value={password} />}
          </Field>
        )}

        {(step === "verify" || step === "reset-confirm") && (
          <Field label={`Код из ${login.includes("@") ? "письма" : "SMS"} на ${login}`} htmlFor="auth-code" error={fields.code}>
            <Input
              id="auth-code"
              name="code"
              spellCheck={false}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              error={fields.code}
              className="text-center text-2xl tracking-[0.5em]"
              placeholder="••••••"
            />
          </Field>
        )}

        {step === "register" && (
          <label className="flex items-start gap-3 text-sm text-ink-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>
              Принимаю <a className="underline" href="#">условия</a> и <a className="underline" href="#">политику конфиденциальности</a>
              {fields.acceptTerms && <span className="block text-danger">{fields.acceptTerms}</span>}
            </span>
          </label>
        )}

        {error && !Object.keys(fields).length && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" block loading={busy}>
          {{ login: "Войти", register: "Создать аккаунт", verify: "Подтвердить", reset: "Получить код", "reset-confirm": "Сохранить пароль" }[step]}
        </Button>

        {(step === "verify" || step === "reset-confirm") && providers?.devAnyCode && (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">Режим разработки: подойдёт любой код из 6 цифр, например 000000.</p>
        )}

        {(step === "verify" || step === "reset-confirm") && (
          <button type="button" disabled={resendIn > 0 || busy} onClick={resend} className="text-sm text-ink-2 disabled:text-muted">
            {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : "Отправить ещё раз"}
          </button>
        )}
      </form>

      {step === "login" && (
        <div className="mt-4 flex justify-between text-sm">
          <button className="font-medium text-accent hover:underline" onClick={() => setStep("register")}>
            Создать аккаунт
          </button>
          <button className="text-ink-2 hover:underline" onClick={() => setStep("reset")}>
            Забыли пароль?
          </button>
        </div>
      )}
      {(step === "register" || step === "reset") && (
        <button className="mt-4 text-sm text-ink-2 hover:underline" onClick={() => setStep("login")}>
          Уже есть аккаунт? Войти
        </button>
      )}

      {(step === "login" || step === "register") && (providers?.google || providers?.apple) && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            или
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex flex-col gap-3">
            {providers.google && <GoogleButton clientId={providers.google} onToken={(idToken) => run(async () => finish(await api<SessionResult>("/auth/google", { body: { idToken } })))} />}
            {providers.apple && (
              <AppleButton clientId={providers.apple} onToken={(idToken) => run(async () => finish(await api<SessionResult>("/auth/apple", { body: { idToken } })))} />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function PasswordMeter({ value }: { value: string }) {
  const score = [value.length >= 8, /[A-ZА-Я]/.test(value) && /[a-zа-я]/.test(value), /\d/.test(value), /[^\w]/.test(value) || value.length >= 12].filter(Boolean).length;
  const labels = ["Слабый", "Слабый", "Средний", "Хороший", "Надёжный"];
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < score ? (score < 2 ? "bg-danger" : score < 3 ? "bg-warn" : "bg-ok") : "bg-line"}`} />
        ))}
      </div>
      <span className="text-xs text-muted">{labels[score]}</span>
    </div>
  );
}

function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => {
    cb.current = onToken;
  });
  useEffect(() => {
    let cancelled = false;
    loadScript("https://accounts.google.com/gsi/client")
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => cb.current(r.credential) });
        window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: 360, locale: "ru" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  return <div ref={ref} className="flex min-h-11 justify-center" />;
}

function AppleButton({ clientId, onToken }: { clientId: string; onToken: (t: string) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/ru_RU/appleid.auth.js")
      .then(() => {
        window.AppleID?.auth.init({ clientId, scope: "email", redirectURI: window.location.origin, usePopup: true });
        setReady(true);
      })
      .catch(() => {});
  }, [clientId]);
  return (
    <Button
      variant="secondary"
      block
      disabled={!ready}
      onClick={async () => {
        const r = await window.AppleID?.auth.signIn().catch(() => null);
        if (r?.authorization.id_token) onToken(r.authorization.id_token);
      }}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
        <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.8-4.2ZM14 5.1c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
      </svg>
      Продолжить с Apple
    </Button>
  );
}
