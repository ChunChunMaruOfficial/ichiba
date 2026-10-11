"use client";

import { SakuraBranch } from "./shop/sakura-branch";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./logo";
import { Kamon } from "./shop/kamon";

const COLUMNS: Array<[string, Array<[string, string]>]> = [
  [
    "Покупателям",
    [
      ["/", "Лента"],
      ["/search", "Поиск и фильтры"],
      ["/?chip=auctions", "Аукционы"],
      ["/favorites", "Избранное"],
    ],
  ],
  [
    "Продавцам",
    [
      ["/sell", "Продать вещь"],
      ["/wardrobe", "Мой гардероб"],
      ["/sales", "Продажи и статистика"],
      ["/settings#sizes", "Мои размеры"],
    ],
  ],
  [
    "ichiba",
    [
      ["/terms", "Пользовательское соглашение"],
      ["/privacy", "Политика конфиденциальности"],
      ["/privacy#cookies", "Cookie"],
      ["/settings", "Настройки"],
    ],
  ],
];

/**
 * Site footer on aizome 藍染 cloth (globals.css · .aizome), link columns, and the wordmark set huge and cropped
 * by the bottom edge (washi letters, cinnabar seals). Hidden on focused flows that pin their own bottom bar.
 */
export function Footer() {
  const pathname = usePathname();
  const hidden =
    pathname.startsWith("/sell") || pathname.startsWith("/buy/") || pathname.startsWith("/welcome") || pathname.startsWith("/admin") || /^\/messages\/.+/.test(pathname) || pathname.endsWith("/edit");
  if (hidden) return null;
  return (
    <div data-chrome="footer" className="relative mt-12 md:mt-16">
      {/* A cherry branch in bloom behind the page: it grows out from the footer's edge and whatever sits above (cards) covers it. */}
      <SakuraBranch className="pointer-events-none absolute bottom-full right-0 -z-10 w-[340px] md:right-6 md:w-[600px]" />
    <footer className="aizome aizome-fade-in">
      <Kamon className="pointer-events-none absolute -right-16 top-10 size-[340px] text-ink opacity-[0.06] md:right-10 md:size-[420px]" />
      <div className="relative mx-auto max-w-[1440px] px-4 pt-14 md:px-6 md:pt-20">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
          <div className="max-w-sm">
            <p className="font-display text-3xl font-bold leading-tight text-ink">Вещи с историей</p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Маркетплейс одежды из открытых гардеробов Беларуси. Продавайте то, что не носите, и находите то, что давно искали.
            </p>
            <Link href="/sell" className="btn-wa btn-wa-shu mt-6 inline-flex h-11 items-center rounded-xl px-5 text-[15px] font-semibold">
              Продать вещь
            </Link>
          </div>
          {COLUMNS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">{title}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {links.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="text-[15px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-muted">
          <span>© {new Date().getFullYear()} ichiba · Беларусь</span>
          <span className="flex items-center gap-2 text-shu">
            <Kamon className="size-6" title="Герб ichiba: 市 в круге" />
            <span className="font-brush text-base tracking-[0.2em]" lang="ja">
              古着市場
            </span>
          </span>
        </div>
      </div>
      {/* The wordmark, huge, its bottom cut off by the page edge. */}
      <div aria-hidden className="pointer-events-none relative -mb-[4.5vw] mt-6 select-none px-2 text-ink md:-mb-[3.5vw]">
        <Wordmark className="h-auto w-full opacity-95" />
      </div>
      <div className="h-[calc(76px+env(safe-area-inset-bottom))] md:hidden" />
    </footer>
    </div>
  );
}
