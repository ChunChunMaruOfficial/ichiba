import type { Condition, ListingMarket, Prisma } from '../generated/prisma/client.js';

/** `all` is only ever asked for on purpose («Искать и на вторичке» in the filters). */
export type Market = 'brands' | 'resale' | 'all';

/**
 * The main catalogue (brands) and the second-hand market are shown apart: brands don't want to stand next to
 * people's closets. Anything that lists items picks one, the catalogue when nothing is said. The section is the
 * listing's own `market` field (see `marketFor`), never guessed from its seller's name, price or text.
 */
export const marketWhere = (market: Market = 'brands'): Prisma.ListingWhereInput =>
  market === 'all' ? {} : { market: market === 'resale' ? 'RESALE' : 'CATALOG' };
/** The API's name for a listing's section. */
export const marketOf = (l: { market: ListingMarket }): Exclude<Market, 'all'> => (l.market === 'CATALOG' ? 'brands' : 'resale');

/** Who may list in the catalogue: a confirmed brand, or a seller an admin admitted after reviewing them. */
export interface SellerStanding {
  brandVerifiedAt: Date | null;
  catalogApprovedAt?: Date | null;
}
export const catalogSeller = (s: SellerStanding | null) => !!(s?.brandVerifiedAt || s?.catalogApprovedAt);

/**
 * Conditions that count as new: «Новое» (stored as NEW_WITH_TAGS), with tags on or off (`hasTags`). «Как новое» was
 * worn 1–3 times, so it is used.
 */
const NEW_CONDITIONS: Condition[] = ['NEW_WITH_TAGS'];

/**
 * Automatic section of a listing:
 * - a brand's new items, with tags or without (its own goods), are in the catalogue;
 * - an admitted reseller's new items are there only with the tags on: without them the origin isn't evident, so they
 *   go to «Вторичка» unless an admin moves one in;
 * - worn items go to «Вторичка» whoever sells them; everyone else is on «Вторичка».
 * A draft with no condition (or tags) yet follows its seller and is classified again when it is published.
 */
export function marketFor(seller: SellerStanding | null, condition?: Condition | null, hasTags?: boolean | null): ListingMarket {
  if (!catalogSeller(seller)) return 'RESALE';
  if (condition != null && !NEW_CONDITIONS.includes(condition)) return 'RESALE';
  if (!seller?.brandVerifiedAt && hasTags === false) return 'RESALE';
  return 'CATALOG';
}

type ListingUpdater = { listing: { updateMany(args: Prisma.ListingUpdateManyArgs): Promise<{ count: number }> } };

/**
 * After a change of the seller's status: their items are classified again by the rules above, except the ones an
 * admin placed by hand. Deleted items keep the section they were last shown in.
 */
export async function reclassifySeller(db: ListingUpdater, sellerId: string, seller: SellerStanding) {
  const base = { sellerId, marketByAdmin: false, status: { not: 'DELETED' as const } };
  if (!catalogSeller(seller)) return db.listing.updateMany({ where: base, data: { market: 'RESALE' } });
  // A reseller's new item without tags stays on «Вторичка» (see marketFor); a brand's is in the catalogue.
  const untagged: Prisma.ListingWhereInput = seller.brandVerifiedAt ? { id: { in: [] } } : { condition: { in: NEW_CONDITIONS }, hasTags: false };
  // Spelled out rather than NOT(untagged): in SQL `NOT (hasTags = false)` is NULL for a NULL hasTags, so a new item
  // whose tags weren't stated would silently never move to the catalogue.
  const tagsOk: Prisma.ListingWhereInput = seller.brandVerifiedAt ? {} : { OR: [{ hasTags: true }, { hasTags: null }] };
  const [toCatalog, toResale] = await Promise.all([
    db.listing.updateMany({ where: { ...base, OR: [{ condition: null }, { AND: [{ condition: { in: NEW_CONDITIONS } }, tagsOk] }] }, data: { market: 'CATALOG' } }),
    db.listing.updateMany({ where: { ...base, OR: [{ condition: { notIn: NEW_CONDITIONS } }, untagged] }, data: { market: 'RESALE' } }),
  ]);
  return { count: toCatalog.count + toResale.count };
}
