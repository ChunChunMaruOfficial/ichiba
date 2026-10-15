"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useLayoutEffect, useState } from "react";
import useSWR from "swr";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { SectionHeader, SellBand, WardrobeCards } from "@/components/sections";
import { useSession } from "@/components/session";
import { DragRow } from "@/components/drag-row";
import { SwipeDeck } from "@/components/swipe-deck";
import { ButtonLink, Chip, EmptyState, ErrorState, IconFilter, Spinner } from "@/components/ui";
import { useInfiniteCards, useSentinel } from "@/lib/hooks";
import type { Card, Cover, SellerSummary } from "@/lib/types";

type Wardrobe = SellerSummary & { collage: (Cover | null)[] };

const CHIPS = [
  ["for_you", "Для вас"],
  ["new", "Новое"],
  ["popular", "Популярное"],
  ["auctions", "Аукционы"],
  ["under_50", "До 50 BYN"],
] as const;

const PAGE = 24;

/**
 * «Вторичка» 古着: the second-hand market, everything from private sellers (brands have the home page to themselves).
 * The phone tab bar leads here instead of «Гардеробы».
 */
function ResaleFeed() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, loading: sessionLoading } = useSession();
  const chip = params.get("chip") ?? "new";
  const setChip = (c: string) => router.replace(c === "new" ? "/resale" : `/resale?chip=${c}`, { scroll: false });
  const feed = useInfiniteCards<{ items: Card[]; total: number; chip: string }>((offset) =>
    sessionLoading ? null : `/feed?chip=${chip}&market=resale&offset=${offset}&limit=${PAGE}`,
  );
  const sentinel = useSentinel(feed.loadMore, !feed.done);
  const wardrobes = useSWR<{ items: Wardrobe[] }>("/wardrobes?limit=10");
  const chips = CHIPS.filter(([key]) => key !== "for_you" || me);

  // «Свайп» here deals only second-hand items, as the home page's deals only brands.
  const setMode = (mode: "feed" | "swipe") => router.replace(mode === "swipe" ? "/resale?mode=swipe" : "/resale", { scroll: false });
  const swipeProbe = useSWR<{ items: Card[] }>(sessionLoading ? null : "/swipe/deck?context=swipe_mode&market=resale&limit=1", { revalidateOnFocus: false });
  const [swipeEmpty, setSwipeEmpty] = useState(false);
  const noSwipe = swipeEmpty || swipeProbe.data?.items.length === 0;
  const swipeMode = params.get("mode") === "swipe" && !noSwipe;
  const onSwipeEmpty = useCallback(() => {
    setSwipeEmpty(true);
    router.replace("/resale", { scroll: false });
  }, [router]);
  // Swiping takes the whole screen, as on the home page (globals.css, html[data-immersive]).
  useLayoutEffect(() => {
    if (!swipeMode) return;
    const root = document.documentElement;
    root.dataset.immersive = "";
    window.scrollTo(0, 0);
    return () => {
      delete root.dataset.immersive;
    };
  }, [swipeMode]);

  const modeSwitch = !noSwipe && (
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
  );

  if (swipeMode) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 md:px-6">
        <div className="flex pt-4">{modeSwitch}</div>
        <div className="py-6">
          <SwipeDeck context="swipe_mode" market="resale" limit={30} onEmpty={onSwipeEmpty} />
        </div>
      </div>
    );
  }

  // Laid out like the home page: the chips on top, the first screen of items, then the wardrobes and «Продайте»,
  // then the rest of the feed under «Ещё вещи».
  const [first, rest] = [feed.items.slice(0, PAGE), feed.items.slice(PAGE)];
  const sections = chip === "new" && feed.items.length > 0;
  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-6">
      <div className="under-header z-30 -mx-4 px-4 pb-3 pt-4 md:-mx-6 md:px-6">
        <DragRow viewportClassName="-mx-4 -my-2 md:-mx-6" className="items-center gap-3 px-4 py-2 md:px-6">
          {modeSwitch}
          <div className="flex shrink-0 gap-2">
            {chips.map(([key, label]) => (
              <Chip key={key} active={chip === key} onClick={() => setChip(key)}>
                {label}
              </Chip>
            ))}
            <Chip onClick={() => router.push("/search?filters=1&market=resale")}>
              <IconFilter className="size-4" /> Фильтры
            </Chip>
          </div>
        </DragRow>
      </div>

      {feed.error ? (
        <ErrorState message="Не удалось загрузить вещи" onRetry={() => feed.mutate()} />
      ) : !feed.data ? (
        <div className="pt-2">
          <MasonrySkeleton />
        </div>
      ) : feed.items.length === 0 ? (
        <EmptyState title={chip === "new" ? "На вторичке пока пусто" : "Здесь пока ничего нет"} hint="Выставьте свою вещь — это займёт около минуты">
          <ButtonLink href="/sell" variant="shu">
            Продать вещь
          </ButtonLink>
        </EmptyState>
      ) : (
        <>
          <div className="pt-2">
            <Masonry items={first} variant="feed" source="feed" />
          </div>

          {sections && (
            <div className="flex flex-col gap-16 pt-12 md:gap-24 md:pt-16">
              {!!wardrobes.data?.items.length && (
                <section className="reveal">
                  <SectionHeader kanji="箪笥" title="Гардеробы" href="/wardrobes" />
                  <WardrobeCards wardrobes={wardrobes.data.items} onFollowChange={() => void wardrobes.mutate()} />
                </section>
              )}
              {/* «Продайте то, что не носите» belongs here, not among the brands on the home page. */}
              {!sessionLoading && !me?.isSeller && <SellBand />}
            </div>
          )}

          {rest.length > 0 && (
            <div className={sections ? "pt-16 md:pt-24" : "pt-4"}>
              {sections && <SectionHeader kanji="品々" title="Ещё вещи" />}
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

export default function ResalePage() {
  return (
    <Suspense>
      <ResaleFeed />
    </Suspense>
  );
}
