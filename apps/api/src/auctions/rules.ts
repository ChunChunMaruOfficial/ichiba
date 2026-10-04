import type { Auction, Bid, Prisma } from '../generated/prisma/client.js';

/** Auction rules (decision D16, frame 34). Pure helpers shared by listings and auctions. */
export const AUCTION_DURATIONS = [24, 72, 168];
export const EXTEND_WINDOW_MS = 5 * 60 * 1000;
export const WINNER_REPLY_MS = 48 * 3600 * 1000;

export const defaultStep = (start: number) => Math.max(1, Math.round(start * 0.05));
/** "Купить сейчас" stays available while the current bid is below this share of the buy-now price. */
export const BUY_NOW_THRESHOLD = 0.75;
export const buyNowAvailable = (a: { status: string; buyNowPrice: number | null; endsAt: Date }, current: number | null) =>
  a.status === 'ACTIVE' && a.buyNowPrice != null && a.endsAt > new Date() && (current == null || current < a.buyNowPrice * BUY_NOW_THRESHOLD);

/** Shows "a***x" instead of full nicknames in the public bid history. */
const mask = (username: string) => (username.length <= 2 ? `${username[0]}*` : `${username[0]}***${username.at(-1)}`);

export const auctionInclude = {
  bids: { orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }], include: { bidder: { select: { id: true, username: true } } } },
  request: { select: { id: true, buyerId: true, status: true } },
  // Used only to show the viewer their own auto-bid limit; other limits never leave the server.
  autoBids: { where: { active: true }, select: { bidderId: true, maxAmount: true } },
} satisfies Prisma.AuctionInclude;

type AuctionFull = Auction & {
  bids: Array<Bid & { bidder: { id: string; username: string } }>;
  request: { id: string; buyerId: string; status: string } | null;
  autoBids?: Array<{ bidderId: string; maxAmount: number }>;
};

/** Public auction state. Bidders are masked for others; the reserve value is shown only to the seller. */
export function serializeAuction(a: AuctionFull, viewerId: string | undefined, sellerId: string) {
  const top = a.bids[0];
  const current = top?.amount ?? null;
  const isSeller = viewerId === sellerId;
  const myBids = viewerId ? a.bids.filter((b) => b.bidderId === viewerId) : [];
  const winnerIsMe = a.status === 'SOLD' && !!viewerId && a.request?.buyerId === viewerId;
  return {
    id: a.id,
    status: a.status,
    startPrice: a.startPrice,
    step: a.step,
    currentBid: current,
    minBid: current == null ? a.startPrice : current + a.step,
    bidsCount: a.bids.length,
    bidders: new Set(a.bids.map((b) => b.bidderId)).size,
    endsAt: a.endsAt,
    extendedTimes: a.extendedTimes,
    reserveSet: a.reservePrice != null,
    reserveMet: a.reservePrice == null || (current != null && current >= a.reservePrice),
    reservePrice: isSeller ? a.reservePrice : null,
    leaderIsMe: !!top && top.bidderId === viewerId,
    myMaxBid: myBids[0]?.amount ?? null,
    myAutoMax: viewerId ? (a.autoBids?.find((b) => b.bidderId === viewerId)?.maxAmount ?? null) : null,
    buyNowPrice: a.buyNowPrice,
    buyNowAvailable: buyNowAvailable(a, current),
    boughtOut: a.bids.some((b) => b.isBuyNow),
    winnerIsMe,
    requestId: a.status === 'SOLD' && (isSeller || winnerIsMe) ? (a.request?.id ?? null) : null,
    bids: a.bids.slice(0, 20).map((b) => ({
      bidder: b.bidderId === viewerId ? 'вы' : isSeller ? b.bidder.username : mask(b.bidder.username),
      amount: b.amount,
      at: b.createdAt,
      mine: b.bidderId === viewerId,
      auto: b.auto,
      buyNow: b.isBuyNow,
    })),
  };
}

export type AuctionView = ReturnType<typeof serializeAuction>;
