import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { items, plural } from "@/lib/labels";
import { og } from "@/lib/og";
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

/**
 * «Гардероб @nick на ichiba: 2 вещи в продаже, рейтинг 4,8 по 5 отзывам, Минск. <bio>». Counts agree with their
 * number («1 вещь», «2 вещи», «5 вещей»), the bio's own full stop isn't doubled, and a short one gets a line about
 * what the page offers, so no wardrobe is left with a 50-letter snippet.
 */
function describe(w: WardrobeData) {
  const s = w.seller;
  const bio = s.bio?.replace(/\s+/g, " ").trim().replace(/[.…!?\s]+$/, "");
  const parts = [
    `${items(w.counts.selling)} в продаже`,
    s.rating ? `рейтинг ${s.rating.avg.toFixed(1).replace(".", ",")} по ${s.rating.count} ${plural(s.rating.count, "отзыву", "отзывам", "отзывам")}` : null,
    s.city,
  ].filter(Boolean);
  let text = `Гардероб @${s.username} на ichiba: ${parts.join(", ")}.`;
  if (bio) text += ` ${bio}.`;
  // The longest line about the page that still fits whole: a snippet never ends on «…» because of it.
  const tail = [" Цены, фото и замеры вещей, отзывы о продавце, доставка по Беларуси.", " Цены, фото и замеры, доставка по Беларуси.", " Доставка по Беларуси."].find((t) => text.length + t.length <= 160);
  if (tail) text += tail;
  return truncate(text, 160);
}

/** The username from the address; a malformed %-escape ("/u/%E0") is no such wardrobe rather than a crash (500). */
function decodeUsername(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const w = await load(decodeUsername(username));
  if (w === null) return { title: "Гардероб не найден", robots: { index: false } };
  if (!w) return {};
  const path = `/u/${encodeURIComponent(w.seller.username)}`;
  const cover = w.groups.flatMap((g) => g.items).find((i) => i.cover)?.cover;
  return {
    title: `Гардероб @${w.seller.username}`,
    description: describe(w),
    alternates: { canonical: `${SITE_URL}${path}` },
    robots: w.counts.all === 0 ? { index: false, follow: true } : undefined,
    openGraph: og(path, { type: "profile", title: `Гардероб @${w.seller.username}`, description: describe(w), images: cover ? [{ url: cover.urls.l, width: cover.width, height: cover.height }] : undefined }),
  };
}

export default async function SellerWardrobePage({ params }: Props) {
  const { username: raw } = await params;
  const username = decodeUsername(raw);
  const w = await load(username);
  if (w === null) notFound();
  const ld = w && {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: `${SITE_URL}/u/${encodeURIComponent(w.seller.username)}`,
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
