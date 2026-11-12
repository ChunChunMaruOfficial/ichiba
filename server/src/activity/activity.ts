import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ListingMarket } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The admin «Журнал»: what every seller does, brands and «Вторичка» alike. Rows are written where the action
 * happens (listings, deals, offers, auctions, profile, brand applications); the migration filled in the past from
 * what the database kept. Codes, not words: the admin page (client/src/app/admin/log) names them.
 */
export type SellerAction =
  | 'listing_created'
  | 'listing_edited'
  | 'price_changed'
  | 'listing_published'
  | 'listing_scheduled'
  | 'listing_hidden'
  | 'listing_bumped'
  | 'listing_sold'
  | 'listing_deleted'
  | `deal_${string}`
  | 'offer_countered'
  | 'offer_accepted'
  | 'offer_declined'
  | 'likers_offer'
  | 'auction_cancelled'
  | 'brand_applied'
  | 'profile_edited'
  | 'look_created';

const logger = new Logger('Activity');

/**
 * Who acts for the seller when it is not the seller's own click: the assistant chat runs its tools inside
 * `activitySource.run('помощник', …)`, and every row written there starts with that word, so the journal shows it.
 */
export const activitySource = new AsyncLocalStorage<string>();

/**
 * Records one seller action. Never fails or slows the action itself: the write runs on its own and a failure is
 * only logged. The item's section is looked up when not given.
 */
export function recordActivity(prisma: PrismaService, userId: string, action: SellerAction, opts: { listingId?: string | null; market?: ListingMarket | null; detail?: string | null } = {}) {
  const source = activitySource.getStore();
  const detail = source ? [source, opts.detail].filter(Boolean).join(': ') : opts.detail;
  void (async () => {
    let market = opts.market ?? null;
    if (!market && opts.listingId) market = (await prisma.listing.findUnique({ where: { id: opts.listingId }, select: { market: true } }))?.market ?? null;
    await prisma.sellerActivity.create({ data: { userId, action, listingId: opts.listingId ?? null, market, detail: detail?.slice(0, 300) ?? null } });
  })().catch((e: Error) => logger.warn(`${action} by ${userId} not recorded: ${e.message}`));
}
