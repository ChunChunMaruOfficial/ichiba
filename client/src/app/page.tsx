"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { CardRow, CategoryTiles, SectionHeader, SellBand, WardrobeCards } from "@/components/sections";
import { useSession } from "@/components/session";
import { Noren } from "@/components/shop/noren";
import { SwipeDeck } from "@/components/swipe-deck";
import { ButtonLink, Chip, EmptyState, ErrorState, IconFilter, Spinner } from "@/components/ui";
import { useInfiniteCards, useSentinel } from "@/lib/hooks";
import type { Card, Cover, SellerSummary } from "@/lib/types";

interface HomeData {
  totalVisible: number;
  newToday: number;
  fresh: Card[];
  popular: Card[];
  wardrobes: Array<SellerSummary & { collage: (Cover | null)[] }>;
  categories: Array<{ slug: string; label: string; count: number; cover: Cover | null }>;
  forYouAvailable: boolean;
}

const CHIPS = [
  ["for_you", "Для вас"],
  ["new", "Новое"],
  ["popular", "Популярное"],
  ["auctions", "Аукционы"],
  // Categories live in «Каталог» in the header; the feed keeps only ways to sort the stream.
  ["under_50", "До 50 BYN"],
] as const;

const FIRST_SCREEN = 24;

function HomeFeed() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, loading: sessionLoading } = useSession();
  const home = useSWR<HomeData>(sessionLoading ? null : "/home");
  const forYou = !!home.data?.forYouAvailable;
  // Default chip: «Для вас» for returning users, «Новое» for new ones (frame 06).
  const chip = params.get("chip") ?? (forYou ? "for_you" : "new");
  const feed = useInfiniteCards<{ items: Card[]; total: number; chip: string }>((offset) =>
    sessionLoading || !home.data ? null : `/feed?chip=${chip}&offset=${offset}&limit=${FIRST_SCREEN}`,
  );
  const sentinel = useSentinel(feed.loadMore, !feed.done);

  const setChip = (c: string) => router.replace(c === (forYou ? "for_you" : "new") ? "/" : `/?chip=${c}`, { scroll: false });
  const isDefaultChip = !params.get("chip");
  const smallCatalog = (home.data?.totalVisible ?? 0) < 8;
  const [first, rest] = [feed.items.slice(0, FIRST_SCREEN), feed.items.slice(FIRST_SCREEN)];

  const chips = CHIPS.filter(([key]) => key !== "for_you" || (me && forYou));
  // «Свайп» mode (decision D2): one item at a time, right = ♡, left = не моё.
  const swipeMode = params.get("mode") === "swipe";
  const setMode = (mode: "feed" | "swipe") => router.replace(mode === "swipe" ? "/?mode=swipe" : "/", { scroll: false });

  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-6">
      {/* Discovery bar */}
      <div className="sticky top-[var(--header-offset,113px)] z-30 transition-[top] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none -mx-4 bg-washi px-4 pb-3 pt-4 md:-mx-6 md:px-6">
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Режим просмотра" className="flex shrink-0 rounded-full bg-surface p-0.5 text-sm shadow-[inset_0_0_0_1px_var(--line-strong)]">
            {(
              [
                ["feed", "Лента"],
                ["swipe", "Свайп"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                role="radio"
                aria-checked={(m === "swipe") === swipeMode}
                onClick={() => setMode(m)}
                className={`h-8 rounded-full px-3.5 font-medium transition-colors ${(m === "swipe") === swipeMode ? "bg-ink text-accent-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {!swipeMode && (
            <div className="no-scrollbar -my-2 flex gap-2 overflow-x-auto py-2">
              {chips.map(([key, label]) => (
                <Chip key={key} active={chip === key} onClick={() => setChip(key)}>
                  {label}
                </Chip>
              ))}
              <Chip onClick={() => router.push("/search?filters=1")}>
                <IconFilter className="size-4" /> Фильтры
              </Chip>
            </div>
          )}
        </div>
      </div>

      {swipeMode ? (
        <div className="py-6">
          <SwipeDeck context="swipe_mode" limit={30} />
        </div>
      ) : home.error || feed.error ? (
        <ErrorState message="Не удалось загрузить вещи" onRetry={() => (home.mutate(), feed.mutate())} />
      ) : !feed.data ? (
        <div className="pt-2">
          <MasonrySkeleton />
        </div>
      ) : feed.items.length === 0 ? (
        smallCatalog ? (
          <EmptyState art={<Noren className="mb-2 w-64" />} title="Вещей пока мало" hint="Загляните скоро или выставьте свою — это займёт около минуты">
            <ButtonLink href="/sell" variant="shu">Продать вещь</ButtonLink>
          </EmptyState>
        ) : (
          <EmptyState title="В этой категории пока ничего нет" hint="Посмотрите другие разделы">
            {CHIPS.filter(([k]) => k !== chip && k !== "for_you")
              .slice(0, 3)
              .map(([k, l]) => (
                <Chip key={k} onClick={() => setChip(k)}>
                  {l}
                </Chip>
              ))}
          </EmptyState>
        )
      ) : (
        <>
          {smallCatalog && <p className="mb-4 text-sm text-muted">Вещей пока мало — загляните скоро или выставьте свою.</p>}
          <div className="pt-2">
            <Masonry items={first} variant="feed" source="feed" />
          </div>

          {isDefaultChip && home.data && !smallCatalog && (
            <div className="flex flex-col gap-16 py-12 md:gap-24 md:py-16">
              {home.data.fresh.length > 0 && chip !== "new" && (
                <section>
                  <SectionHeader kanji="新着" title="Новинки" count={home.data.newToday ? `опубликовано сегодня: ${home.data.newToday}` : undefined} href="/?chip=new" />
                  <CardRow items={home.data.fresh} />
                </section>
              )}
              {home.data.popular.length > 0 && (
                <section>
                  <SectionHeader kanji="人気" title="Популярное" href="/search?sort=popular" />
                  <CardRow items={home.data.popular} />
                </section>
              )}
              {!me?.isSeller && <SellBand />}
              {home.data.wardrobes.length > 0 && (
                <section>
                  <SectionHeader kanji="箪笥" title="Гардеробы" />
                  <WardrobeCards
                    wardrobes={home.data.wardrobes}
                    onFollowChange={(username, v) =>
                      home.mutate((d) => d && { ...d, wardrobes: d.wardrobes.map((w) => (w.username === username ? { ...w, isFollowing: v, followers: w.followers + (v ? 1 : -1) } : w)) }, { revalidate: false })
                    }
                  />
                </section>
              )}
              {home.data.categories.length > 0 && (
                <section>
                  <SectionHeader kanji="市場" title="Категории" />
                  <CategoryTiles categories={home.data.categories} />
                </section>
              )}
              {rest.length > 0 && <SectionHeader title="Ещё вещи" />}
            </div>
          )}

          {rest.length > 0 && (
            <div className={isDefaultChip ? "" : "pt-4"}>
              <Masonry items={rest} variant="feed" source="feed" />
            </div>
          )}
          <div ref={sentinel} className="flex h-24 items-center justify-center">
            {feed.loadingMore && <Spinner className="text-muted" />}
          </div>
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeFeed />
    </Suspense>
  );
}
