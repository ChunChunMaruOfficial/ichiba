import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { jsonLd, serverFetch, SITE_URL, truncate } from "@/lib/server";
import type { WardrobeData as FullWardrobe } from "@/components/wardrobe-view";
import type { Card, SellerSummary } from "@/lib/types";
import { WardrobeClient } from "./wardrobe-client";

type Props = { params: Promise<{ username: string }> };
interface WardrobeData {
  seller: SellerSummary;
  counts: { all: number; selling: number; sold: number };
  groups: Array<{ items: Card[] }>;
}

const load = (username: string) => serverFetch<WardrobeData>(`/wardrobes/${encodeURIComponent(username)}`, 120);

function describe(w: WardrobeData) {
  const s = w.seller;
  const parts = [
    `${w.counts.selling} вещей в продаже`,
    s.rating ? `рейтинг ${s.rating.avg.toFixed(1)} по ${s.rating.count} отзывам` : null,
    s.city,
    s.bio,
  ].filter(Boolean);
  return truncate(`Гардероб @${s.username} на ichiba: ${parts.join(", ")}.`, 160);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const w = await load(decodeURIComponent(username));
  if (w === null) return { title: "Гардероб не найден", robots: { index: false } };
  if (!w) return {};
  const url = `${SITE_URL}/u/${w.seller.username}`;
  const cover = w.groups.flatMap((g) => g.items).find((i) => i.cover)?.cover;
  return {
    title: `Гардероб @${w.seller.username}`,
    description: describe(w),
    alternates: { canonical: url },
    robots: w.counts.all === 0 ? { index: false, follow: true } : undefined,
    openGraph: { type: "profile", url, title: `Гардероб @${w.seller.username}`, description: describe(w), images: cover ? [{ url: cover.urls.l }] : undefined },
  };
}

export default async function SellerWardrobePage({ params }: Props) {
  const { username: raw } = await params;
  const username = decodeURIComponent(raw);
  const w = await load(username);
  if (w === null) notFound();
  const ld = w && {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: `${SITE_URL}/u/${w.seller.username}`,
    mainEntity: {
      "@type": "Person",
      name: w.seller.username,
      description: w.seller.bio ?? undefined,
      homeLocation: w.seller.city ? { "@type": "Place", name: w.seller.city } : undefined,
      interactionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/FollowAction", userInteractionCount: w.seller.followers },
    },
  };
  return (
    <>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />}
      <WardrobeClient username={username} initial={w as unknown as FullWardrobe | undefined} />
    </>
  );
}
