"use client";

import { Omamori } from "@/components/shop/omamori";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { CollectionTile, NewCollectionModal } from "@/components/collections";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { RequireAuth } from "@/components/require-auth";
import { WardrobeCards, TitleWithKanji } from "@/components/sections";
import { ButtonLink, Chip, EmptyState, ErrorState, IconPlus, Skeleton } from "@/components/ui";
import { plural } from "@/lib/labels";
import type { Card, CollectionSummary, Cover, SellerSummary } from "@/lib/types";
import { Select } from "@/components/select";

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
    <RequireAuth reason="чтобы добавлять вещи в избранное">
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
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <TitleWithKanji kanji="好み">
        <h1 className="text-3xl font-semibold tracking-tight">
          Избранное{data && <span className="ml-2 text-xl font-normal text-muted">· {data.total}</span>}
        </h1>
      </TitleWithKanji>
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

/** Round seal with a brush label on top and the count in the middle, stamped slightly askew. */
function CountSeal({ kanji, n, ink }: { kanji: string; n: number; ink?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-[74px] shrink-0 -rotate-[8deg] place-items-center rounded-full border-[2.5px] ${ink ? "border-ink text-ink" : "border-shu text-shu"}`}
    >
      <span className={`grid size-[62px] place-content-center rounded-full border ${ink ? "border-ink/40" : "border-shu/40"} text-center`}>
        <span className="font-brush text-[13px] leading-none tracking-[0.1em]">{kanji}</span>
        <span className="tabular font-display text-[26px] font-extrabold leading-none">{n > 99 ? "99+" : n}</span>
      </span>
    </span>
  );
}

/**
 * News from the shop: what changed in favourites since the last visit, on a kraft slip with shippo circles and
 * seals — 値下 (price cut) in cinnabar, 予約 (reserved) in ink.
 */
function ShopNews({ priceDropped, reserved }: { priceDropped: number; reserved: number }) {
  return (
    <div className="pattern-shippo pattern-fade-r mt-5 flex flex-wrap items-center gap-x-10 gap-y-5 overflow-hidden rounded-[24px] bg-kraft/70 px-5 py-5 text-kraft-ink md:px-7">
      {priceDropped > 0 && (
        <div className="flex items-center gap-4">
          <CountSeal kanji="値下" n={priceDropped} />
          <div>
            <p className="font-display text-xl font-bold leading-tight">Цена снижена</p>
            <p className="text-[15px] opacity-80">
              у {priceDropped} {plural(priceDropped, "вещи", "вещей", "вещей")} из избранного
            </p>
          </div>
        </div>
      )}
      {reserved > 0 && (
        <div className="flex items-center gap-4">
          <CountSeal kanji="予約" n={reserved} ink />
          <div>
            <p className="font-display text-xl font-bold leading-tight">{plural(reserved, "Забронирована", "Забронированы", "Забронированы")}</p>
            <p className="text-[15px] opacity-80">
              {reserved} {plural(reserved, "вещь", "вещи", "вещей")} — если сделка сорвётся, мы напишем
            </p>
          </div>
        </div>
      )}
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
        <Select variant="pill" aria-label="Сортировка" value={sort} onChange={setSort} options={SORTS.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      {data && (data.reserved > 0 || data.priceDropped > 0) && <ShopNews priceDropped={data.priceDropped} reserved={data.reserved} />}
      <div className="mt-6">
        {error ? (
          <ErrorState message="Не удалось загрузить избранное" onRetry={() => mutate()} />
        ) : !data ? (
          <MasonrySkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState art={<Omamori className="mb-2 h-44" />} title="Здесь появятся вещи, которые вы сохраните" hint="Нажмите ♡ или свайпните вправо — мы сообщим, если вещь подешевеет или её зарезервируют">
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
