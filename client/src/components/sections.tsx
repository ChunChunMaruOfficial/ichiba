"use client";

import { BlurBackdrop } from "./blur-backdrop";
import { useDialog } from "@/components/dialog";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { items as itemsLabel } from "@/lib/labels";
import type { Card, Cover, SellerSummary } from "@/lib/types";
import { ItemCard } from "./item-card";
import { Chochin } from "./shop/chochin";
import { Noren } from "./shop/noren";
import { useSession } from "./session";
import { useToast } from "./toast";
import { BrandSeal, Button, ButtonLink, IconChevronRight } from "./ui";

/** The vertical brush label in cinnabar beside a title; it only decorates and repeats the Russian title. */
export function KanjiLabel({ kanji, className }: { kanji: string; className?: string }) {
  return (
    <span className={clsx("shrink-0 font-brush text-[15px] leading-none tracking-[0.15em] text-shu [writing-mode:vertical-rl]", className)} aria-hidden>
      {kanji}
    </span>
  );
}

/**
 * A page title with its brush label (新着 new arrivals, 箪笥 wardrobes …), so every page opens like the home sections.
 * The heading itself is passed in, keeping each page's own size and spacing.
 */
export function TitleWithKanji({ kanji, children, className }: { kanji: string; children: React.ReactNode; className?: string }) {
  return (
    // The label stands centred on the heading, whatever its size or number of lines.
    <div className={clsx("flex items-center gap-3", className)}>
      <KanjiLabel kanji={kanji} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Section title in Spectral with an optional vertical brush label (design/brand · SectionHeading). The kanji only
 * decorates and repeats the Russian title: 新着 new arrivals, 人気 popular, 箪笥 wardrobes, 市場 market.
 */
export function SectionHeader({ title, count, href, linkLabel = "Все", kanji }: { title: string; count?: string; href?: string; linkLabel?: string; kanji?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {kanji && <KanjiLabel kanji={kanji} />}
        <h2 className="min-w-0 text-2xl font-bold leading-tight [overflow-wrap:anywhere] md:text-[28px]">
          {title}
          {count && <span className="ml-2 font-sans text-sm font-normal tracking-normal text-muted">{count}</span>}
        </h2>
      </div>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
          {linkLabel} <IconChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}


/**
 * «Продайте то, что не носите»: the sellers' band on aizome cloth, three steps with brush numerals 一 二 三
 * (the steps are a real sequence). Shown on the home page to people who haven't listed anything yet.
 */
export function SellBand() {
  const steps: Array<[string, string, string]> = [
    ["一", "Сфотографируйте", "Вещь целиком при дневном свете и бирку с размером"],
    ["二", "ИИ заполнит описание", "Категорию, бренд, цвет и подскажет цену — вы только проверяете"],
    ["三", "Договоритесь с покупателем", "Ответьте на вопросы, примите предложение, отправьте Белпочтой или встретьтесь"],
  ];
  return (
    <section className="reveal aizome aizome-fade-r grid grid-cols-1 gap-10 rounded-[28px] px-6 pb-10 pt-28 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-14 md:px-12 md:pb-14 md:pt-36">
      {/* The shop is open: a washi noren with the crest and いちば hangs from the band's top edge. */}
      <Noren className="absolute left-1/2 top-0 w-[280px] -translate-x-1/2 md:left-12 md:w-[340px] md:translate-x-0" cloth="#f4efe6" ink="#1f3354" />
      <Chochin className="absolute right-10 top-0 hidden h-40 lg:block" delay={-1.4} />
      <div>
        <h2 className="text-4xl font-bold leading-[1.05] md:text-5xl">Продайте то, что не носите</h2>
        <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink-2">У каждой вещи в шкафу есть кто-то, кто её давно ищет. Объявление занимает около минуты.</p>
        <ButtonLink href="/sell" variant="shu" size="lg" className="mt-7">
          Продать вещь
        </ButtonLink>
      </div>
      <ol className="flex flex-col gap-6 self-center">
        {steps.map(([n, title, text]) => (
          <li key={n} className="flex items-start gap-5">
            <span aria-hidden className="w-9 shrink-0 text-center font-brush text-4xl leading-none text-shu">
              {n}
            </span>
            <div className="border-b border-line pb-5">
              <p className="text-xl font-bold">{title}</p>
              <p className="mt-1 text-[15px] text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * «Поставьте свою печать»: the call to brands on the home page. Unlike the sellers' indigo band on
 * «Вторичка», it is washi paper in a double hairline frame, like a label sewn into a garment: a big brand seal is
 * pressed in as it scrolls into view, and the three steps stand as cards joined by a cinnabar thread.
 */
export function BrandBand() {
  const steps: Array<[string, string, string]> = [
    ["一", "Заявка", "Название, УНП и ссылки на бренд в настройках профиля"],
    ["二", "Проверка", "Подтверждаем, что вы бренд или его официальный магазин"],
    ["三", "Витрина", "Печать «Бренд» на каждой вещи и место на главной"],
  ];
  return (
    <section className="reveal relative overflow-hidden rounded-[28px] bg-surface px-6 py-10 shadow-[inset_0_0_0_1px_var(--line-strong),inset_0_0_0_6px_var(--surface),inset_0_0_0_7px_var(--line)] md:px-12 md:py-14">
      {/* A huge faint 銘 by brush behind it all, cropped by the frame. */}
      <span aria-hidden className="pointer-events-none absolute -bottom-16 -right-6 select-none font-brush text-[260px] leading-none text-shu opacity-[0.06] md:text-[340px]">
        銘
      </span>
      {/* Phones: the seal above the text, which then has the full width; wider screens: side by side. */}
      <div className="relative grid grid-cols-1 items-start gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
        {/* The seal scaled up; its box is sized by hand to the scaled stamp. */}
        <span className="block h-[100px] w-[72px] md:h-[150px] md:w-[106px]">
          <BrandSeal className="origin-top-left scale-[1.8] md:scale-[2.7]" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-shu">Для брендов</p>
          <h2 className="mt-2 text-3xl font-bold leading-[1.08] md:text-5xl">Поставьте свою печать</h2>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Современные бренды и их официальные магазины получают на ichiba печать «Бренд» и собственную витрину на главной странице.
          </p>
          <ButtonLink href="/settings#brand" size="lg" className="mt-7">
            Получить печать
          </ButtonLink>
        </div>
      </div>
      <ol className="relative mt-10 grid gap-3 md:mt-12 md:grid-cols-3 md:gap-5">
        {/* The cinnabar thread the cards hang on (desktop: across, phones: down). */}
        <span aria-hidden className="absolute bottom-6 left-[27px] top-6 w-px border-l border-dashed border-shu/50 md:inset-x-10 md:bottom-auto md:left-10 md:top-[27px] md:h-px md:w-auto md:border-l-0 md:border-t" />
        {steps.map(([n, title, text], i) => (
          <li key={n} className="reveal relative flex items-start gap-4 rounded-[20px] bg-paper p-4 shadow-[inset_0_0_0_1px_var(--line)] md:flex-col md:gap-3 md:p-5" style={{ animationRange: `entry ${i * 8}% entry ${55 + i * 8}%` }}>
            <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-full bg-shu font-brush text-[13px] leading-none text-on-shu shadow-[0_0_0_4px_var(--paper)]">
              {n}
            </span>
            <div>
              <p className="text-lg font-bold">{title}</p>
              <p className="mt-0.5 text-[15px] text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A horizontal row that bleeds to the screen edges but snaps cards to the page gutter (scroll-padding), so the first
 * and the snapped card keep the same 16/24 px margin as everything else on the page.
 */
const ROW = "no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:scroll-px-6 md:px-6";

/** Horizontal row of photos (sections on Home, recommendations on Product), all cropped to one height. */
export function CardRow({ items, variant = "grid" }: { items: Card[]; variant?: "feed" | "grid" }) {
  return (
    // pb: the brand seal hangs below the photo's corner and a scrolling row would clip it.
    <div className={clsx(ROW, "pb-4")}>
      {items.map((c) => (
        <div key={c.id} className="w-[44vw] shrink-0 snap-start sm:w-56">
          <ItemCard card={c} variant={variant} uniform />
        </div>
      ))}
    </div>
  );
}

function CoverImg({ cover, alt }: { cover: Cover | null; alt: string }) {
  return cover ? (
    <span className="relative block size-full overflow-hidden">
      <BlurBackdrop src={cover.urls.s} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cover.urls.s} alt={alt} loading="lazy" className="relative size-full object-contain" />
    </span>
  ) : (
    <div className="size-full bg-skeleton" />
  );
}

export function FollowButton({ seller, onChange, size = "md" }: { seller: Pick<SellerSummary, "username" | "isFollowing">; onChange?: (v: boolean) => void; size?: "sm" | "md" }) {
  const { requireAuth } = useSession();
  const toast = useToast();
  const { confirm } = useDialog();
  return (
    <Button
      size={size}
      variant={seller.isFollowing ? "secondary" : "primary"}
      onClick={() =>
        requireAuth(
          async () => {
            const next = !seller.isFollowing;
            if (!next && !(await confirm({ title: `Отписаться от @${seller.username}?`, message: "Новые вещи продавца перестанут приходить в уведомления и в «Подписки».", confirmLabel: "Отписаться" }))) return;
            onChange?.(next);
            try {
              await api(`/follows/${seller.username}`, { method: next ? "POST" : "DELETE" });
            } catch {
              onChange?.(!next);
              toast("Не удалось сохранить изменение", { tone: "error" });
            }
          },
        )
      }
    >
      {seller.isFollowing ? "Вы подписаны ✓" : "Подписаться"}
    </Button>
  );
}

/** "Гардеробы" section: nickname, counts, 2×2 collage, follow (frame 06). */
/** Wardrobe cards: a 2×2 collage of the latest items, the nick and «Подписаться». A scrolling row, or a grid (`grid`). */
export function WardrobeCards({ wardrobes, onFollowChange, grid }: { wardrobes: Array<SellerSummary & { collage: (Cover | null)[] }>; onFollowChange: (username: string, v: boolean) => void; grid?: boolean }) {
  const router = useRouter();
  return (
    <div className={grid ? "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" : ROW}>
      {wardrobes.map((w) => (
        <div key={w.id} className={clsx("reveal rounded-[22px] bg-surface p-2.5 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[var(--shadow-paper),inset_0_0_0_1px_var(--line)]", grid ? "min-w-0" : "w-64 shrink-0 snap-start")}>
          <button onClick={() => router.push(`/u/${w.username}`)} className="grid aspect-square w-full grid-cols-2 gap-1 overflow-hidden rounded-[16px]" aria-label={`Гардероб @${w.username}`}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="overflow-hidden bg-skeleton">
                <CoverImg cover={w.collage[i] ?? null} alt="" />
              </div>
            ))}
          </button>
          <div className={clsx("mt-3 flex gap-2 px-1 pb-0.5", grid ? "flex-col max-sm:items-stretch sm:flex-row sm:items-center sm:justify-between" : "items-center justify-between")}>
            <div className="min-w-0">
              <Link href={`/u/${w.username}`} className="block truncate font-semibold hover:underline">
                @{w.username}
              </Link>
              <p className="truncate text-xs text-muted">
                {itemsLabel(w.activeCount)} · {w.soldCount} продано
              </p>
            </div>
            <FollowButton seller={w} size="sm" onChange={(v) => onFollowChange(w.username, v)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CategoryTiles({ categories }: { categories: Array<{ slug: string; label: string; count: number; cover: Cover | null }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {categories.map((c) => (
        <Link key={c.slug} href={`/search?category=${c.slug}`} className="reveal group relative aspect-[4/5] overflow-hidden rounded-[18px] bg-skeleton">
          <div className="absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-105">
            <CoverImg cover={c.cover} alt="" />
          </div>
          {/* Label over the photo, like the price tag on cards. */}
          <div className="on-photo absolute inset-x-2 bottom-2 flex items-baseline justify-between gap-2 rounded-[14px] px-3 py-2">
            <p className="truncate font-display text-[17px] font-bold leading-tight">{c.label}</p>
            <p className="tabular shrink-0 text-xs text-ink-2">{c.count}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
