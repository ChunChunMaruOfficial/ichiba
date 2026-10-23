"use client";

import { useDialog } from "@/components/dialog";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { items as itemsLabel } from "@/lib/labels";
import type { Card, Cover, SellerSummary } from "@/lib/types";
import { DragRow } from "./drag-row";
import { ItemCard } from "./item-card";
import { Chochin } from "./shop/chochin";
import { Noren } from "./shop/noren";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Button, ButtonLink, IconChevronRight } from "./ui";

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
      {/* The call comes after the steps: at the very bottom of the band, across its whole width. */}
      <ButtonLink href="/sell" variant="shu" size="lg" block className="-mt-2 md:col-span-2 md:-mt-4">
        Продать вещь
      </ButtonLink>
    </section>
  );
}

/**
 * A horizontal row (DragRow, dragged with the mouse or a finger) that bleeds to the screen edges but keeps its cards
 * on the page gutter, so the first card has the same 16/24 px margin as everything else on the page.
 */
const ROW_BLEED = "-mx-4 md:-mx-6";
const ROW = "gap-4 px-4 pb-2 md:px-6";

/** Horizontal row of photos (sections on Home, recommendations on Product), all in one frame as tall as the tallest. */
export function CardRow({ items, variant = "grid" }: { items: Card[]; variant?: "feed" | "grid" }) {
  // One frame for the whole row, as tall as its tallest photo (height to width), so no photo gets bands it doesn't
  // need; within sane bounds, so one very tall or very wide photo doesn't squeeze the rest.
  const frame = Math.min(Math.max(...items.map((c) => (c.cover ? c.cover.height / c.cover.width : 1.25)), 0.6), 1.6);
  return (
    // pb: the brand seal hangs below the photo's corner and a scrolling row would clip it.
    <DragRow snap viewportClassName={ROW_BLEED} className={clsx(ROW, "pb-4")}>
      {items.map((c) => (
        <div key={c.id} className="w-[44vw] sm:w-56">
          <ItemCard card={c} variant={variant} uniform={frame} />
        </div>
      ))}
    </DragRow>
  );
}

/**
 * The photo covers its frame edge to edge, cropped to it (square collage cells, 4:5 category tiles). `large` takes the
 * bigger variant for a big frame.
 */
function CoverImg({ cover, alt, large }: { cover: Cover | null; alt: string; large?: boolean }) {
  return cover ? (
    <span className="relative block size-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={large ? cover.urls.m : cover.urls.s} alt={alt} loading="lazy" className="relative size-full object-cover" />
    </span>
  ) : (
    <div className="size-full bg-skeleton" />
  );
}

export function FollowButton({ seller, onChange, size = "md", block }: { seller: Pick<SellerSummary, "username" | "isFollowing">; onChange?: (v: boolean) => void; size?: "sm" | "md"; block?: boolean }) {
  const { requireAuth } = useSession();
  const toast = useToast();
  const { confirm } = useDialog();
  return (
    <Button
      size={size}
      block={block}
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
/** A wardrobe whose collage is full: four photos, no empty grey cells (feed blocks show only these). */
export const fullCollage = (w: { collage: (Cover | null)[] }) => w.collage.length >= 4 && w.collage.slice(0, 4).every(Boolean);

export function WardrobeCards({ wardrobes, onFollowChange, grid }: { wardrobes: Array<SellerSummary & { collage: (Cover | null)[] }>; onFollowChange: (username: string, v: boolean) => void; grid?: boolean }) {
  const router = useRouter();
  const cards = wardrobes.map((w) => (
        <div key={w.id} className={clsx("reveal rounded-[22px] bg-surface p-2.5 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[var(--shadow-paper),inset_0_0_0_1px_var(--line)]", grid ? "min-w-0" : "w-64")}>
          <button onClick={() => router.push(`/u/${w.username}`)} className="grid aspect-square w-full grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-[16px]" aria-label={`Гардероб @${w.username}`}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="min-h-0 overflow-hidden bg-skeleton">
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
  ));
  return grid ? (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{cards}</div>
  ) : (
    <DragRow snap viewportClassName={ROW_BLEED} className={ROW}>
      {cards}
    </DragRow>
  );
}

export function CategoryTiles({ categories }: { categories: Array<{ slug: string; label: string; count: number; cover: Cover | null }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {categories.map((c) => (
        <Link key={c.slug} href={`/search?category=${c.slug}`} className="reveal group relative aspect-[4/5] overflow-hidden rounded-[18px] bg-skeleton">
          <div className="absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-105">
            <CoverImg cover={c.cover} alt="" large />
          </div>
          {/* A slip of washi 和紙 with a torn top edge: the name in ink, the count stamped in cinnabar. */}
          <div className="washi-slip absolute inset-x-2 bottom-2">
            <div className="washi-slip-paper flex items-center justify-between gap-2 px-3 pb-2 pt-3">
              <span className="truncate font-display text-[17px] font-bold leading-tight">{c.label}</span>
              <span className="washi-slip-count tabular shrink-0">{c.count}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
