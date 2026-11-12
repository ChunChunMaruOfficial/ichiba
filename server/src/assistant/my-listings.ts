import { z } from 'zod';
import { CATEGORIES, CATEGORY_SLUGS } from '../catalog/catalog.js';
import type { ListingStatus, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * «Which of my items»: the one way every tool picks listings. The model fills the filter from the person's words
 * («куртки дороже 100», «пару самых старых»); the query always carries sellerId from the session, so no filter can
 * reach somebody else's item.
 */
export const MAX_ITEMS = 200;

const STATUS: Record<string, ListingStatus[]> = {
  on_sale: ['PUBLISHED'],
  hidden: ['HIDDEN'],
  draft: ['DRAFT'],
  reserved: ['RESERVED'],
  sold: ['SOLD'],
  any: ['PUBLISHED', 'HIDDEN', 'DRAFT', 'RESERVED', 'SOLD'],
};

export const ListingFilter = z
  .object({
    ids: z.array(z.uuid()).max(MAX_ITEMS).optional().describe('конкретные вещи по id (из my_listings)'),
    status: z.enum(['on_sale', 'hidden', 'draft', 'reserved', 'sold', 'any']).optional().describe('по умолчанию on_sale'),
    category: z.enum(CATEGORY_SLUGS as [string, ...string[]]).optional(),
    subcategory: z.string().max(40).optional(),
    words: z.array(z.string().min(2).max(30)).max(8).optional().describe('слова из названия, бренда или описания, в любой форме: вещь подходит, если есть хотя бы одно'),
    priceMin: z.number().int().min(0).optional(),
    priceMax: z.number().int().min(0).optional(),
    olderThanDays: z.number().int().min(1).max(3650).optional().describe('в продаже дольше стольких дней'),
    order: z.enum(['newest', 'oldest', 'cheapest', 'priciest', 'least_viewed', 'most_viewed']).optional(),
    limit: z.number().int().min(1).max(MAX_ITEMS).optional().describe('сколько вещей взять; «пару» = 2, «несколько» = 3'),
  })
  .strict();
export type ListingFilterT = z.infer<typeof ListingFilter>;

const ORDER: Record<NonNullable<ListingFilterT['order']>, Prisma.ListingOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  oldest: [{ publishedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  cheapest: [{ price: { sort: 'asc', nulls: 'last' } }],
  priciest: [{ price: { sort: 'desc', nulls: 'last' } }],
  least_viewed: [{ viewsCount: 'asc' }, { publishedAt: 'asc' }],
  most_viewed: [{ viewsCount: 'desc' }],
};

/**
 * The start of a word that its other forms share: «футболку» has to find «Футболка», «джинсов» — «Джинсы». Not a
 * real stemmer, only the ending cut off; the match is «contains», so a shorter start finds more, never less.
 */
export const stem = (word: string) => {
  const w = word.trim().toLowerCase();
  return w.length > 5 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w;
};

export function listingWhere(userId: string, f: ListingFilterT, now = Date.now()): Prisma.ListingWhereInput {
  const words = [...new Set((f.words ?? []).map(stem).filter((w) => w.length >= 2))];
  return {
    sellerId: userId,
    status: { in: STATUS[f.status ?? 'on_sale'] },
    ...(f.ids?.length ? { id: { in: f.ids } } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.subcategory ? { subcategory: f.subcategory } : {}),
    ...(f.priceMin != null || f.priceMax != null ? { price: { ...(f.priceMin != null ? { gte: f.priceMin } : {}), ...(f.priceMax != null ? { lte: f.priceMax } : {}) } } : {}),
    ...(f.olderThanDays ? { publishedAt: { lte: new Date(now - f.olderThanDays * 24 * 3600_000) } } : {}),
    ...(words.length
      ? { OR: words.flatMap((w) => [{ title: { contains: w, mode: 'insensitive' as const } }, { brand: { contains: w, mode: 'insensitive' as const } }, { description: { contains: w, mode: 'insensitive' as const } }]) }
      : {}),
  };
}

const PICK = {
  id: true,
  title: true,
  price: true,
  previousPrice: true,
  status: true,
  category: true,
  subcategory: true,
  viewsCount: true,
  favoritesCount: true,
  publishedAt: true,
  liftedAt: true,
  lastBumpAt: true,
  bumpsCount: true,
  hiddenAt: true,
  acceptsOffers: true,
  minOfferPrice: true,
  autoAcceptPrice: true,
  saleType: true,
} satisfies Prisma.ListingSelect;
export type MyListing = Prisma.ListingGetPayload<{ select: typeof PICK }>;

/** The seller's own items that fit the filter, and how many fit in all (the limit may cut the list). */
export async function findMyListings(prisma: PrismaService, userId: string, f: ListingFilterT, extra: Prisma.ListingWhereInput = {}): Promise<{ items: MyListing[]; total: number }> {
  const where = { AND: [listingWhere(userId, f), extra] };
  const [items, total] = await Promise.all([
    prisma.listing.findMany({ where, orderBy: ORDER[f.order ?? 'newest'], take: Math.min(f.limit ?? MAX_ITEMS, MAX_ITEMS), select: PICK }),
    prisma.listing.count({ where }),
  ]);
  return { items, total };
}

/** The category list for the model's prompt: «outerwear Верхняя одежда (jacket Куртка, …)». */
export const categoryGuide = () => CATEGORIES.map((c) => `${c.slug} ${c.label} (${c.subcategories.map((s) => `${s.slug} ${s.label}`).join(', ')})`).join('\n');

export const byn = (n: number | null | undefined) => (n == null ? '—' : `${n} BYN`);
export const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s) || 'Без названия';

/** «5 вещей», «2 вещи», «1 вещь». */
export function things(n: number) {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? 'вещь' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'вещи' : 'вещей'}`;
}

/** A list of lines for a report, cut with «и ещё N» so a bulk action stays readable. */
export function lines(rows: string[], max = 12) {
  return rows.length <= max ? rows.join('\n') : `${rows.slice(0, max).join('\n')}\n…и ещё ${rows.length - max}`;
}
