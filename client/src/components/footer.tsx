"use client";

import { SakuraBranch } from "./shop/sakura-branch";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { reopenConsent } from "@/lib/analytics";
import { glideToTop } from "@/lib/glide";
import { LEGAL } from "@/lib/legal";
import { PRIVATE_SECTIONS } from "@/lib/private-routes";
import { Wordmark } from "./logo";
import { focusedFlow } from "./header";
import { Kamon } from "./shop/kamon";
import { LiveCount } from "./live-count";

/** A link into one visitor's own section (noindex, disallowed in robots.txt): crawlers needn't follow it. */
const isPrivate = (href: string) => (PRIVATE_SECTIONS as readonly string[]).includes(href.split(/[/?#]/)[1] ?? "");

/** Not a page: the link brings the cookie notice back to change the choice. */
const COOKIE_SETTINGS = "#cookie-settings";

/**
 * A footer link is read from the bottom of a page: the page it opens (or the same page, with a query) must start at
 * its top. The page glides there first (lib/glide.ts) and only then the link is followed, so the next page never
 * jumps in halfway through the glide. A new tab (modifier keys, middle button) goes as usual.
 */
function useGlideClick() {
  const router = useRouter();
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute("href") ?? "";
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !href.startsWith("/")) return;
    e.preventDefault();
    void glideToTop().then(() => router.push(href));
  };
}

/** A link in the requisites under the columns: mail, phones (tel:) and the complaint form. */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const className = "whitespace-nowrap underline-offset-4 hover:text-ink hover:underline";
  const onClick = useGlideClick();
  return href.startsWith("/") ? (
    <Link href={href} onClick={onClick} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

const COLUMNS: Array<[string, Array<[string, string]>]> = [
  // The category and brand pages (/c, /brands): linked from every page, so search engines find and weigh them.
  [
    "Каталог",
    [
      ["/c/outerwear", "Верхняя одежда"],
      ["/c/knitwear", "Свитера и худи"],
      ["/c/tshirts", "Футболки"],
      ["/c/jeans", "Джинсы"],
      ["/c/trousers", "Брюки"],
      ["/c/shoes", "Обувь"],
      ["/c/bags", "Сумки"],
      ["/brands", "Все бренды"],
    ],
  ],
  [
    "Покупателям",
    [
      ["/", "Лента"],
      ["/?filters=1", "Поиск и фильтры"],
      ["/resale?chip=auctions", "Аукционы"],
      ["/favorites", "Избранное"],
      ["/how-it-works", "Как работает сделка"],
      // The journal (app/journal): linked from every page, so its guides are found and weighed like the catalogue.
      ["/journal", "Журнал"],
    ],
  ],
  [
    "Продавцам",
    [
      ["/sellers", "Открыть лавку"],
      ["/sell", "Продать вещь"],
      ["/wardrobe", "Мой гардероб"],
      ["/sales", "Продажи и статистика"],
      ["/how-it-works", "Как работает сделка"],
    ],
  ],
  [
    "ichiba",
    [
      ["/contacts", "Контакты"],
      ["/rules", "Правила площадки"],
      ["/terms", "Пользовательское соглашение"],
      ["/privacy", "Политика конфиденциальности"],
      ["/complaint", "Жалобы и обращения"],
      [COOKIE_SETTINGS, "Настройки cookie"],
      ["/settings", "Настройки"],
      // The company deck (app/presentation).
      ["/presentation", "Презентация"],
    ],
  ],
];

/**
 * Site footer on aizome 藍染 cloth (globals.css · .aizome), link columns, and the wordmark set huge and cropped
 * by the bottom edge (washi letters, cinnabar seals). Hidden on focused flows that pin their own bottom bar.
 * On a desktop it is exactly one screen tall: the columns and the requisites take what they need, the wordmark
 * fills what is left, scaled to fit, its bottom past the edge.
 */
export function Footer() {
  const pathname = usePathname();
  const onClick = useGlideClick();
  if (focusedFlow(pathname)) return null;
  return (
    // On phones the tab bar's room is kept below the cloth, not in it: at the end of the page the footer ends right on the
    // bar. The cloth tucks 1 px under the bar's top edge, so a fractional page height never leaves a hairline of paper.
    <div data-chrome="footer" className="relative mt-12 pb-[calc(var(--tabbar-h)-1px+env(safe-area-inset-bottom))] md:mt-16 md:pb-0">
      {/* A cherry branch in bloom behind the page: it grows out from the footer's edge and whatever sits above (cards) covers it. */}
      <SakuraBranch className="pointer-events-none absolute bottom-full right-0 -z-10 w-[340px] md:right-6 md:w-[600px]" />
    <footer className="aizome aizome-fade-in md:flex md:h-[100svh] md:flex-col md:overflow-hidden">
      <Kamon className="pointer-events-none absolute -right-16 top-10 size-[340px] text-ink opacity-[0.06] md:right-10 md:size-[420px]" />
      <div className="relative mx-auto w-full max-w-[1440px] px-4 pt-14 md:px-6 md:pt-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div className="max-w-sm">
            <p className="font-display text-3xl font-bold leading-tight text-ink">Вещи с историей</p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Маркетплейс одежды из открытых гардеробов Беларуси. Продавайте то, что не носите, и находите то, что давно искали.
            </p>
            {/* On «Вторичка» the call to sell one's own things; everywhere else how many things the whole site has on sale. */}
            {pathname.startsWith("/resale") ? (
              <Link href="/sell" onClick={onClick} rel="nofollow" className="btn-wa btn-wa-shu mt-6 inline-flex h-11 items-center rounded-xl px-5 text-[15px] font-semibold">
                Продать вещь
              </Link>
            ) : (
              <LiveCount className="mt-6" />
            )}
          </div>
          {COLUMNS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">{title}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {links.map(([href, label]) => (
                  <li key={href}>
                    {href === COOKIE_SETTINGS ? (
                      <button type="button" onClick={reopenConsent} className="text-left text-[15px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                        {label}
                      </button>
                    ) : (
                      <Link href={href} onClick={onClick} rel={isPrivate(href) ? "nofollow" : undefined} className="text-[15px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-line pt-5 text-sm text-muted">
          {/* What a marketplace must show on its main page (Правила дистанционной торговли, пост. СМ № 31, п. 14.1):
              who runs it, how to reach it and when, where buyers complain. */}
          <div className="flex max-w-4xl flex-col gap-1.5 leading-relaxed">
            <p>
              © {new Date().getFullYear()} ichiba · Беларусь · <FooterLink href={`mailto:${LEGAL.email}`}>{LEGAL.email}</FooterLink> · <FooterLink href={LEGAL.phone.href}>{LEGAL.phone.shown}</FooterLink>, {LEGAL.hours.shown}
            </p>
            <p className="text-[13px]">
              {LEGAL.operator}, УНП {LEGAL.unp}, дата регистрации {LEGAL.registered.shown} · {LEGAL.address}
            </p>
            <p className="text-[13px]">
              Жалобы покупателей: <FooterLink href={LEGAL.complaintsPhone.href}>{LEGAL.complaintsPhone.shown}</FooterLink> или <FooterLink href="/complaint">форма на сайте</FooterLink>. Обращения о торговле
              также принимает {LEGAL.authority.name}:{" "}
              {LEGAL.authority.phones.map((p, i) => (
                <span key={p.href}>
                  {i > 0 && ", "}
                  <FooterLink href={p.href}>{p.shown}</FooterLink>
                </span>
              ))}
              .
            </p>
          </div>
          <span className="flex items-center gap-2 text-shu">
            <Kamon className="size-6" title="Герб ichiba: 市 в круге" />
            <span className="font-brush text-base tracking-[0.2em]" lang="ja">
              古着市場
            </span>
          </span>
        </div>
      </div>
      {/* The wordmark, huge, its bottom cut off by the page edge. On a desktop it takes the room left under the
          requisites, as tall as that room (the footer clips what the negative margin pushes past its edge). */}
      <div aria-hidden className="pointer-events-none relative -mb-[4.5vw] mt-6 select-none px-2 text-ink md:-mb-[3.5vw] md:flex md:min-h-0 md:flex-1 md:items-end">
        <Wordmark className="h-auto w-full opacity-95 md:h-full md:w-auto md:max-w-full" />
      </div>
    </footer>
    </div>
  );
}
