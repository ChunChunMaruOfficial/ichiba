"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { SectionHeader, SellBand, TitleWithKanji, WardrobeCards } from "@/components/sections";
import { useSession } from "@/components/session";
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
 * The phone tab bar leads here instead of «Гардеробы»; the wardrobes row sits on top of the feed.
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

  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-6">
      <div className="pt-6 md:pt-10">
        <TitleWithKanji kanji="古着">
          <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Вторичка</h1>
        </TitleWithKanji>
        <p className="mt-1 text-ink-2">Вещи с историей из гардеробов покупателей</p>
      </div>

      {!!wardrobes.data?.items.length && (
        <section className="mt-8">
          <SectionHeader kanji="箪笥" title="Гардеробы" href="/wardrobes" />
          <WardrobeCards wardrobes={wardrobes.data.items} onFollowChange={() => void wardrobes.mutate()} />
        </section>
      )}

      {/* «Продайте то, что не носите» belongs here, not among the brands on the home page. */}
      {!sessionLoading && !me?.isSeller && (
        <div className="mt-12">
          <SellBand />
        </div>
      )}

      <div className="under-header z-30 -mx-4 mt-6 bg-washi px-4 pb-3 pt-4 md:-mx-6 md:px-6">
        <div className="no-scrollbar -mx-4 -my-2 flex items-center gap-2 overflow-x-auto px-4 py-2 md:-mx-6 md:px-6">
          {chips.map(([key, label]) => (
            <Chip key={key} active={chip === key} onClick={() => setChip(key)}>
              {label}
            </Chip>
          ))}
          <Chip onClick={() => router.push("/search?filters=1")}>
            <IconFilter className="size-4" /> Фильтры
          </Chip>
        </div>
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
            <Masonry items={feed.items} variant="feed" source="feed" />
          </div>
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
