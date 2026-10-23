import { z } from 'zod';
import type { SizeSystem } from '../generated/prisma/client.js';
import { CATEGORIES, CATEGORY_SLUGS, categoryBySlug, CITIES, COLOR_VALUES, MATERIALS, SELLER_SIZE_SYSTEMS, SIZES, STYLE_TAGS } from '../catalog/catalog.js';

/**
 * What the AI suggested for a field: a short scalar (or a few tags), never an arbitrary blob stored on the listing.
 * Only the description draft is long (as long as the description itself).
 */
const aiValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.string().max(200)).max(10)]);
const aiField = z.object({
  value: aiValue,
  confidence: z.number().min(0).max(1),
  accepted_by_user: z.boolean(),
  edited_by_user: z.boolean(),
});

const measurement = z.number().positive().max(300).nullish();

/** Draft payload: every field optional; completeness is checked on publish. */
/** The seals a brand can put on an item: 銘柄 бренд, 新作 новинка, 人気 хит, 正規 оригинал. */
export const LISTING_LABELS = ['brand', 'new', 'hit', 'original'] as const;

const SUBCATEGORY_SLUGS = new Set(CATEGORIES.flatMap((c) => c.subcategories.map((x) => x.slug)));
const ALL_SIZES = new Set(Object.values(SIZES).flat());
const sizeError = 'Выберите размер из списка';

export const ListingInput = z
  .object({
  photos: z.array(z.object({ id: z.uuid(), isDefect: z.boolean().default(false) })).max(10).optional(),
  title: z.string().trim().max(80, 'До 80 символов').optional(),
  category: z.enum(CATEGORY_SLUGS as [string, ...string[]]).nullish(),
  subcategory: z.string().max(40).refine((v) => SUBCATEGORY_SLUGS.has(v), 'Выберите подкатегорию из списка').nullish(),
  // Sizes come only from the grids (SIZES): free text here once let anything through as a «size».
  sizeSystem: z.enum(SELLER_SIZE_SYSTEMS, { error: sizeError }).nullish(),
  sizeValue: z.string().trim().max(20).nullish(),
  condition: z.enum(['NEW_WITH_TAGS', 'LIKE_NEW', 'GOOD', 'VISIBLE_WEAR']).nullish(),
  /** «Новое»: the tags are still on (true) or not (false). Ignored for worn items. */
  hasTags: z.boolean().nullish(),
  price: z.number().int('Целое число').min(1, 'Укажите цену').max(100_000).nullish(),
  defectsPresent: z.boolean().nullish(),
  defectsDescription: z.string().trim().max(1000).nullish(),
  brand: z.string().trim().max(60).nullish(),
  color: z.enum(COLOR_VALUES as [string, ...string[]]).nullish(),
  material: z.enum(MATERIALS as [string, ...string[]], { error: 'Выберите материал из списка' }).nullish(),
  measurements: z
    .object({ shoulders: measurement, chest: measurement, waist: measurement, hips: measurement, length: measurement, sleeve: measurement, inseam: measurement, foot_length: measurement })
    .nullish(),
  description: z.string().trim().max(2000, 'До 2000 символов').nullish(),
  city: z.enum(CITIES as [string, ...string[]]).nullish(),
  deliveryOptions: z
    .array(z.enum(['IN_PERSON', 'DELIVERY']))
    .max(3)
    .transform((v) => [...new Set(v)])
    .optional(),
  acceptsOffers: z.boolean().optional(),
  /** «Цена договорная»: no price; the listing is bought through an offer or a chat. */
  priceNegotiable: z.boolean().optional(),
  saleType: z.enum(['FIXED', 'AUCTION']).optional(),
  auctionStep: z.number().int().min(1).max(10_000).nullish(),
  auctionReserve: z.number().int().min(1).max(100_000).nullish(),
  auctionHours: z.union([z.literal(24), z.literal(72), z.literal(168)]).nullish(),
  auctionBuyNow: z.number().int().min(2).max(100_000).nullish(),
  minOfferPrice: z.number().int().min(1).max(1_000_000).nullish(),
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
  styleTags: z.array(z.enum(STYLE_TAGS as [string, ...string[]])).max(3).optional(),
  aiAttributes: z
    .record(z.string().max(40), aiField)
    .refine((v) => Object.keys(v).length <= 30, 'Слишком много полей')
    .refine((v) => Object.entries(v).every(([k, f]) => k === 'description' || typeof f.value !== 'string' || f.value.length <= 200), 'Слишком длинное значение')
    .nullish(),
  aiModelVersion: z.string().max(80).nullish(),
  })
  .superRefine((v, ctx) => {
    // Offers below the floor are declined automatically: a floor at or above the price would decline everything.
    if (v.minOfferPrice != null && v.price != null && v.minOfferPrice >= v.price) {
      ctx.addIssue({ code: 'custom', path: ['minOfferPrice'], message: 'Порог автоотказа должен быть ниже цены' });
    }
    // A subcategory belongs to its category.
    const category = categoryBySlug(v.category);
    if (category && v.subcategory && !category.subcategories.some((x) => x.slug === v.subcategory)) {
      ctx.addIssue({ code: 'custom', path: ['subcategory'], message: 'Выберите подкатегорию из списка' });
    }
    // Every size is a value of its grid; without a grid given (a partial edit) it must be in one of them.
    const grid = v.sizeSystem ? new Set<string>(SIZES[v.sizeSystem]) : ALL_SIZES;
    const given = [v.sizeValue, ...(v.sizes ?? []), ...(v.extraSizes ?? [])].filter((x): x is string => !!x);
    if (given.some((x) => !grid.has(x))) ctx.addIssue({ code: 'custom', path: ['size'], message: sizeError });
    else if (v.sizeSystem && category && !category.sizeSystems.includes(v.sizeSystem)) {
      ctx.addIssue({ code: 'custom', path: ['size'], message: 'Эта размерная сетка не подходит к категории' });
    }
  });
/**
 * What the service accepts. Imports and seeds call it directly with values a seller can't send over HTTP:
 * the OTHER size grid («Уточняйте»), a shop's own material or style wording.
 */
export type ListingInputT = Omit<z.infer<typeof ListingInput>, 'sizeSystem' | 'material' | 'styleTags'> & {
  sizeSystem?: SizeSystem | null;
  material?: string | null;
  styleTags?: string[];
};

/** A list in the query string (`a,b` or repeated keys): at most 20 values of up to 60 characters. */
const csv = z
  .union([z.string().max(2000), z.array(z.string().max(200)).max(20)])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim().slice(0, 60)).filter(Boolean))
  .pipe(z.array(z.string()).max(20, 'Не больше 20 значений'))
  .optional();
const int = z.coerce.number().int().min(0).optional();
const money = z.coerce.number().int().min(0).max(1_000_000).optional();
/** `?q=a&q=b` arrives as an array: the first value counts. */
const firstOf = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export const SearchQuery = z.object({
  q: z.preprocess(firstOf, z.string().trim().max(100).optional()),
  category: csv,
  subcategory: csv,
  style: csv,
  gender: csv,
  size: csv,
  condition: csv,
  color: csv,
  brand: csv,
  city: z.preprocess(firstOf, z.string().max(64).optional()),
  seller: z.preprocess(firstOf, z.string().max(64).optional()),
  price_min: money,
  price_max: money,
  available: z.enum(['0', '1']).default('1'),
  my_size: z.enum(['0', '1']).optional(),
  /** similar: in the order of `ids` (a search by photo). */
  sort: z.enum(['new', 'cheap', 'expensive', 'popular', 'for_you', 'similar']).default('new'),
  /** Deep offsets are a full scan each; nobody pages 200 screens down. */
  offset: z.coerce.number().int().min(0).max(5000).default(0),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  /** Search within these items only: the ranked result of a search by photo, refined by words, filters and sorting. */
  ids: z
    .union([z.string().max(5000), z.array(z.string().max(40)).max(120)])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.uuid()).max(120))
    .optional(),
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
  /** Pages of 200 items within the section (see `hasMore` in the response). */
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
