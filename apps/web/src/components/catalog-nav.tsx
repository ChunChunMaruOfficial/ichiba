"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Gender, Meta } from "@/lib/types";
import { useBrandSuggestions } from "./brand-picker";
import { useMeta } from "./session";
import { IconChevronDown, IconChevronRight, IconSearch, IconX } from "./ui";

type Category = Meta["categories"][number];
/** Audience filter of the menu: "" = everything. */
type Audience = Gender | "";
const BRANDS = "__brands__";

const genderQuery = (g: Audience) => (g ? `&gender=${g}` : "");
const categoryHref = (c: string, sub?: string, g: Audience = "") => `/search?category=${c}${sub ? `&subcategory=${sub}` : ""}${genderQuery(g)}`;
const brandHref = (b: string, c?: string, g: Audience = "") => `/search?brand=${encodeURIComponent(b)}${c ? `&category=${c}` : ""}${genderQuery(g)}`;
const forAudience = (categories: Category[], g: Audience) => (g ? categories.filter((c) => !c.genders || c.genders.includes(g)) : categories);

/** "Все · Женщинам · Мужчинам" switch on top of the menu. */
function AudienceTabs({ meta, value, onChange }: { meta: Meta; value: Audience; onChange: (g: Audience) => void }) {
  const tabs: Array<[Audience, string]> = [["", "Все"], ...meta.genders.map((g) => [g.value, g.menu] as [Audience, string])];
  return (
    <div role="tablist" aria-label="Для кого" className="flex gap-1 rounded-full bg-paper p-1">
      {tabs.map(([g, label]) => (
        <button
          key={g || "all"}
          type="button"
          role="tab"
          aria-selected={value === g}
          onClick={() => onChange(g)}
          onMouseEnter={() => onChange(g)}
          className={clsx("flex-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm", value === g ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Pages with their own focused layout: no catalogue bar there. */
const hiddenOn = (p: string) =>
  p.startsWith("/sell") || p.startsWith("/buy/") || p.startsWith("/welcome") || p.startsWith("/admin") || /^\/messages\/.+/.test(p) || p.endsWith("/edit");

function IconGrid({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={clsx("size-5", className)} aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

/** Subcategories of one category plus its popular brands, or the brand directory. */
function PanelBody({ meta, active, audience, onNavigate }: { meta: Meta; active: string; audience: Audience; onNavigate: () => void }) {
  if (active === BRANDS) return <BrandDirectory meta={meta} audience={audience} onNavigate={onNavigate} />;
  const list = forAudience(meta.categories, audience);
  const c = list.find((x) => x.slug === active) ?? list[0];
  const who = meta.genders.find((g) => g.value === audience)?.menu;
  return (
    <div className="flex min-w-0 flex-1 gap-10">
      <div className="min-w-0 flex-1">
        <Link href={categoryHref(c.slug, undefined, audience)} onClick={onNavigate} className="group mb-4 inline-flex items-center gap-1 text-lg font-semibold hover:text-accent">
          {who && <span className="font-normal text-muted">{who} ·</span>}
          {c.label}
          <IconChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 xl:grid-cols-3">
          {c.subcategories.map((s) => (
            <li key={s.slug}>
              <Link href={categoryHref(c.slug, s.slug, audience)} onClick={onNavigate} className="block rounded-lg py-1.5 text-[15px] text-ink-2 hover:text-ink">
                {s.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href={categoryHref(c.slug, undefined, audience)} onClick={onNavigate} className="block rounded-lg py-1.5 text-[15px] font-medium text-accent hover:underline">
              Все вещи
            </Link>
          </li>
        </ul>
      </div>
      <div className="hidden w-52 shrink-0 lg:block">
        <p className="mb-3 text-sm text-muted">Популярные бренды</p>
        <ul className="flex flex-col gap-1">
          {meta.brands.slice(0, 9).map((b) => (
            <li key={b}>
              <Link href={brandHref(b, c.slug, audience)} onClick={onNavigate} className="block py-1 text-[15px] text-ink-2 hover:text-ink">
                {b}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BrandDirectory({ meta, audience = "", onNavigate }: { meta: Meta; audience?: Audience; onNavigate: () => void }) {
  const [q, setQ] = useState("");
  const { items } = useBrandSuggestions(q, !!q.trim(), 24);
  const list = q.trim() ? items : meta.brands;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">Бренды</p>
        <label className="flex h-10 w-full max-w-xs items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 focus-within:border-ink">
          <IconSearch className="size-4 text-muted" />
          <span className="sr-only">Найти бренд</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Найти среди 5 000 брендов"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-sm text-muted">Такого бренда нет в каталоге — попробуйте поиск по названию</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 xl:grid-cols-4">
          {list.map((b) => (
            <li key={b}>
              <Link href={brandHref(b, undefined, audience)} onClick={onNavigate} className="block truncate py-1.5 text-[15px] text-ink-2 hover:text-ink">
                {b}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Left rail of the mega menu: categories, then brands. Hover or focus switches the right side. */
function Rail({ categories, active, audience, setActive, onNavigate }: { categories: Category[]; active: string; audience: Audience; setActive: (s: string) => void; onNavigate: () => void }) {
  const row = (key: string, label: string, href: string) => (
    <li key={key}>
      <Link
        href={href}
        onClick={onNavigate}
        onMouseEnter={() => setActive(key)}
        onFocus={() => setActive(key)}
        className={clsx("flex items-center justify-between rounded-xl px-3 py-2 text-[15px]", active === key ? "bg-paper font-medium text-ink" : "text-ink-2 hover:text-ink")}
      >
        {label}
        <IconChevronRight className={clsx("size-4", active === key ? "text-ink" : "text-transparent")} />
      </Link>
    </li>
  );
  return (
    <ul className="flex w-60 shrink-0 flex-col border-r border-line pr-4">
      {forAudience(categories, audience).map((c) => row(c.slug, c.label, categoryHref(c.slug, undefined, audience)))}
      <li className="my-1.5 border-t border-line" aria-hidden />
      {row(BRANDS, "Бренды", audience ? `/search?gender=${audience}` : "/search")}
    </ul>
  );
}

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, close, ref]);
}

function MegaPanel({
  meta,
  active,
  setActive,
  audience,
  setAudience,
  onNavigate,
}: {
  meta: Meta;
  active: string;
  setActive: (s: string) => void;
  audience: Audience;
  setAudience: (g: Audience) => void;
  onNavigate: () => void;
}) {
  return (
    <div
      className="fade-in absolute inset-x-0 top-full z-50 border-b border-line bg-surface shadow-[0_24px_48px_-24px_rgb(30_36_51/0.25)]"
    >
      <div className="mx-auto max-h-[min(72vh,600px)] max-w-[1440px] overflow-y-auto px-6 py-5">
        <div className="mb-4 w-fit">
          <AudienceTabs meta={meta} value={audience} onChange={setAudience} />
        </div>
        <div className="flex gap-8">
          <Rail categories={meta.categories} active={active} audience={audience} setActive={setActive} onNavigate={onNavigate} />
          <PanelBody meta={meta} active={active} audience={audience} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}

/** "Каталог" button in the sticky header (desktop): the mega menu opens right under the header. */
export function CatalogButton({ anchor }: { anchor: React.RefObject<HTMLElement | null> }) {
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const [audience, setAudience] = useState<Audience>("");
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, anchor);
  if (!meta) return <span className="hidden h-11 w-28 md:block" />;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setActive((a) => a || meta.categories[0].slug);
          setOpen((v) => !v);
        }}
        className={clsx(
          "hidden h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold md:inline-flex",
          open ? "bg-ink text-white" : "bg-surface ring-1 ring-line-strong hover:ring-ink",
        )}
      >
        {open ? <IconX className="size-5" /> : <IconGrid />}
        Каталог
      </button>
      {open && <MegaPanel meta={meta} active={active || meta.categories[0].slug} setActive={setActive} audience={audience} setAudience={setAudience} onNavigate={close} />}
    </>
  );
}

/** Mobile catalogue: a drawer with categories that expand into subcategories, and the brand directory. */
export function MobileCatalog() {
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>("");
  const pathname = usePathname();
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!meta || hiddenOn(pathname)) return null;
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        aria-label="Каталог"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-black/5 md:hidden"
      >
        <IconGrid className="size-6" />
      </button>
      {/* Portal: the header's backdrop-filter would otherwise trap position:fixed inside the header box. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Каталог">
            <button type="button" aria-label="Закрыть каталог" className="fade-in absolute inset-0 bg-black/30" onClick={close} />
            <div className="slide-in-left absolute inset-y-0 left-0 flex w-[min(88vw,380px)] flex-col bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
                <p className="text-lg font-semibold">Каталог</p>
                <button type="button" aria-label="Закрыть" onClick={close} className="-mr-2 grid size-11 place-items-center rounded-full hover:bg-black/5">
                  <IconX />
                </button>
              </div>
              <div className="shrink-0 px-3 pt-3">
                <AudienceTabs meta={meta} value={audience} onChange={setAudience} />
              </div>
              <ul className="flex-1 overflow-y-auto px-2 py-2">
                {forAudience(meta.categories, audience).map((c) => {
                  const isOpen = expanded === c.slug;
                  return (
                    <li key={c.slug} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : c.slug)}
                        className="flex w-full items-center justify-between px-3 py-3.5 text-left text-[16px]"
                      >
                        {c.label}
                        <IconChevronDown className={clsx("size-5 text-muted transition-transform", isOpen && "rotate-180")} />
                      </button>
                      {isOpen && (
                        <ul className="grid grid-cols-2 gap-x-3 px-3 pb-3">
                          <li className="col-span-2">
                            <Link href={categoryHref(c.slug, undefined, audience)} onClick={close} className="block py-2 text-[15px] font-medium text-accent">
                              Все вещи
                            </Link>
                          </li>
                          {c.subcategories.map((s) => (
                            <li key={s.slug}>
                              <Link href={categoryHref(c.slug, s.slug, audience)} onClick={close} className="block py-2 text-[15px] text-ink-2">
                                {s.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    aria-expanded={expanded === BRANDS}
                    onClick={() => setExpanded(expanded === BRANDS ? null : BRANDS)}
                    className="flex w-full items-center justify-between px-3 py-3.5 text-left text-[16px] font-medium"
                  >
                    Бренды
                    <IconChevronDown className={clsx("size-5 text-muted transition-transform", expanded === BRANDS && "rotate-180")} />
                  </button>
                  {expanded === BRANDS && (
                    <div className="px-3 pb-3">
                      <BrandDirectory meta={meta} audience={audience} onNavigate={close} />
                    </div>
                  )}
                </li>
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
