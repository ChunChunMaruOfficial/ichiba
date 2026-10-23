"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import type { Me, TelegramPrefs } from "@/lib/types";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Button, Spinner } from "./ui";

/** Groups the bot can send, in the order a seller cares about them (server: telegram/texts TG_CATEGORIES). */
const GROUPS: Array<[keyof TelegramPrefs, string, string]> = [
  ["deals", "Покупки и сделки", "Хотят купить, подтверждения, передача, отзывы, споры"],
  ["offers", "Предложения цены", "Новые и встречные — принять или отклонить прямо в Telegram"],
  ["chat", "Сообщения в чате", "Не чаще раза в пару минут на один диалог"],
  ["auctions", "Аукционы", "Ставки, победы и итоги"],
  ["favorites", "Избранное и подписки", "Снижение цены, новые вещи продавцов"],
  ["account", "Модерация и аккаунт", "Решения модераторов, статус бренда"],
];

/** Waiting this long after «Подключить» for the tap on «Запустить» in Telegram. */
const WAIT_MS = 5 * 60_000;

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M21.9 4.6 18.7 19.8c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.3 13.5l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 3.3c.9-.3 1.7.2 1.4 1.3Z" />
    </svg>
  );
}

/** A Telegram message drawn in the brand's paper: what a seller is about to get. */
function Preview() {
  return (
    <div aria-hidden className="relative overflow-hidden rounded-3xl bg-indigo-soft p-4 sm:p-5">
      <div className="pointer-events-none absolute -right-6 -top-6 size-28 rounded-full bg-indigo/10" />
      <div className="relative flex items-center gap-2 text-xs font-semibold text-indigo">
        <span className="grid size-6 place-items-center rounded-full bg-[#2aabee] text-white">
          <TelegramIcon className="size-3.5" />
        </span>
        ichiba · бот уведомлений
        <span className="ml-auto font-normal text-muted">сейчас</span>
      </div>
      <div className="relative mt-3 max-w-[330px] rounded-2xl rounded-tl-md bg-surface p-3.5 text-[14px] leading-snug text-ink shadow-[0_1px_0_var(--line-strong)]">
        <p className="font-semibold">🛍 Хотят купить</p>
        <p className="mt-1.5">
          @anya хочет купить «Куртка Carhartt WIP» за <b>120 BYN</b>
        </p>
        <p className="mt-1.5 text-xs italic text-muted">Ответьте в течение 48 часов</p>
      </div>
      <div className="relative mt-1.5 grid max-w-[330px] grid-cols-2 gap-1.5 text-[13px] font-medium text-indigo">
        <span className="rounded-xl bg-surface/70 py-2 text-center">✅ Принять</span>
        <span className="rounded-xl bg-surface/70 py-2 text-center">✖️ Отклонить</span>
        <span className="col-span-2 rounded-xl bg-surface/70 py-2 text-center">Открыть сделку ↗</span>
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-ink/5 disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-xs text-ink-2">{hint}</span>
      </span>
      <span className={clsx("relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200", checked ? "bg-indigo" : "bg-line-strong")}>
        <span className={clsx("absolute top-0.5 size-5 rounded-full bg-surface shadow transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

/**
 * Settings → Telegram: one button opens the bot with a one-time link (t.me/<bot>?start=…); the tap on «Запустить»
 * links the chat, and the page notices it live (or by polling) and switches to the linked state with per-group switches.
 */
export function TelegramSection({ me, Section }: { me: Me; Section: React.ComponentType<{ id?: string; title: string; hint?: string; children: React.ReactNode }> }) {
  const tg = me.telegram;
  const toast = useToast();
  // Linked while this page is open (the tap on «Запустить» in Telegram): say so.
  const wasLinked = useRef(!!tg?.linked);
  useEffect(() => {
    if (tg?.linked && !wasLinked.current) toast("Telegram подключён — уведомления уже летят туда");
    wasLinked.current = !!tg?.linked;
  }, [tg?.linked, toast]);
  if (!tg?.available && !tg?.linked) return null;
  return (
    <Section id="telegram" title="Telegram" hint="Запросы на покупку, предложения цены и сообщения — сразу в Telegram. Отвечайте покупателям в один тап, даже не открывая сайт.">
      {tg?.linked ? <Linked me={me} /> : <Connect />}
    </Section>
  );
}

function Connect() {
  const { refresh } = useSession();
  // The link is ready before the tap, so it opens as a plain link (a window opened after an await is blocked on
  // phones). It works 30 minutes: a fresh one is fetched every 25.
  const { data: link, error, mutate } = useSWR("telegram-link", () => api<{ url: string; expiresAt: string }>("/telegram/link", { method: "POST" }), {
    refreshInterval: 25 * 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const failed = !!error;
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  // After the tap: the bot's confirmation arrives as a live event (session refresh); polling covers a missing socket.
  useEffect(() => {
    if (waitingSince == null) return;
    const t = setInterval(() => {
      if (Date.now() - waitingSince > WAIT_MS) setWaitingSince(null);
      else void refresh();
    }, 3000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => (clearInterval(t), window.removeEventListener("focus", onFocus));
  }, [waitingSince, refresh]);

  return (
    <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Preview />
      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-2.5 text-[15px]">
          {["Нажмите «Подключить Telegram»", "В открывшемся чате нажмите «Запустить»", "Готово — эта страница сама это заметит"].map((s, i) => (
            <li key={s} className="flex items-start gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-shu-soft font-brush text-sm text-shu">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        {waitingSince != null ? (
          <div className="flex flex-wrap items-center gap-3" role="status">
            <span className="inline-flex h-11 items-center gap-2.5 rounded-full bg-indigo-soft px-5 text-[15px] font-medium text-indigo">
              <Spinner /> Ждём «Запустить» в Telegram…
            </span>
            {link && (
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-ink-2 underline underline-offset-4">
                Открыть бота ещё раз
              </a>
            )}
          </div>
        ) : (
          <a
            href={link?.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!link}
            onClick={(e) => {
              if (!link) return e.preventDefault();
              setWaitingSince(Date.now());
            }}
            className={clsx("btn-wa btn-wa-ink inline-flex h-12 items-center justify-center gap-2.5 self-start rounded-full px-6 text-[15px] font-semibold", !link && "pointer-events-none opacity-60")}
          >
            {link ? <TelegramIcon className="size-5 text-[#2aabee]" /> : <Spinner />}
            Подключить Telegram
          </a>
        )}
        {failed && (
          <p className="text-sm text-danger">
            Не получилось подготовить ссылку.{" "}
            <button type="button" className="font-medium underline underline-offset-4" onClick={() => void mutate()}>
              Повторить
            </button>
          </p>
        )}
        <p className="text-xs text-muted">Бот пишет только вам и только по делу. Отключить можно здесь или командой /stop в боте.</p>
      </div>
    </div>
  );
}

function Linked({ me }: { me: Me }) {
  const { refresh } = useSession();
  const toast = useToast();
  const tg = me.telegram!;
  const [prefs, setPrefs] = useState<TelegramPrefs>(tg.prefs);
  const [busy, setBusy] = useState<"test" | "unlink" | keyof TelegramPrefs | null>(null);
  const since = tg.linkedAt ? new Date(tg.linkedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : null;
  const allOff = Object.values(prefs).every((v) => !v);

  const toggle = async (key: keyof TelegramPrefs, value: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    setBusy(key);
    try {
      setPrefs(await api<TelegramPrefs>("/telegram/prefs", { method: "PATCH", body: { [key]: value } }));
      void refresh();
    } catch (e) {
      setPrefs(before);
      toast(e instanceof ApiError ? e.message : "Не удалось сохранить", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const run = async (what: "test" | "unlink") => {
    setBusy(what);
    try {
      if (what === "test") {
        await api("/telegram/test", { method: "POST" });
        toast("Отправили — загляните в Telegram");
      } else {
        await api("/telegram/link", { method: "DELETE" });
        await refresh();
        toast("Telegram отключён");
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось", { tone: "error" });
      if (what === "test") void refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-3xl bg-ok-soft px-5 py-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#2aabee] text-white">
          <TelegramIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ok">Подключено{tg.username ? ` · @${tg.username}` : ""}</p>
          <p className="text-sm text-ink-2">{since ? `С ${since} уведомления @${me.username} приходят в Telegram` : `Уведомления @${me.username} приходят в Telegram`}</p>
        </div>
        <Button size="sm" variant="secondary" loading={busy === "test"} onClick={() => void run("test")}>
          Проверить
        </Button>
      </div>
      <fieldset>
        <legend className="mb-1 px-3 text-sm font-medium text-ink-2">Что присылать</legend>
        <div className="flex flex-col">
          {GROUPS.map(([key, label, hint]) => (
            <Switch key={key} checked={prefs[key]} label={label} hint={hint} disabled={busy === key} onChange={(v) => void toggle(key, v)} />
          ))}
        </div>
        {allOff && <p className="mt-2 px-3 text-sm text-warn">Всё выключено — бот будет молчать.</p>}
      </fieldset>
      <Button variant="ghost" className="self-start text-danger" loading={busy === "unlink"} onClick={() => void run("unlink")}>
        Отключить Telegram
      </Button>
    </div>
  );
}
