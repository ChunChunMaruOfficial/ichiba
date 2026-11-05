import type { Metadata } from "next";
import { Suspense } from "react";
import { itemIdFrom } from "@/lib/item-path";
import { itemLandings, type LandingEntry } from "@/lib/landing";
import { serverFetch } from "@/lib/server";
import type { ListingResponse } from "@/lib/types";
import SimilarClient, { type SimilarSource } from "./similar-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const param = (await params).id;
  const id = itemIdFrom(param) ?? param;
  return {
    title: "Похожие вещи",
    description: "Вещи, похожие на выбранную: тот же фасон, цвет и стиль от других продавцов ichiba.",
    alternates: { canonical: `/item/${encodeURIComponent(id)}/similar` },
    // Every card links here, and every such page has the same title and a list drawn in the browser: hundreds of
    // near-copies for a search engine. Kept out of the index; the items it links to are still followed.
    robots: { index: false, follow: true },
  };
}

/** The item itself, for the way to this page («Главная / Обувь / Ботинки / … / Похожее»); null when it can't be read. */
async function source(param: string): Promise<SimilarSource | null> {
  const id = itemIdFrom(param);
  if (!id) return null;
  const [l, landings] = await Promise.all([serverFetch<ListingResponse>(`/listings/${encodeURIComponent(id)}`), serverFetch<LandingEntry[]>("/seo/landings", 900)]);
  if (!l || "unavailable" in l) return null;
  return {
    item: { id: l.id, slug: l.slug ?? null, title: l.title, category: l.category, categoryLabel: l.categoryLabel, subcategoryLabel: l.subcategoryLabel },
    landings: itemLandings(landings, l),
    zone: l.market === "resale" ? "resale" : "brands",
  };
}

export default async function SimilarPage({ params }: Props) {
  const param = (await params).id;
  return (
    <Suspense>
      <SimilarClient source={await source(param)} />
    </Suspense>
  );
}
