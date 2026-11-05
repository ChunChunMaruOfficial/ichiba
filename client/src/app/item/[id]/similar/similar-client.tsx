"use client";

import { Breadcrumbs, itemCrumbs } from "@/components/breadcrumbs";
import { TitleWithKanji } from "@/components/sections";
import { UmeBranch } from "@/components/shop/ume-branch";
import { useParams } from "next/navigation";
import { itemIdFrom } from "@/lib/item-path";
import type { ItemLandings } from "@/lib/landing";
import type { Zone } from "@/lib/market";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { ButtonLink, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { useInfiniteCards, useSentinel } from "@/lib/hooks";
import type { Card } from "@/lib/types";

/** What the server page read about the item, for the crumbs (the list itself is fetched here). */
export interface SimilarSource {
  item: { id: string; slug: string | null; title: string; category: string | null; categoryLabel: string | null; subcategoryLabel: string | null };
  landings: ItemLandings;
  zone: Zone;
}

/** "Похожие" (as on Wildberries): items most like this one, best matches first. */
export default function SimilarPage({ source: src }: { source: SimilarSource | null }) {
  const param = useParams<{ id: string }>().id;
  const id = itemIdFrom(param) ?? param;
  const list = useInfiniteCards<{ items: Card[]; total: number; source: { id: string; title: string } }>((offset) => `/listings/${encodeURIComponent(id)}/similar?offset=${offset}&limit=24`);
  const sentinel = useSentinel(list.loadMore, !list.done);
  const source = list.pages[0]?.source;

  if (list.error) return <ErrorState message="Не удалось подобрать похожие" onRetry={() => list.mutate()} />;
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <Breadcrumbs items={[...(src ? itemCrumbs(src.item, src.landings, src.zone) : [{ label: "Главная", href: "/" }, { label: "Вещь", href: `/item/${id}` }]), { label: "Похожее" }]} />
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
            <Masonry items={list.items} source="search" />
            <div ref={sentinel} className="flex justify-center py-8 text-muted">
              {list.loadingMore && <Spinner />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
