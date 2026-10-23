"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { WardrobeCards, TitleWithKanji } from "@/components/sections";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, IconSearch, IconX, Skeleton, Spinner } from "@/components/ui";
import { qs } from "@/lib/api";
import { useInfiniteCards, useSentinel } from "@/lib/hooks";
import type { Cover, SellerSummary } from "@/lib/types";

type Wardrobe = SellerSummary & { collage: (Cover | null)[] };

/** Other people's wardrobes (the phone tab bar's «Гардеробы»): the most recently active first, search by nick. */
export default function WardrobesPage() {
  const { me } = useSession();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  // The API hands out 12 wardrobes per page (each one costs a collage and a summary).
  const list = useInfiniteCards((offset) => `/wardrobes${qs({ q: query, offset, limit: 12 })}`, 12);
  const sentinel = useSentinel(list.loadMore, !list.done);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <TitleWithKanji kanji="箪笥">
            <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Гардеробы</h1>
          </TitleWithKanji>
          <p className="mt-1 text-ink-2">Загляните к другим — у каждого свой стиль</p>
        </div>
        {me && (
          <Link href="/following" className="text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Мои подписки →
          </Link>
        )}
      </div>

      <label className="mt-5 flex h-11 max-w-md items-center gap-2 rounded-full border border-line-control bg-surface px-4 focus-within:border-indigo focus-within:ring-3 focus-within:ring-indigo/20">
        <IconSearch className="size-5 shrink-0 text-ink-2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по нику" aria-label="Найти гардероб по нику" className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" enterKeyHint="search" />
        {q && (
          <button type="button" aria-label="Очистить" onClick={() => setQ("")} className="text-muted hover:text-ink">
            <IconX className="size-4" />
          </button>
        )}
      </label>

      <div className="mt-6">
        {list.error ? (
          <ErrorState message="Не удалось загрузить гардеробы" onRetry={() => list.mutate()} />
        ) : !list.data ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-[22px]" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState title={query ? "Никого не нашли" : "Гардеробов пока нет"} hint={query ? "Проверьте ник" : "Загляните позже"} />
        ) : (
          <>
            <WardrobeCards grid wardrobes={list.items as unknown as Wardrobe[]} onFollowChange={() => void list.mutate()} />
            <div ref={sentinel} className="flex h-20 items-center justify-center text-muted">
              {list.loadingMore && <Spinner />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
