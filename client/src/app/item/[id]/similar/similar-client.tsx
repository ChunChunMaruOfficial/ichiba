"use client";

import { TitleWithKanji } from "@/components/sections";
import { UmeBranch } from "@/components/shop/ume-branch";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { ButtonLink, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { useInfiniteCards, useSentinel } from "@/lib/hooks";
import type { Card } from "@/lib/types";

/** "Похожие" (as on Wildberries): items most like this one, best matches first. */
export default function SimilarPage() {
  const { id } = useParams<{ id: string }>();
  const list = useInfiniteCards<{ items: Card[]; total: number; source: { id: string; title: string } }>((offset) => `/listings/${encodeURIComponent(id)}/similar?offset=${offset}&limit=24`);
  const sentinel = useSentinel(list.loadMore, !list.done);
  const source = list.pages[0]?.source;

  if (list.error) return <ErrorState message="Не удалось подобрать похожие" onRetry={() => list.mutate()} />;
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <Link href={`/item/${id}`} className="text-sm text-ink-2 hover:text-ink">
        ← К вещи
      </Link>
      <TitleWithKanji kanji="類似" className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight">Похожие</h1>
      </TitleWithKanji>
      {source && <p className="mt-1 text-muted">на «{source.title}»</p>}
      <div className="mt-6">
        {!list.data ? (
          <MasonrySkeleton />
        ) : list.items.length === 0 ? (
          <EmptyState art={<UmeBranch className="mb-2 w-56" />} title="Похожих вещей пока нет" hint="Загляните позже — новые вещи появляются каждый день">
            <ButtonLink href="/">Смотреть новинки</ButtonLink>
          </EmptyState>
        ) : (
          <>
            <Masonry items={list.items} variant="grid" source="search" />
            <div ref={sentinel} className="flex justify-center py-8 text-muted">
              {list.loadingMore && <Spinner />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
