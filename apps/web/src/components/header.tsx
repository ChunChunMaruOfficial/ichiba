"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/labels";
import { notificationHref, notificationText, type NotificationRow } from "@/lib/notifications";
import { getRecent, pushRecent, removeRecent } from "@/lib/recent-searches";
import { CatalogButton, MobileCatalog } from "./catalog-nav";
import { useMeta, useSession } from "./session";
import { IconBag, IconBell, IconChart, IconHanger, IconHeart, IconHome, IconMessage, IconPlus, IconReceipt, IconSearch, IconSettings, IconUsers, IconX } from "./ui";

function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={clsx("flex items-center gap-2 font-semibold tracking-tight", className)} onClick={() => window.scrollTo({ top: 0 })}>
      <svg aria-hidden viewBox="0 0 32 20" className="h-5 w-8 -rotate-6 text-kraft drop-shadow-[0_1px_1px_rgb(30_36_51/0.25)]">
        <path d="M7 0h22a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7L0 10Z" fill="currentColor" />
        <circle cx="7.5" cy="10" r="2" fill="var(--ink)" opacity=".6" />
      </svg>
      <span className="text-lg font-semibold tracking-[-0.02em]">ichiba</span>
    </Link>
  );
}

function SearchBox({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const meta = useMeta();
  const urlQ = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(urlQ);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setQ(urlQ);
  }
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (value: string) => {
    pushRecent(value);
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(value.trim())}`);
  };

  return (
    <div ref={box} className={clsx("relative", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(q);
        }}
      >
        <label className="flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 focus-within:border-ink focus-within:ring-3 focus-within:ring-accent/15">
          <IconSearch className="size-5 shrink-0 text-muted" />
          <span className="sr-only">Поиск</span>
          <input
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => {
              setRecent(getRecent());
              setOpen(true);
            }}
            placeholder="Что ищете?"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            enterKeyHint="search"
          />
          {q && (
            <button type="button" aria-label="Очистить" onClick={() => setQ("")} className="text-muted hover:text-ink">
              <IconX className="size-4" />
            </button>
          )}
        </label>
      </form>

      {open && (recent.length > 0 || meta) && (
        <div className="fade-in absolute inset-x-0 top-[calc(100%+8px)] z-50 rounded-2xl border border-line bg-surface p-4 shadow-xl">
          {recent.length > 0 && (
            <>
              <p className="mb-2 text-sm text-muted">Недавние запросы</p>
              <ul className="mb-4 flex flex-col">
                {recent.map((r) => (
                  <li key={r} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-paper">
                    <button className="flex-1 text-left text-sm" onClick={() => go(r)}>
                      {r}
                    </button>
                    <button
                      aria-label={`Удалить «${r}»`}
                      className="text-muted hover:text-ink"
                      onClick={() => {
                        removeRecent(r);
                        setRecent(getRecent());
                      }}
                    >
                      <IconX className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {meta && (
            <>
              <p className="mb-2 text-sm text-muted">Популярные категории</p>
              <div className="flex flex-wrap gap-2">
                {meta.categories.slice(0, 6).map((c) => (
                  <Link
                    key={c.slug}
                    href={`/search?category=${c.slug}`}
                    onClick={() => setOpen(false)}
                    className="rounded-full border border-line-strong px-3 py-1.5 text-sm hover:border-ink"
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationsMenu({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const { refresh } = useSession();
  const { data, mutate } = useSWR<{ items: NotificationRow[] }>(open ? "/notifications?limit=8" : null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (open && unread > 0) {
      void api("/notifications/read-all", { method: "POST" }).then(() => refresh());
    }
  }, [open, unread, refresh]);

  return (
    // Not positioned on phones: the panel then anchors to the header and spans its width instead of
    // hanging off the bell and running past the left edge of the screen.
    <div ref={box} className="md:relative">
      <button
        aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          void mutate();
        }}
        className="relative grid size-11 place-items-center rounded-full hover:bg-black/5"
      >
        <IconBell />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fade-in absolute inset-x-3 top-[calc(100%+8px)] z-50 rounded-2xl border border-line bg-surface p-2 shadow-xl md:inset-x-auto md:right-0 md:w-[380px]">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Уведомления</p>
          {!data ? (
            <p className="px-3 py-6 text-sm text-muted">Загружаем…</p>
          ) : data.items.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted">Здесь появятся ответы продавцов, новые запросы и снижение цен</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <Link href={notificationHref(n)} onClick={() => setOpen(false)} className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 hover:bg-paper">
                    <span className={clsx("text-sm", !n.readAt && "font-medium")}>{notificationText(n)}</span>
                    <span className="text-xs text-muted">{timeAgo(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-medium text-ink-2 hover:bg-paper hover:text-ink">
            Все уведомления
          </Link>
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  if (!me) return null;
  // Only what the header doesn't already show (♡, messages, notifications and cart are icons next to it).
  // Seller tools appear once something is listed; the admin area is reached by URL only; sign-out is in settings.
  const links: Array<[string, string, typeof IconHome, number?]> = [
    ["/wardrobe", "Мой гардероб", IconHanger],
    ["/purchases", "Мои покупки", IconReceipt],
    ...(me.isSeller ? ([["/sales", "Продажи и статистика", IconChart, me.pendingSales + me.pendingOffers]] as Array<[string, string, typeof IconHome, number]>) : []),
    ["/following", "Подписки", IconUsers],
    ["/settings", "Настройки", IconSettings],
  ];
  const attention = me.pendingSales + me.pendingOffers;
  return (
    <div ref={box} className="relative">
      <button
        aria-label="Меню гардероба"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-11 place-items-center rounded-full hover:bg-black/5"
      >
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold uppercase text-accent">{me.username[0]}</span>
        {attention > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full border-2 border-paper bg-danger" aria-hidden />}
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-[calc(100%+8px)] z-50 w-60 rounded-2xl border border-line bg-surface p-2 shadow-xl">
          <p className="px-3 pb-2 pt-1.5 text-sm text-muted">@{me.username}</p>
          {links.map(([href, label, Icon, badge]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-paper">
              <Icon className="size-[18px] shrink-0 text-ink-2" />
              <span className="flex-1">{label}</span>
              {!!badge && <span className="rounded-full bg-danger px-1.5 text-xs font-semibold text-white">{badge}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { me, loading, requireAuth, openAuth } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const showMobileSearch = pathname === "/";
  const header = useRef<HTMLElement>(null);

  return (
    <header ref={header} className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 md:h-16 md:px-6">
        <MobileCatalog />
        <Logo />
        <CatalogButton anchor={header} />
        <Suspense fallback={<div className="hidden flex-1 md:block" />}>
          <SearchBox className="mx-auto hidden w-full max-w-[560px] md:block" />
        </Suspense>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <button
            onClick={() => requireAuth(() => router.push("/sell"), { reason: "чтобы выставить вещь" })}
            className="mr-2 hidden h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-4 text-[15px] font-semibold text-accent-ink hover:bg-accent-hover md:inline-flex"
          >
            <IconPlus className="size-4.5" /> Добавить вещь
          </button>
          {loading ? (
            <span className="h-11 w-24" />
          ) : me ? (
            <>
              <Link href="/favorites" aria-label="Избранное" className="hidden size-11 place-items-center rounded-full hover:bg-black/5 md:grid">
                <IconHeart />
              </Link>
              <Link href="/messages" aria-label={me.unreadMessages ? `Сообщения, непрочитанных: ${me.unreadMessages}` : "Сообщения"} className="relative hidden size-11 place-items-center rounded-full hover:bg-black/5 md:grid">
                <IconMessage />
                {me.unreadMessages > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-[18px] text-white">{me.unreadMessages}</span>}
              </Link>
              <NotificationsMenu unread={me.unreadNotifications} />
              <div className="hidden md:block">
                <AccountMenu />
              </div>
              <Link href="/cart" aria-label={me.cartCount ? `Корзина, вещей: ${me.cartCount}` : "Корзина"} className="relative grid size-11 place-items-center rounded-full hover:bg-black/5">
                <IconBag />
                {me.cartCount > 0 && <span className="absolute right-1 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-ink px-1 text-[11px] font-semibold leading-[18px] text-white">{me.cartCount}</span>}
              </Link>
            </>
          ) : (
            <button onClick={() => openAuth()} className="h-11 rounded-xl px-4 text-[15px] font-semibold hover:bg-black/5">
              Войти
            </button>
          )}
        </div>
      </div>
      {showMobileSearch && (
        <div className="px-4 pb-3 md:hidden">
          <Suspense>
            <SearchBox />
          </Suspense>
        </div>
      )}
    </header>
  );
}

/** Mobile bottom navigation, 5 items (frame 05). Hidden on flows that pin their own bottom bar. */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, requireAuth } = useSession();
  const hidden =
    pathname.startsWith("/sell") ||
    pathname.startsWith("/buy/") ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/admin") ||
    /^\/messages\/.+/.test(pathname) ||
    /^\/item\/[^/]+$/.test(pathname) ||
    pathname.endsWith("/edit");
  if (hidden) return null;

  const item = (href: string, label: string, Icon: typeof IconHome, opts: { auth?: boolean; badge?: number } = {}) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    const content = (
      <>
        <span className="relative">
          <Icon className="size-6" filled={active && Icon === IconHeart} />
          {!!opts.badge && <span className="absolute -right-2 -top-1 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">{opts.badge}</span>}
        </span>
        <span className="text-[11px]">{label}</span>
      </>
    );
    const cls = clsx("flex flex-1 flex-col items-center gap-0.5 py-2", active ? "text-ink" : "text-muted");
    return opts.auth ? (
      <button key={href} className={cls} onClick={() => requireAuth(() => router.push(href))}>
        {content}
      </button>
    ) : (
      <Link key={href} href={href} className={cls}>
        {content}
      </Link>
    );
  };

  return (
    <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {item("/", "Главная", IconHome)}
      {item("/search", "Поиск", IconSearch)}
      <button
        className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-ink"
        onClick={() => requireAuth(() => router.push("/sell"), { reason: "чтобы выставить вещь" })}
      >
        <span className="grid size-9 place-items-center rounded-full bg-accent text-accent-ink">
          <IconPlus className="size-5" />
        </span>
        <span className="text-[11px]">Добавить</span>
      </button>
      {item("/favorites", "Избранное", IconHeart, { auth: true })}
      {item("/wardrobe", "Гардероб", IconHanger, { auth: true, badge: me ? me.pendingSales + me.pendingOffers : 0 })}
    </nav>
  );
}
