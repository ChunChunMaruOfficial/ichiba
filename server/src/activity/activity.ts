import { Logger } from '@nestjs/common';
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
 * Records one seller action. Never fails or slows the action itself: the write runs on its own and a failure is
 * only logged. The item's section is looked up when not given.
 */
export function recordActivity(prisma: PrismaService, userId: string, action: SellerAction, opts: { listingId?: string | null; market?: ListingMarket | null; detail?: string | null } = {}) {
  void (async () => {
    let market = opts.market ?? null;
    if (!market && opts.listingId) market = (await prisma.listing.findUnique({ where: { id: opts.listingId }, select: { market: true } }))?.market ?? null;
    await prisma.sellerActivity.create({ data: { userId, action, listingId: opts.listingId ?? null, market, detail: opts.detail?.slice(0, 300) ?? null } });
  })().catch((e: Error) => logger.warn(`${action} by ${userId} not recorded: ${e.message}`));
}
