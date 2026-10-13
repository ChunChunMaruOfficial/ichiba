"use client";

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
import { Button, ButtonLink, IconChevronRight } from "./ui";

/**
 * Section title in Spectral with an optional vertical brush label (design/brand · SectionHeading). The kanji only
 * decorates and repeats the Russian title: 新着 new arrivals, 人気 popular, 箪笥 wardrobes, 市場 market.
 */
export function SectionHeader({ title, count, href, linkLabel = "Все", kanji }: { title: string; count?: string; href?: string; linkLabel?: string; kanji?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {kanji && (
          <span className="pt-1 font-brush text-[15px] leading-none tracking-[0.15em] text-shu [writing-mode:vertical-rl]" aria-hidden>
            {kanji}
          </span>
        )}
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
    <section className="aizome aizome-fade-r grid grid-cols-1 gap-10 rounded-[28px] px-6 pb-10 pt-28 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-14 md:px-12 md:pb-14 md:pt-36">
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

/** Horizontal row of photos (sections on Home, recommendations on Product), all cropped to one height. */
export function CardRow({ items, variant = "grid" }: { items: Card[]; variant?: "feed" | "grid" }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
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
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cover.urls.s} alt={alt} loading="lazy" className="size-full object-contain" />
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
    <div className={grid ? "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" : "no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6"}>
      {wardrobes.map((w) => (
        <div key={w.id} className={clsx("rounded-[22px] bg-surface p-2.5 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[var(--shadow-paper),inset_0_0_0_1px_var(--line)]", grid ? "min-w-0" : "w-64 shrink-0 snap-start")}>
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
        <Link key={c.slug} href={`/search?category=${c.slug}`} className="group relative aspect-[4/5] overflow-hidden rounded-[18px] bg-skeleton">
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
