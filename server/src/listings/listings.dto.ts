import { z } from 'zod';
import { CATEGORY_SLUGS, CITIES, COLOR_VALUES } from '../catalog/catalog.js';

const aiField = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  accepted_by_user: z.boolean(),
  edited_by_user: z.boolean(),
});

const measurement = z.number().positive().max(300).nullish();

/** Draft payload: every field optional; completeness is checked on publish. */
/** The seals a brand can put on an item: 銘柄 бренд, 新作 новинка, 人気 хит, 正規 оригинал. */
export const LISTING_LABELS = ['brand', 'new', 'hit', 'original'] as const;

export const ListingInput = z.object({
  photos: z.array(z.object({ id: z.uuid(), isDefect: z.boolean().default(false) })).max(10).optional(),
  title: z.string().trim().max(80, 'До 80 символов').optional(),
  category: z.enum(CATEGORY_SLUGS as [string, ...string[]]).nullish(),
  subcategory: z.string().max(40).nullish(),
  sizeSystem: z.enum(['ALPHA', 'SHOE_EU', 'JEANS_W', 'OTHER']).nullish(),
  sizeValue: z.string().trim().max(20).nullish(),
  condition: z.enum(['NEW_WITH_TAGS', 'LIKE_NEW', 'GOOD', 'VISIBLE_WEAR']).nullish(),
  price: z.number().int('Целое число').min(1, 'Укажите цену').max(100_000).nullish(),
  defectsPresent: z.boolean().nullish(),
  defectsDescription: z.string().trim().max(1000).nullish(),
  brand: z.string().trim().max(60).nullish(),
  color: z.enum(COLOR_VALUES as [string, ...string[]]).nullish(),
  material: z.string().max(40).nullish(),
  measurements: z
    .object({ shoulders: measurement, chest: measurement, waist: measurement, hips: measurement, length: measurement, sleeve: measurement, inseam: measurement, foot_length: measurement })
    .nullish(),
  description: z.string().trim().max(2000, 'До 2000 символов').nullish(),
  city: z.enum(CITIES as [string, ...string[]]).nullish(),
  deliveryOptions: z.array(z.enum(['IN_PERSON', 'DELIVERY'])).optional(),
  acceptsOffers: z.boolean().optional(),
  /** «Цена договорная»: no price; the listing is bought through an offer or a chat. */
  priceNegotiable: z.boolean().optional(),
  saleType: z.enum(['FIXED', 'AUCTION']).optional(),
  auctionStep: z.number().int().min(1).max(10_000).nullish(),
  auctionReserve: z.number().int().min(1).max(100_000).nullish(),
  auctionHours: z.union([z.literal(24), z.literal(72), z.literal(168)]).nullish(),
  auctionBuyNow: z.number().int().min(2).max(100_000).nullish(),
  minOfferPrice: z.number().int().min(1).nullish(),
  autoAcceptPrice: z.number().int().min(1).max(100_000).nullish(),
  originalPrice: z.number().int().min(1).max(1_000_000).nullish(),
  /** The seal a brand chooses for the item (one at most, shown on its card); ignored for non-brands. */
  labels: z.array(z.enum(LISTING_LABELS)).max(1, 'Одна печать на вещь').optional(),
  gender: z.enum(['MALE', 'FEMALE', 'UNISEX']).nullish(),
  /** Other sizes of the same item, listed as separate copies on publish. */
  extraSizes: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
  /** «Несколько размеров»: every size in stock; the buyer picks one. */
  sizes: z.array(z.string().trim().min(1).max(20)).max(15).optional(),
  videoId: z.uuid().nullish(),
  styleTags: z.array(z.string().max(30)).max(3).optional(),
  aiAttributes: z.record(z.string(), aiField).nullish(),
  aiModelVersion: z.string().max(80).nullish(),
});
export type ListingInputT = z.infer<typeof ListingInput>;

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
  .optional();
const int = z.coerce.number().int().min(0).optional();

export const SearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: csv,
  subcategory: csv,
  style: csv,
  gender: csv,
  size: csv,
  condition: csv,
  color: csv,
  brand: csv,
  city: z.string().optional(),
  seller: z.string().optional(),
  price_min: int,
  price_max: int,
  available: z.enum(['0', '1']).default('1'),
  my_size: z.enum(['0', '1']).optional(),
  sort: z.enum(['new', 'cheap', 'expensive', 'popular', 'for_you']).default('new'),
  offset: int.default(0),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  /** brands = sellers with the brand status (the default), resale = everyone else («Вторичка»), all = both, on purpose. */
  market: z.enum(['brands', 'resale', 'all']).default('brands'),
});
export type SearchQueryT = z.infer<typeof SearchQuery>;

export const FeedQuery = z.object({
  chip: z.enum(['for_you', 'new', 'popular', 'auctions', 'clothing', 'shoes', 'accessories', 'bags', 'under_50']).default('new'),
  offset: int.default(0),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  /** all: only for the outfit picker, which builds a look from anything on the site. */
  market: z.enum(['brands', 'resale', 'all']).default('brands'),
});

export const WardrobeQuery = z.object({
  section: z.enum(['all', 'top', 'bottom', 'shoes', 'accessories', 'new', 'selling', 'sold']).default('all'),
  sort: z.enum(['new', 'old', 'cheap', 'expensive']).default('new'),
});
