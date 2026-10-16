import type { ListingMarket, Prisma } from '../generated/prisma/client.js';

/** `all` is only ever asked for on purpose («Искать и на вторичке» in the filters). */
export type Market = 'brands' | 'resale' | 'all';

/**
 * The main catalogue (brands) and the second-hand market are shown apart: brands don't want to stand next to
 * people's closets. Anything that lists items picks one, the catalogue when nothing is said. The section is the
 * listing's own `market` field (see `marketFor`), never guessed from its seller, price or text.
 */
export const marketWhere = (market: Market = 'brands'): Prisma.ListingWhereInput =>
  market === 'all' ? {} : { market: market === 'resale' ? 'RESALE' : 'CATALOG' };
/** The API's name for a listing's section. */
export const marketOf = (l: { market: ListingMarket }): Exclude<Market, 'all'> => (l.market === 'CATALOG' ? 'brands' : 'resale');
/** Section of a new listing: a confirmed brand sells in the catalogue, everyone else on «Вторичка» (an admin can move an item). */
export const marketFor = (seller: { brandVerifiedAt: Date | null } | null): ListingMarket => (seller?.brandVerifiedAt ? 'CATALOG' : 'RESALE');
