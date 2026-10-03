"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { CollectionTile, NewCollectionModal } from "@/components/collections";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { RequireAuth } from "@/components/require-auth";
import { WardrobeCards } from "@/components/sections";
import { ButtonLink, Chip, EmptyState, ErrorState, IconPlus, Skeleton } from "@/components/ui";
import type { Card, CollectionSummary, Cover, SellerSummary } from "@/lib/types";

const SORTS = [
  ["recent", "Недавно добавленные"],
  ["cheap", "Дешевле"],
  ["expensive", "Дороже"],
  ["available", "Сначала доступные"],
] as const;

type Tab = "items" | "collections" | "following";
const TABS: Array<[Tab, string]> = [
  ["items", "Все вещи"],
  ["collections", "Коллекции"],
  ["following", "Подписки"],
];

export default function FavoritesPage() {
  return (
    <RequireAuth reason="чтобы увидеть избранное">
      {() => (
        <Suspense>
          <Favorites />
        </Suspense>
      )}
    </RequireAuth>
  );
}

/** Favorites (frame 11): moodboard of saved items, private collections, and new items from wardrobes I follow. */
function Favorites() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "items") as Tab;
  const setTab = (t: Tab) => router.replace(t === "items" ? "?" : `?tab=${t}`, { scroll: false });
  const { data } = useSWR<{ total: number }>("/favorites?sort=recent");

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">
        Избранное{data && <span className="ml-2 text-xl font-normal text-muted">· {data.total}</span>}
      </h1>
      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto" role="tablist">
        {TABS.map(([key, label]) => (
          <Chip key={key} role="tab" aria-selected={tab === key} active={tab === key} onClick={() => setTab(key)}>
            {label}
          </Chip>
        ))}
      </div>
      <div className="mt-6">{tab === "items" ? <SavedItems /> : tab === "collections" ? <Collections /> : <FollowingFeed />}</div>
    </div>
  );
}

function SavedItems() {
  const [sort, setSort] = useState("recent");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const { data, error, mutate } = useSWR<{ items: Card[]; total: number; reserved: number; priceDropped: number }>(`/favorites?sort=${sort}${onlyAvailable ? "&available=1" : ""}`);
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Chip active={onlyAvailable} onClick={() => setOnlyAvailable((v) => !v)}>
          Только доступные
        </Chip>
        <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-full border border-line-strong bg-surface px-3 text-sm">
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {data && (data.reserved > 0 || data.priceDropped > 0) && (
        <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {[data.reserved && `${data.reserved} вещи из избранного зарезервированы`, data.priceDropped && `цена снижена на ${data.priceDropped}`].filter(Boolean).join(" · ")}
        </p>
      )}
      <div className="mt-6">
        {error ? (
          <ErrorState message="Не удалось загрузить избранное" onRetry={() => mutate()} />
        ) : !data ? (
          <MasonrySkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState title="Здесь появятся вещи, которые вы сохраните" hint="Нажмите ♡ или свайпните вправо — мы сообщим, если вещь подешевеет или её зарезервируют">
            <ButtonLink href="/">Смотреть вещи</ButtonLink>
            <ButtonLink href="/?mode=swipe" variant="secondary">
              Режим «Свайп»
            </ButtonLink>
          </EmptyState>
        ) : (
          <Masonry items={data.items} variant="grid" />
        )}
      </div>
    </>
  );
}

function Collections() {
  const { data, mutate } = useSWR<{ items: CollectionSummary[] }>("/collections");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <button onClick={() => setCreating(true)} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-ink-2 hover:border-ink hover:text-ink">
          <IconPlus className="size-6" />
          Новая коллекция
        </button>
        {!data ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-square rounded-2xl" />) : data.items.map((c) => <CollectionTile key={c.id} c={c} />)}
      </div>
      {data && data.items.length === 0 && <p className="mt-6 text-sm text-muted">Собирайте вещи из избранного в подборки: «Осень», «На работу», «Хочу».</p>}
      <NewCollectionModal open={creating} onClose={() => setCreating(false)} onCreated={() => mutate()} />
    </>
  );
}

function FollowingFeed() {
  const { data, error, mutate } = useSWR<{ items: Card[]; total: number; following: number }>("/following/feed?limit=48");
  const sellers = useSWR<{ items: Array<SellerSummary & { collage: (Cover | null)[] }> }>("/following");
  if (error) return <ErrorState message="Не удалось загрузить подписки" onRetry={() => mutate()} />;
  if (!data) return <MasonrySkeleton />;
  if (data.following === 0) {
    return (
      <EmptyState title="Вы пока ни на кого не подписаны" hint="Подпишитесь на гардероб — новые вещи продавца появятся здесь">
        <ButtonLink href="/">Смотреть гардеробы</ButtonLink>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      {sellers.data && sellers.data.items.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Гардеробы · {sellers.data.items.length}</h2>
          <WardrobeCards wardrobes={sellers.data.items} onFollowChange={() => (void sellers.mutate(), void mutate())} />
        </section>
      )}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Новое от подписок</h2>
        {data.items.length === 0 ? <p className="text-sm text-muted">Пока нет новых вещей.</p> : <Masonry items={data.items} variant="grid" />}
      </section>
    </div>
  );
}
