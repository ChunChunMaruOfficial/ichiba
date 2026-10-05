"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Button, Field, Input, Modal } from "./ui";

/**
 * Sign-in and sign-up in one flow, the way Avito, Kufar and Vinted do it:
 *   1. Google — or a phone / email → we send a one-time code (no password to invent);
 *   2. the code (autofill from SMS on phones);
 *   3. only for new people: a nickname + consent to personal data processing → account created.
 * Password sign-in stays available for accounts that have a password.
 */
type Step = "start" | "code" | "profile" | "password" | "reset" | "reset-confirm";
type SessionResult = { user: Me; isNew: boolean };
type Signup = { token: string; contact: string; suggestion: string };

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
    AppleID?: { auth: { init: (o: object) => void; signIn: () => Promise<{ authorization: { id_token: string } }> } };
  }
}

/** One promise per script: a second caller waits for the same load instead of resolving before it finishes. */
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string) {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => (scripts.delete(src), reject(new Error(src)));
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

const isEmail = (v: string) => v.includes("@");
/** Pretty-prints a Belarusian number: +375 29 123-45-67. */
const prettyPhone = (v: string) => {
  const m = v.match(/^\+375(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+375 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : v;
};

interface AuthModalProps {
  open: boolean;
  reason?: string;
  onClose: () => void;
  onSignedIn: (me: Me, isNew?: boolean) => void;
}

/** Mounted fresh on every open, so it always starts at the first step. */
export function AuthModal(props: AuthModalProps) {
  return props.open ? <AuthForm {...props} /> : null;
}

function AuthForm({ open, reason, onClose, onSignedIn }: AuthModalProps) {
  const [step, setStep] = useState<Step>("start");
  const [login, setLogin] = useState("");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signup, setSignup] = useState<Signup | null>(null);
  const [username, setUsername] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [usernameHint, setUsernameHint] = useState<{ ok: boolean; text: string; suggestion?: string } | null>(null);
  const { data: providers } = useSWR<{ google: string | null; apple: string | null; devAnyCode?: boolean }>(open ? "/auth/providers" : null);
  const codeInput = useRef<HTMLInputElement>(null);
  const hint = step === "profile" && username.length >= 3 ? usernameHint : null;
  const byEmail = isEmail(target || login);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Live nickname availability (debounced).
  useEffect(() => {
    if (step !== "profile" || username.length < 3) return;
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean; reason?: string; suggestion?: string }>(`/auth/username-available?u=${encodeURIComponent(username)}`).catch(() => null);
      if (r) setUsernameHint(r.available ? { ok: true, text: `@${username.toLowerCase()} свободен` } : { ok: false, text: r.reason ?? "Ник занят", suggestion: r.suggestion });
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
        if (typeof e.data.resendIn === "number") setResendIn(e.data.resendIn);
        if (e.code === "SIGNUP_EXPIRED") setStep("start");
      } else setError("Что-то пошло не так. Повторите");
    } finally {
      setBusy(false);
    }
  };

  const finish = (r: SessionResult) => onSignedIn(r.user, r.isNew);
  const toProfile = (s: Signup) => {
    setSignup(s);
    setUsername(s.suggestion);
    setStep("profile");
  };
  /** Session or "new person" — the same handling for codes and Google. */
  const handle = (r: SessionResult | { signup: Signup }) => ("signup" in r ? toProfile(r.signup) : finish(r));

  const sendCode = () =>
    run(async () => {
      const r = await api<{ target: string; resendIn: number }>("/auth/start", { body: { login } });
      setTarget(r.target);
      setCode("");
      setResendIn(r.resendIn);
      setStep("code");
    });

  const checkCode = (value = code) => run(async () => handle(await api<SessionResult | { signup: Signup }>("/auth/confirm", { body: { login: target, code: value } })));

  const completeSignup = () =>
    run(async () => {
      if (!consent) {
        setFields({ acceptPrivacy: "Без согласия мы не можем создать аккаунт" });
        throw new ApiError(400, "Нужно согласие на обработку персональных данных", { acceptPrivacy: "Без согласия мы не можем создать аккаунт" });
      }
      finish(await api<SessionResult>("/auth/complete", { body: { token: signup!.token, username, acceptPrivacy: true } }));
    });

  const passwordLogin = () =>
    run(async () => {
      const r = await api<SessionResult | { needsVerification: true; target: string }>("/auth/login", { body: { login, password } });
      if ("needsVerification" in r) {
        // An old unverified account: confirm the address with a code first.
        await api("/auth/start", { body: { login } }).catch(() => undefined);
        setTarget(r.target);
        setResendIn(60);
        setStep("code");
      } else finish(r);
    });

  const requestReset = () =>
    run(async () => {
      const r = await api<{ target: string }>("/auth/reset/request", { body: { login } });
      setTarget(r.target);
      setCode("");
      setResendIn(60);
      setStep("reset-confirm");
    });

  const confirmReset = () => run(async () => finish(await api<SessionResult>("/auth/reset/confirm", { body: { login: target, code, password } })));

  // Android/Chrome: read the code from the incoming SMS (WebOTP) and submit it.
  useEffect(() => {
    if (step !== "code" || byEmail || typeof window === "undefined" || !("OTPCredential" in window)) return;
    const ctrl = new AbortController();
    (navigator.credentials as unknown as { get: (o: object) => Promise<{ code?: string } | null> })
      .get({ otp: { transport: ["sms"] }, signal: ctrl.signal })
      .then((otp) => {
        if (otp?.code) {
          setCode(otp.code);
          void checkCode(otp.code);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, byEmail]);

  const title = {
    start: "Вход или регистрация",
    code: "Введите код",
    profile: "Последний шаг",
    password: "Вход по паролю",
    reset: "Восстановить пароль",
    "reset-confirm": "Новый пароль",
  }[step];

  const submit = { start: sendCode, code: () => checkCode(), profile: completeSignup, password: passwordLogin, reset: requestReset, "reset-confirm": confirmReset }[step];
  const generalError = error && !Object.keys(fields).length;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {reason && step === "start" && <p className="-mt-2 mb-5 text-sm text-muted">{reason}</p>}

      {step === "start" && providers?.google && (
        <>
          <GoogleButton clientId={providers.google} onToken={(idToken) => run(async () => handle(await api<SessionResult | { signup: Signup }>("/auth/google", { body: { idToken } })))} />
          {providers.apple && (
            <div className="mt-3">
              <AppleButton clientId={providers.apple} onToken={(idToken) => run(async () => finish(await api<SessionResult>("/auth/apple", { body: { idToken } })))} />
            </div>
          )}
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            или по номеру телефона или почте
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {(step === "start" || step === "password" || step === "reset") && (
          <Field
            label="Телефон или почта"
            htmlFor="auth-login"
            error={fields.login}
            hint={step === "start" && login.trim() ? (isEmail(login) ? "Пришлём код на почту" : "Пришлём код в SMS") : step === "start" ? "Пароль придумывать не нужно — войдёте по коду" : undefined}
          >
            <Input
              id="auth-login"
              name="login"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="username"
              autoFocus
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              error={fields.login}
              placeholder="+375 29 123-45-67 или you@mail.by"
            />
          </Field>
        )}

        {step === "code" && (
          <>
            <p className="-mt-1 text-sm text-ink-2">
              {byEmail ? "Отправили письмо на" : "Отправили SMS на"} <b className="font-semibold text-ink">{byEmail ? target : prettyPhone(target)}</b>.{" "}
              <button type="button" className="underline underline-offset-4" onClick={() => setStep("start")}>
                Изменить
              </button>
            </p>
            <Field label="Код из 6 цифр" htmlFor="auth-code" error={fields.code}>
              <Input
                ref={codeInput}
                id="auth-code"
                name="code"
                spellCheck={false}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  // Six digits typed or pasted → check right away.
                  if (v.length === 6 && !busy) void checkCode(v);
                }}
                error={fields.code}
                className="tabular text-center text-2xl tracking-[0.5em]"
                placeholder="••••••"
              />
            </Field>
            {byEmail && <p className="-mt-2 text-xs text-muted">Письма нет? Проверьте папку «Спам».</p>}
          </>
        )}

        {step === "profile" && signup && (
          <>
            <p className="-mt-1 text-sm text-ink-2">
              Создаём аккаунт для <b className="font-semibold text-ink">{isEmail(signup.contact) || signup.contact === "Google" ? signup.contact : prettyPhone(signup.contact)}</b>. Придумайте ник — так вас увидят в гардеробе и чатах.
            </p>
            <Field label="Ник" htmlFor="auth-username" error={fields.username ?? (hint && !hint.ok ? hint.text : undefined)} hint={hint?.ok ? hint.text : "Латиница, цифры и _ — от 3 до 24 символов"}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">@</span>
                <Input id="auth-username" name="username" spellCheck={false} autoCapitalize="none" autoFocus className="pl-8" autoComplete="nickname" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, "").toLowerCase())} error={fields.username} />
              </div>
              {hint?.suggestion && (
                <button type="button" className="self-start text-sm text-accent underline-offset-4 hover:underline" onClick={() => setUsername(hint.suggestion!)}>
                  Взять @{hint.suggestion}
                </button>
              )}
            </Field>
            <label className="flex items-start gap-3 text-sm text-ink-2">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" checked={consent} onChange={(e) => (setConsent(e.target.checked), setFields({}))} />
              <span>
                Даю согласие на обработку моих персональных данных, включая их передачу за рубеж, на условиях{" "}
                <Link href="/privacy" target="_blank" className="font-medium text-ink underline underline-offset-4">
                  Политики конфиденциальности
                </Link>
                . Мне есть 16 лет.
                {fields.acceptPrivacy && <span className="mt-1 block text-danger">{fields.acceptPrivacy}</span>}
              </span>
            </label>
          </>
        )}

        {(step === "password" || step === "reset-confirm") && (
          <>
            {step === "reset-confirm" && (
              <Field label={`Код из ${byEmail ? "письма" : "SMS"} на ${byEmail ? target : prettyPhone(target)}`} htmlFor="auth-code" error={fields.code}>
                <Input id="auth-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} error={fields.code} className="tabular text-center text-2xl tracking-[0.5em]" placeholder="••••••" />
              </Field>
            )}
            <Field label={step === "reset-confirm" ? "Новый пароль" : "Пароль"} htmlFor="auth-password" error={fields.password} hint={step === "reset-confirm" ? "Минимум 8 символов" : undefined}>
              <div className="relative">
                <Input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={step === "password" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={fields.password}
                  className="pr-24"
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-2" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? "Скрыть" : "Показать"}
                </button>
              </div>
            </Field>
          </>
        )}

        {generalError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" block loading={busy} disabled={step === "code" && code.length < 6}>
          {{ start: "Получить код", code: "Продолжить", profile: "Создать аккаунт", password: "Войти", reset: "Получить код", "reset-confirm": "Сохранить и войти" }[step]}
        </Button>

        {(step === "code" || step === "reset-confirm") && providers?.devAnyCode && <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">Режим разработки: подойдёт любой код из 6 цифр, например 000000.</p>}

        {step === "code" && (
          <button type="button" disabled={resendIn > 0 || busy} onClick={sendCode} className="text-sm text-ink-2 disabled:text-muted">
            {resendIn > 0 ? `Отправить код ещё раз через ${resendIn} с` : "Отправить код ещё раз"}
          </button>
        )}
      </form>

      {step === "start" && (
        <p className="mt-4 text-center text-sm text-ink-2">
          Есть пароль?{" "}
          <button className="font-medium text-ink underline underline-offset-4" onClick={() => setStep("password")}>
            Войти по паролю
          </button>
        </p>
      )}
      {step === "password" && (
        <div className="mt-4 flex justify-between text-sm">
          <button className="font-medium text-ink underline underline-offset-4" onClick={() => setStep("start")}>
            Войти по коду
          </button>
          <button className="text-ink-2 hover:underline" onClick={() => setStep("reset")}>
            Забыли пароль?
          </button>
        </div>
      )}
      {(step === "reset" || step === "reset-confirm") && (
        <button className="mt-4 text-sm text-ink-2 hover:underline" onClick={() => setStep("password")}>
          Назад ко входу
        </button>
      )}
      {step === "start" && (
        <p className="mt-5 text-center text-xs leading-relaxed text-muted">
          Продолжая, вы соглашаетесь с{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">
            Политикой конфиденциальности
          </Link>
        </p>
      )}
    </Modal>
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
