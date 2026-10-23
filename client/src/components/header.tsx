"use client";

import { useGuestCart } from "@/lib/guest-cart";
import { useMarketZone, withMarket } from "@/lib/market";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/labels";
import { notificationHref, notificationText, type NotificationRow } from "@/lib/notifications";
import { usePresence } from "@/lib/presence";
import { getRecent, pushRecent, removeRecent } from "@/lib/recent-searches";
import { CatalogButton, MobileCatalog } from "./catalog-nav";
import { Wordmark } from "./logo";
import { PhotoSearchButton } from "./photo-search-button";
import { useMeta, useSession } from "./session";
import { IconBag, IconBell, IconChart, IconHanger, IconHeart, IconHome, IconMessage, IconPlus, IconReceipt, IconSearch, IconSettings, IconTag, IconUsers, IconX } from "./ui";

function Logo({ className }: { className?: string }) {
  // The wave (globals.css · .wm-wave) plays once per hover on desktop and per tap on phones.
  const [wave, setWave] = useState(0);
  const play = () => setWave((n) => n + 1);
  return (
    <Link
      href="/"
      aria-label="ichiba — на главную"
      className={clsx("flex shrink-0 items-center text-ink", className)}
      onClick={() => window.scrollTo({ top: 0 })}
      onMouseEnter={() => matchMedia("(hover: hover)").matches && play()}
      onTouchStart={play}
    >
      <span key={wave} className={clsx("flex", wave > 0 && "wm-wave")}>
        <Wordmark className="h-[26px] w-auto md:h-[30px]" />
      </span>
    </Link>
  );
}

const SEARCH_EXAMPLES = ["Пуховик на зиму", "Levi's 501", "Кроссовки 42 размер", "Платье на выпускной", "Винтажная джинсовка", "Nike Air Force", "Свитер оверсайз"];

/** How many examples the placeholder types before it rests on the last one (WCAG 2.2.2: motion must end). */
const PLACEHOLDER_CYCLES = 3;

/**
 * Placeholder that types an example query, holds it, erases it and moves to the next one. Stops on the
 * full current example while the field is focused or filled, while the tab is hidden (no timers in the background),
 * after PLACEHOLDER_CYCLES examples, and for people who prefer reduced motion.
 */
function useTypedPlaceholder(active: boolean) {
  const [state, setState] = useState({ i: 0, len: SEARCH_EXAMPLES[0].length, deleting: false, cycle: 0 });
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const running = active && !hidden;
  useEffect(() => {
    if (!running || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const word = SEARCH_EXAMPLES[state.i];
    const done = !state.deleting && state.len === word.length;
    const empty = state.deleting && state.len === 0;
    // The last example stays typed out: the motion ends there.
    if (done && state.cycle >= PLACEHOLDER_CYCLES - 1) return;
    const delay = done ? 1800 : empty ? 350 : state.deleting ? 35 : 75 + Math.random() * 60;
    const t = setTimeout(
      () =>
        setState((s) =>
          done
            ? { ...s, deleting: true }
            : empty
              ? { i: (s.i + 1) % SEARCH_EXAMPLES.length, len: 0, deleting: false, cycle: s.cycle + 1 }
              : { ...s, len: s.len + (s.deleting ? -1 : 1) },
        ),
      delay,
    );
    return () => clearTimeout(t);
  }, [running, state]);
  const word = SEARCH_EXAMPLES[state.i];
  return running && state.len < word.length ? word.slice(0, state.len) + "|" : word;
}

function SearchBox({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const meta = useMeta();
  const zone = useMarketZone();
  // A search by photo keeps its refining words in its own bar, not here.
  const urlQ = pathname === "/search" && !params.get("photo") ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(urlQ);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setQ(urlQ);
  }
  const [open, setOpen] = useState(false);
  const pop = usePresence(open);
  const [recent, setRecent] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const placeholder = useTypedPlaceholder(!focused && !q);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // pointerdown, not mousedown: iOS Safari fires no mousedown for a tap on a non-clickable area.
    const onDoc = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  const go = (value: string) => {
    pushRecent(value);
    setOpen(false);
    router.push(withMarket(`/search?q=${encodeURIComponent(value.trim())}`, zone));
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
        <label className="flex h-11 items-center gap-2 rounded-full border border-line-control bg-surface px-4 transition-[border-color,box-shadow] focus-within:border-indigo focus-within:ring-3 focus-within:ring-indigo/20">
          <IconSearch className="size-5 shrink-0 text-ink-2" />
          <span className="sr-only">Поиск</span>
          <input
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setRecent(getRecent());
              setOpen(true);
            }}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            enterKeyHint="search"
          />
          {q && (
            <button type="button" aria-label="Очистить" onClick={() => setQ("")} className="text-muted hover:text-ink">
              <IconX className="size-4" />
            </button>
          )}
          <PhotoSearchButton className="-mr-1.5 size-8 rounded-full hover:bg-ink/5" />
        </label>
      </form>

      {pop.mounted && (recent.length > 0 || meta) && (
        <div data-closing={pop.closing || undefined} className="panel fade-in absolute inset-x-0 top-[calc(100%+10px)] z-50 rounded-3xl p-4">
          {recent.length > 0 && (
            <>
              <p className="mb-2 text-sm text-muted">Недавние запросы</p>
              <ul className="mb-4 flex flex-col">
                {recent.map((r) => (
                  <li key={r} className="flex items-center justify-between rounded-xl px-2 py-1.5 hover:bg-ink/5">
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
                    href={withMarket(`/search?category=${c.slug}`, zone)}
                    onClick={() => setOpen(false)}
                    className="rounded-full bg-surface/70 px-3 py-1.5 text-sm shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--line-control)]"
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
  const pop = usePresence(open);
  const { refresh } = useSession();
  const { data, mutate } = useSWR<{ items: NotificationRow[] }>(pop.mounted ? "/notifications?limit=8" : null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // pointerdown, not mousedown: iOS Safari fires no mousedown for a tap on a non-clickable area.
    const onDoc = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
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
        className="relative grid size-11 place-items-center rounded-full hover:bg-ink/5"
      >
        <IconBell />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-shu px-1 text-[11px] font-semibold leading-[18px] text-on-shu">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {pop.mounted && (
        <div data-closing={pop.closing || undefined} className="panel fade-in absolute inset-x-0 top-[calc(100%+10px)] z-50 rounded-3xl p-2 md:inset-x-auto md:right-0 md:w-[380px]">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Уведомления</p>
          {!data ? (
            <p className="px-3 py-6 text-sm text-muted">Загружаем…</p>
          ) : data.items.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted">Здесь появятся ответы продавцов, новые запросы и снижение цен</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <Link href={notificationHref(n)} onClick={() => setOpen(false)} className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 hover:bg-ink/5">
                    <span className={clsx("text-sm", !n.readAt && "font-medium")}>{notificationText(n)}</span>
                    <span className="text-xs text-muted">{timeAgo(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
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
  const pop = usePresence(open);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // pointerdown, not mousedown: iOS Safari fires no mousedown for a tap on a non-clickable area.
    const onDoc = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
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
        className="relative grid size-11 place-items-center rounded-full hover:bg-ink/5"
      >
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft font-display text-[15px] font-bold uppercase text-ink">{me.username[0]}</span>
        {attention > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full border-2 border-surface bg-shu" aria-hidden />}
      </button>
      {pop.mounted && (
        <div data-closing={pop.closing || undefined} className="panel fade-in absolute right-0 top-[calc(100%+10px)] z-50 w-64 rounded-3xl p-2">
          <p className="px-3 pb-2 pt-1.5 text-sm text-muted">@{me.username}</p>
          {links.map(([href, label, Icon, badge]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-ink/5">
              <Icon className="size-[18px] shrink-0 text-ink-2" />
              <span className="flex-1">{label}</span>
              {!!badge && <span className="rounded-full bg-shu px-1.5 text-xs font-semibold text-on-shu">{badge}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { me, loading, openAuth } = useSession();
  const pathname = usePathname();
  // The phone search row under the header: on the brands' catalogue and on «Вторичка», each searching its own market.
  const showMobileSearch = pathname === "/" || pathname === "/resale";
  const resaleZone = pathname.startsWith("/resale") || pathname.startsWith("/wardrobes");
  const header = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);

  // Sticky bars below (the feed's chip bar) sit right under the header, whatever its height.
  useEffect(() => {
    const el = header.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tucks away while scrolling down, comes back when scrolling up. Movement is summed per direction, so finger
  // jitter and momentum ticks don't flip it back and forth; the iOS rubber band past either end is ignored.
  // Open menus inside keep it shown.
  useEffect(() => {
    let last = window.scrollY;
    let travel = 0;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const dy = y - last;
        last = y;
        const el = header.current;
        if (y < 80 || (el && el.contains(document.activeElement) && document.activeElement !== document.body)) {
          travel = 0;
          setHidden(false);
          return;
        }
        if (y < 0 || y > max - 2) return; // rubber band at the top or bottom
        travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
        if (travel > 24) setHidden(true);
        else if (travel < -32) setHidden(false);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  // Route change: show it again.
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setHidden(false);
  }
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--header-offset", hidden ? "0px" : "var(--header-h)");
    // The phone tab bar tucks away together with the header (globals.css, html[data-chrome-away]).
    root.toggleAttribute("data-chrome-away", hidden);
  }, [hidden]);

  return (
    <header
      ref={header}
      className={clsx(
        "bg-washi sticky top-0 z-40 border-b border-line will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
        hidden && "-translate-y-full",
        // A conversation on a phone or tablet is full screen, like a messenger: its own header has the way back.
        isThread(pathname) && "max-lg:hidden",
      )}
    >
      {/* Desktop: three columns with equal sides, so the search box stands in the very middle of the page whatever
          sits left and right of it. Phones: one row. */}
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 md:grid md:h-16 md:grid-cols-[1fr_minmax(0,560px)_1fr] md:gap-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
        <MobileCatalog />
        <Logo />
        <CatalogButton anchor={header} />
        <Link
          href="/resale"
          aria-label="Вторичка"
          className={clsx(
            "hidden h-11 shrink-0 items-center gap-2 rounded-full px-3 text-[15px] font-semibold transition-colors md:inline-flex lg:px-4",
            pathname.startsWith("/resale") ? "bg-ink text-accent-ink" : "bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--line-control)]",
          )}
        >
          <IconTag className="size-5" />
          {/* Tablets: the header is tight, the icon alone says it. */}
          <span className="hidden lg:inline">Вторичка</span>
        </Link>
        </div>
        <Suspense fallback={<div className="hidden md:block" />}>
          <SearchBox className="hidden w-full min-w-0 md:block" />
        </Suspense>
        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 md:justify-self-end">
          {/* «Продать вещь» is the second-hand market's call; the brands' showcase doesn't sell people's closets. */}
          {resaleZone && (
          <Link
            href="/sell"
            aria-label="Продать вещь"
            className="btn-wa btn-wa-shu mr-1 hidden h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-[15px] font-semibold md:inline-flex lg:px-5"
          >
            <IconPlus className="size-4.5" /> <span className="hidden lg:inline">Продать вещь</span>
          </Link>
          )}
          {loading ? (
            <span className="h-11 w-24" />
          ) : me ? (
            <>
              <Link href="/favorites" aria-label="Избранное" className="hidden size-11 place-items-center rounded-full hover:bg-ink/5 md:grid">
                <IconHeart />
              </Link>
              <Link href="/messages" aria-label={me.unreadMessages ? `Сообщения, непрочитанных: ${me.unreadMessages}` : "Сообщения"} className="relative grid size-11 place-items-center rounded-full hover:bg-ink/5">
                <IconMessage />
                {me.unreadMessages > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-shu px-1 text-[11px] font-semibold leading-[18px] text-on-shu">{me.unreadMessages}</span>}
              </Link>
              <NotificationsMenu unread={me.unreadNotifications} />
              <div className="hidden md:block">
                <AccountMenu />
              </div>
              <Link href="/cart" aria-label={me.cartCount ? `Корзина, вещей: ${me.cartCount}` : "Корзина"} className="relative grid size-11 place-items-center rounded-full hover:bg-ink/5">
                <IconBag />
                {me.cartCount > 0 && <span className="absolute right-1 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-ink px-1 text-[11px] font-semibold leading-[18px] text-accent-ink">{me.cartCount}</span>}
              </Link>
            </>
          ) : (
            <>
              <GuestCartLink />
              <button onClick={() => openAuth()} className="h-11 rounded-full px-4 text-[15px] font-semibold hover:bg-ink/5">
                Войти
              </button>
            </>
          )}
        </div>
      </div>
      {showMobileSearch && (
        <div data-chrome="mobile-search" className="px-4 pb-3 md:hidden">
          <Suspense>
            <SearchBox />
          </Suspense>
        </div>
      )}
    </header>
  );
}

/** Mobile bottom navigation, 5 items (frame 05). Hidden on flows that pin their own bottom bar. */
/** A conversation fills the screen like a messenger: no bottom tabs, and no room kept for them. */
const isThread = (pathname: string) => /^\/messages\/.+/.test(pathname);

/** The page area; on phones it keeps room at the bottom for the tab bar wherever the bar is shown. */
export function Main({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // A short fade on every page change. Opacity only: a transform on <main> would carry the pages' fixed bars
  // (the sell form's bottom bar) along with it. Chats switch inside their own shell, with a skeleton instead.
  const main = useRef<HTMLElement>(null);
  const prev = useRef(pathname);
  useEffect(() => {
    const from = prev.current;
    prev.current = pathname;
    if (from === pathname || (isThread(from) && isThread(pathname)) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // An item page a card's photo flies into (photo-flight.tsx) fades in by itself, around the photo; a list the
    // photo flies back into starts half there, so the screen is never empty behind the photo.
    const flight = document.documentElement.dataset.photoFlight;
    if (flight === "open" && pathname.startsWith("/item/")) return;
    main.current?.animate([{ opacity: flight === "back" ? 0.35 : 0 }, { opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [pathname]);
  return (
    <main ref={main} id="main" data-chrome="main" tabIndex={-1} className={clsx(!isThread(pathname) && "pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0")}>
      {children}
    </main>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { me } = useSession();
  const hidden =
    pathname.startsWith("/sell") ||
    pathname.startsWith("/buy/") ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/admin") ||
    isThread(pathname) ||
    pathname.endsWith("/edit");
  if (hidden) return null;

  const item = (href: string, label: string, Icon: typeof IconHome, opts: { badge?: number } = {}) => {
    const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    const content = (
      <>
        {/* Keyed on active: the tab you land on hops once. */}
        <span key={String(active)} className={clsx("relative", active && "tab-hop")}>
          <Icon className="size-6" filled={active && Icon === IconHeart} />
          {!!opts.badge && <span className="absolute -right-2 -top-1 rounded-full bg-shu px-1 text-[10px] font-semibold leading-4 text-on-shu">{opts.badge}</span>}
        </span>
        <span className={clsx("max-w-full truncate text-[11px]", active && "font-semibold")}>{label}</span>
        {/* The active tab gets the logo's cinnabar seal. */}
        <span className={clsx("seal-dot", !active && "invisible")} aria-hidden />
      </>
    );
    // basis-0 + min-w-0: five equal tabs that never push past the screen edge, even at 320 px.
    const cls = clsx("flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 pb-1 pt-2", active ? "text-ink" : "text-ink-2");
    return (
      <Link key={href} href={href} className={cls}>
        {content}
      </Link>
    );
  };

  return (
    <nav data-chrome="bottom-nav" aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none md:hidden">
      {item("/", "Главная", IconHome)}
      {/* The second-hand market has its own page; the home page is the brands' showcase. */}
      {item("/resale", "Вторичка", IconTag)}
      <Link href="/sell" aria-label="Продать вещь" className="flex min-w-0 flex-1 basis-0 items-center justify-center py-1.5 text-ink">
        <span className="grid h-11 w-14 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_4px_12px_-4px_rgb(28_26_23/0.5)] transition-transform active:scale-95">
          <IconPlus className="size-6" />
        </span>
      </Link>
      {/* Open to guests too: the page itself says what signing in gives. */}
      {item("/favorites", "Избранное", IconHeart)}
      {item("/wardrobe", "Гардероб", IconHanger, { badge: me ? me.pendingSales + me.pendingOffers : 0 })}
    </nav>
  );
}

/** A guest's cart lives in the browser; the link shows its count like the signed-in one. */
function GuestCartLink() {
  const count = useGuestCart().length;
  return (
    <Link href="/cart" aria-label={count ? `Корзина, вещей: ${count}` : "Корзина"} className="relative grid size-11 place-items-center rounded-full hover:bg-ink/5">
      <IconBag />
      {count > 0 && <span className="absolute right-1 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-ink px-1 text-[11px] font-semibold leading-[18px] text-accent-ink">{count}</span>}
    </Link>
  );
}
