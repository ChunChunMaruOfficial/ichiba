import type { Prisma } from '../generated/prisma/client.js';
import { photoUrls, type StoredPhoto } from '../media/media.service.js';

export const cardInclude = {
  photos: { orderBy: [{ isCover: 'desc' }, { order: 'asc' }], take: 1 },
  seller: { select: { id: true, username: true } },
  video: { select: { id: true } },
  auctions: {
    where: { status: 'ACTIVE' },
    take: 1,
    select: { endsAt: true, startPrice: true, _count: { select: { bids: true } }, bids: { orderBy: { amount: 'desc' }, take: 1, select: { amount: true } } },
  },
} satisfies Prisma.ListingInclude;

export type CardListing = Prisma.ListingGetPayload<{ include: typeof cardInclude }>;

/** «S · M · L» for a listing with several sizes in stock. */
const sizeLabel = (l: { sizeValue: string | null; sizes: string[] }) => (l.sizes.length > 1 ? l.sizes.join(' · ') : l.sizeValue);

export const serializePhoto = (p: StoredPhoto & { id: string; width: number; height: number; isCover: boolean; isDefect: boolean; order: number }) => ({
  id: p.id,
  width: p.width,
  height: p.height,
  isCover: p.isCover,
  isDefect: p.isDefect,
  order: p.order,
  urls: photoUrls(p),
});

/** Item card used by every list (frame 05: photo, price, size; title/condition on hover). */
export function serializeCard(l: CardListing, favoriteIds?: Set<string>) {
  const cover = l.photos[0];
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    priceNegotiable: l.priceNegotiable,
    previousPrice: l.previousPrice,
    originalPrice: l.originalPrice,
    hasVideo: !!l.video,
    /** Owner's drafts only: when a scheduled draft goes live. */
    scheduledAt: l.status === 'DRAFT' ? l.scheduledAt : null,
    size: sizeLabel(l),
    condition: l.condition,
    brand: l.brand,
    category: l.category,
    status: l.status,
    cover: cover ? { width: cover.width, height: cover.height, urls: photoUrls(cover) } : null,
    seller: { id: l.seller.id, username: l.seller.username },
    isFavorite: favoriteIds ? favoriteIds.has(l.id) : false,
    publishedAt: l.publishedAt,
    saleType: l.saleType,
    auction: l.auctions[0]
      ? { endsAt: l.auctions[0].endsAt, currentBid: l.auctions[0].bids[0]?.amount ?? null, startPrice: l.auctions[0].startPrice, bidsCount: l.auctions[0]._count.bids }
      : null,
  };
}

