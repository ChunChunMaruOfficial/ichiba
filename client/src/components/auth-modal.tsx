"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { usePresence } from "@/lib/presence";
import type { Me } from "@/lib/types";
import { Button, Field, Input, Modal } from "./ui";

/**
 * Sign-in and sign-up in one flow, the way Avito, Kufar and Vinted do it:
 *   1. Google / Telegram — or an email → we send a one-time code (no password to invent);
 *   2. the code from the email;
 *   3. only for new people: a nickname + consent to personal data processing → account created.
 * Password sign-in stays available for accounts that have a password.
 */
type Step = "start" | "code" | "profile" | "password" | "reset" | "reset-confirm";
type SessionResult = { user: Me; isNew: boolean };
type Signup = { token: string; contact: string; suggestion: string };
/** What the Telegram Login Widget returns; the server checks its signature. */
type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string; auth_date: number; hash: string };

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
    AppleID?: { auth: { init: (o: object) => void; signIn: () => Promise<{ authorization: { id_token: string } }> } };
    /** telegram-widget.js: opens Telegram's login popup and hands back the signed user (false if cancelled). */
    Telegram?: { Login: { auth: (o: { bot_id: string; request_access?: "write"; lang?: string }, cb: (user: TelegramUser | false) => void) => void } };
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

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSignedIn: (me: Me, isNew?: boolean) => void;
}

/** Mounted fresh on every open (and kept through the exit animation), so it always starts at the first step. */
export function AuthModal(props: AuthModalProps) {
  const { mounted } = usePresence(props.open);
  return mounted ? <AuthForm {...props} /> : null;
}

function AuthForm({ open, onClose, onSignedIn }: AuthModalProps) {
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
  const { data: providers } = useSWR<{ google: string | null; apple: string | null; telegram?: string | null; telegramBotId?: string | null; devAnyCode?: boolean }>("/auth/providers");
  const codeInput = useRef<HTMLInputElement>(null);
  const hint = step === "profile" && username.length >= 3 ? usernameHint : null;

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
  /** Session or "new person" — the same handling for codes, Google and Telegram. */
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
      <div aria-hidden className="pattern-asanoha pattern-fade-b pointer-events-none absolute inset-x-0 top-0 h-32 rounded-t-[inherit]" />

      {step === "start" && (providers?.google || providers?.telegram) && (
        <>
          <div className="flex gap-3">
            {providers.google && (
              <GoogleButton clientId={providers.google} onToken={(idToken) => run(async () => handle(await api<SessionResult | { signup: Signup }>("/auth/google", { body: { idToken } })))} />
            )}
            {providers.telegram && providers.telegramBotId && (
              <TelegramButton botId={providers.telegramBotId} onAuth={(user) => run(async () => handle(await api<SessionResult | { signup: Signup }>("/auth/telegram", { body: user })))} />
            )}
          </div>
          {providers.apple && (
            <div className="mt-3">
              <AppleButton clientId={providers.apple} onToken={(idToken) => run(async () => finish(await api<SessionResult>("/auth/apple", { body: { idToken } })))} />
            </div>
          )}
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            или по почте
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
            label={step === "password" ? "Почта или ник" : "Почта"}
            htmlFor="auth-login"
            error={fields.login}
            hint={step === "start" ? "Пришлём код на почту" : undefined}
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
              type={step === "password" ? "text" : "email"}
              inputMode={step === "password" ? "text" : "email"}
              placeholder="you@mail.by"
            />
          </Field>
        )}

        {step === "code" && (
          <>
            <p className="-mt-1 text-sm text-ink-2">
              Отправили письмо на <b className="font-semibold text-ink">{target}</b>.{" "}
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
            <p className="-mt-2 text-xs text-muted">Письма нет? Проверьте папку «Спам».</p>
          </>
        )}

        {step === "profile" && signup && (
          <>
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
              <Field label={`Код из письма на ${target}`} htmlFor="auth-code" error={fields.code}>
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
        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted sm:text-xs">
          Продолжая, вы принимаете{" "}
          <Link href="/terms" target="_blank" className="underline underline-offset-2">
            Соглашение
          </Link>{" "}
          и{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">
            Политику конфиденциальности
          </Link>
        </p>
      )}
    </Modal>
  );
}

/**
 * Google's button is an iframe with its own look and a 200 px minimum width. To sit in a half-width slot next to
 * Telegram, our own button is drawn and the real Google button lies on top of it, transparent, taking the click.
 */
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
        const box = ref.current;
        if (cancelled || !box || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => cb.current(r.credential) });
        window.google.accounts.id.renderButton(box, { type: "standard", size: "large", text: "signin", width: Math.max(200, box.offsetWidth), locale: "ru" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  return (
    <div className="relative flex-1 overflow-hidden rounded-full">
      <SocialFace label="Google">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.7-4.9H1.3v3.1A12 12 0 0 0 12 24Z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
        </svg>
      </SocialFace>
      <div ref={ref} className="absolute inset-0 flex items-center justify-center opacity-[0.01]" />
    </div>
  );
}

/** Opens Telegram's own login popup (telegram-widget.js) from a button styled like the rest of the modal. */
function TelegramButton({ botId, onAuth }: { botId: string; onAuth: (u: TelegramUser) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadScript("https://telegram.org/js/telegram-widget.js?22")
      .then(() => setReady(true))
      .catch(() => {});
  }, []);
  return (
    <button
      type="button"
      disabled={!ready}
      className="flex-1 rounded-full disabled:opacity-60"
      onClick={() => window.Telegram?.Login.auth({ bot_id: botId, request_access: "write", lang: "ru" }, (user) => user && onAuth(user))}
    >
      <SocialFace label="Telegram">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <circle cx="12" cy="12" r="12" fill="#2AABEE" />
          <path fill="#fff" d="M5.4 11.8 16.9 7.4c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1 .5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5c.2-.2 0-.3-.4-.1l-6.9 4.3-3-.9c-.6-.2-.6-.6.2-.9Z" />
        </svg>
      </SocialFace>
    </button>
  );
}

/** Shared look of the social sign-in buttons: a paper pill with the service's logo and name. */
function SocialFace({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface text-[15px] font-semibold text-ink transition-colors hover:border-ink-2">
      {children}
      {label}
    </span>
  );
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
