import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CATEGORIES,
  categoriesInGroup,
  categoriesInSection,
  categoryBySlug,
  sizeRequired,
  WardrobeSection,
} from '../catalog/catalog.js';
import type { Listing, ListingStatus, Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { kindOf, RANK_SELECT, RecommendationsService, spread } from '../recommendations/recommendations.service.js';
import { AUCTION_DURATIONS, auctionInclude, defaultStep, serializeAuction } from '../auctions/rules.js';
import { ListingModerator, ModerationVerdict } from '../ai/moderation.js';
import { nextBumpAt, StatsService } from '../stats/stats.js';
import { canonicalBrand } from '../catalog/brands.js';
import { withJobLock } from '../common/job-lock.js';
import { RedisService } from '../redis/redis.js';
import { tiersOf } from './bundle.js';
import { BodyMeasurements, fitHint, PreferredSizes } from './fit.js';
import { hashDistance, LISTING_MIN_SIDE, MediaService, photoUrls, serializeVideo, usableHash, videoFrameKeys } from '../media/media.service.js';
import { MAX_VIDEO_MS } from '../media/video.js';
import { cardInclude, CardListing, serializeCard, serializePhoto } from './listing.serializer.js';
import { LISTING_LABELS, type ListingInputT, type SearchQueryT } from './listings.dto.js';
import { type Market, marketFor, marketOf, marketWhere } from './market.js';

export { type Market, marketOf, marketWhere };

const VISIBLE_IN_FEED: ListingStatus[] = ['PUBLISHED', 'RESERVED'];
const ACTIVE_REQUEST_STATUSES = ['PENDING_SELLER', 'ACCEPTED', 'WAITING_PAYMENT', 'WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED'] as const;
/** Fields frozen while a deal is in progress (frame 10 EDIT ITEM). */
const LOCKED_WHEN_RESERVED = ['price', 'priceNegotiable', 'sizeValue', 'sizeSystem', 'condition', 'hasTags', 'defectsPresent', 'defectsDescription'] as const;
const CANDIDATE_POOL = 1000;
/** Width to height of a category tile on the home page. */
const TILE_RATIO = 4 / 5;
/** Edits of these on a live listing are moderated again. */
const MODERATED_FIELDS = ['title', 'description', 'brand', 'defectsDescription', 'category', 'subcategory'] as const;
/** What a sold item can no longer change: its page stays up as the record of the sale and nothing moderates it again. */
const FROZEN_WHEN_SOLD = [...MODERATED_FIELDS, 'price', 'labels'] as const;
/** Statuses whose content the public sees (HIDDEN comes back as it is), so edits to them are moderated. */
const SHOWN_STATUSES: ListingStatus[] = ['PUBLISHED', 'RESERVED', 'HIDDEN'];
/** Statuses anyone may see the page (and the «Похожие» built from it) of; the rest only their owner. */
const PUBLIC_STATUSES: ListingStatus[] = ['PUBLISHED', 'RESERVED', 'SOLD'];
const DAY_MS = 24 * 3600_000;
/** A price counts as the «was» price of a discount only after it was asked this long (no fake «−50 %» overnight). */
const DISCOUNT_AFTER_MS = 7 * DAY_MS;
/** Wardrobe page size (per section). */
const WARDROBE_PAGE = 200;
/** «Гардеробы» page cap: every wardrobe is a collage and a summary. */
const WARDROBES_MAX = 12;
/** Views of one item by one person (or IP) are counted once a day; the dedupe map holds at most this many keys. */
const VIEW_KEYS_MAX = 50_000;

/** A tiny in-process cache for public pages everyone shares; the promise is stored, so concurrent misses load once. */
class MemoCache {
  private readonly map = new Map<string, { exp: number; v: Promise<unknown> }>();

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    if (hit && hit.exp > Date.now()) return hit.v as Promise<T>;
    if (this.map.size >= 200) this.map.clear();
    const v = load();
    this.map.set(key, { exp: Date.now() + ttlMs, v });
    v.catch(() => this.map.delete(key));
    return v;
  }
}

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly notifications: NotificationsService,
    private readonly moderator: ListingModerator,
    private readonly stats: StatsService,
    private readonly media: MediaService,
    private readonly redis: RedisService,
  ) {}

  private readonly cache = new MemoCache();
  /** listingId:viewer → day number of the last counted view. */
  private readonly views = new Map<string, number>();
  private viewsSweptAt = Date.now();
  /** Scheduled drafts that failed only because no model answered: not retried for 5 minutes. */
  private readonly retriedAt = new Map<string, number>();
  /** Per-listing marks the schema has no column for (last price change, last price-drop mailing): this process's copy. */
  private readonly marks = new Map<string, number>();

  /** When a mark was set (Redis when there is one, so instances agree; else this process), or null. */
  private async markAt(key: string): Promise<number | null> {
    // `redis` is absent only where a test builds the service by hand.
    const client = this.redis?.client;
    const shared = client ? await client.get(`ichiba:mark:${key}`).catch(() => null) : null;
    return shared ? Number(shared) : (this.marks.get(key) ?? null);
  }

  private async setMark(key: string, ttlMs: number) {
    const now = Date.now();
    if (this.marks.size >= 10_000) {
      for (const [k, at] of this.marks) if (now - at > 30 * DAY_MS) this.marks.delete(k);
      if (this.marks.size >= 10_000) this.marks.clear();
    }
    this.marks.set(key, now);
    await this.redis?.client?.set(`ichiba:mark:${key}`, String(now), 'PX', ttlMs).catch(() => undefined);
  }

  // ---------- helpers ----------

  async favoriteIds(userId: string | undefined, listingIds: string[]) {
    if (!userId || !listingIds.length) return new Set<string>();
    const favs = await this.prisma.favorite.findMany({ where: { userId, listingId: { in: listingIds } }, select: { listingId: true } });
    return new Set(favs.map((f) => f.listingId));
  }

  async cards(listings: CardListing[], viewerId?: string) {
    const favs = await this.favoriteIds(viewerId, listings.map((l) => l.id));
    return listings.map((l) => serializeCard(l, favs));
  }

  /** Loads listings by id and returns cards in the same order. */
  private async cardsByIds(ids: string[], viewerId?: string) {
    const rows = await this.prisma.listing.findMany({ where: { id: { in: ids } }, include: cardInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.cards(ids.map((id) => byId.get(id)).filter((r): r is CardListing => !!r), viewerId);
  }

  private async ownListing(userId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listing.sellerId !== userId) throw new ForbiddenException({ message: 'Нет доступа' });
    return listing;
  }

  // ---------- create / edit ----------

  async create(userId: string, input: ListingInputT) {
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { city: true, brandVerifiedAt: true, catalogApprovedAt: true } });
    const data = this.toData(input);
    if (!me?.brandVerifiedAt) delete data.labels;
    await this.assertListingMedia(userId, null, input.photos, input.videoId);
    const listing = await this.prisma.listing.create({
      data: { sellerId: userId, city: me?.city ?? null, deliveryOptions: ['IN_PERSON'], ...data, market: marketFor(me, data.condition, data.hasTags) },
    });
    if (input.photos) await this.attachPhotos(userId, listing.id, input.photos);
    if (input.videoId !== undefined) await this.attachVideo(userId, listing.id, input.videoId);
    return this.getForOwner(userId, listing.id);
  }

  async update(userId: string, id: string, input: ListingInputT) {
    const listing = await this.ownListing(userId, id);
    if (listing.status === 'BLOCKED') throw new ForbiddenException({ message: 'Вещь заблокирована модератором' });
    const data = this.toData(input);
    // Seals are a brand's tool; anyone else's choice is ignored.
    if (data.labels !== undefined && !(await this.prisma.user.findUnique({ where: { id: userId }, select: { brandVerifiedAt: true } }))?.brandVerifiedAt) delete data.labels;

    // Arrays (labels) compare by value: a resent unchanged list isn't a change.
    const changes = (f: keyof typeof data & keyof Listing) => f in data && data[f] !== undefined && JSON.stringify(data[f]) !== JSON.stringify(listing[f]);
    if (listing.status === 'SOLD' && (FROZEN_WHEN_SOLD.some(changes) || input.photos || input.videoId !== undefined)) {
      throw new ConflictException({ message: 'Проданную вещь нельзя менять' });
    }
    const live = listing.status === 'PUBLISHED' || listing.status === 'RESERVED';
    if (live && changes('saleType')) throw new ConflictException({ message: 'Способ продажи нельзя менять у вещи в продаже — снимите её и выставьте заново' });

    const runningAuction = await this.prisma.auction.findFirst({ where: { listingId: id, status: 'ACTIVE' } });
    if (runningAuction) {
      const frozen = (['price', 'saleType', 'auctionStep', 'auctionReserve', 'auctionHours', 'auctionBuyNow'] as const).filter((f) => f in data && data[f] !== listing[f]);
      if (frozen.length) throw new ConflictException({ message: 'Идёт аукцион — цену и условия торгов менять нельзя' });
    }
    if (listing.status === 'RESERVED') {
      const changed = LOCKED_WHEN_RESERVED.filter((f) => f in data && data[f] !== listing[f]);
      if (changed.length) throw new ConflictException({ message: 'Идёт сделка — цену, размер, состояние и дефекты менять нельзя' });
    }

    await this.assertListingMedia(userId, id, input.photos, input.videoId);
    const prospective = { ...listing, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) } as typeof listing;
    // A live listing stays publishable: no edit may take away its price, photos or a way to hand it over. Only problems
    // the edit introduces count, so an older listing that predates a rule can still be edited in other fields.
    if (live) {
      const photoCount = await this.prisma.photo.count({ where: { listingId: id } });
      const newCount = input.photos ? (await this.photoKeys(userId, id, input.photos)).length : photoCount;
      const before = this.publishErrors(listing, photoCount);
      const fields = Object.fromEntries(Object.entries(this.publishErrors(prospective, newCount)).filter(([k, v]) => before[k] !== v));
      if (Object.keys(fields).length) throw new BadRequestException({ message: 'Заполните обязательные поля', fields });
    }

    const priceChanged = data.price !== undefined && data.price !== listing.price;
    const priceDropped = listing.status === 'PUBLISHED' && data.price != null && listing.price != null && data.price < listing.price;
    if (priceChanged) {
      // The crossed-out price is the one asked for at least a week (since publication or the last change this server
      // saw: there is no priceChangedAt column), so a raise-then-drop can't fake a discount. A later raise to or above
      // the crossed-out price ends the discount.
      const changedAt = await this.markAt(`price:${id}`);
      const heldSince = Math.max(listing.publishedAt?.getTime() ?? Date.now(), changedAt ?? 0);
      if (priceDropped && Date.now() - heldSince >= DISCOUNT_AFTER_MS) data.previousPrice = listing.price;
      else if (listing.previousPrice != null && (data.price == null || data.price >= listing.previousPrice)) data.previousPrice = null;
    }

    // Content the public sees (or will see again: a hidden item comes back as it is) is moderated again when its
    // text, category or photos change; a rejected edit isn't saved.
    let verdict: ModerationVerdict | null = null;
    if (SHOWN_STATUSES.includes(listing.status) && (MODERATED_FIELDS.some((f) => f in data && data[f] !== listing[f]) || input.photos || input.videoId)) {
      verdict = await this.moderator.check(prospective, await this.moderationKeys(userId, id, input.photos, input.videoId));
      if (verdict.decision === 'reject') throw new BadRequestException({ message: 'Изменения не прошли проверку', code: 'MODERATION', fields: verdict.fields, retry: !!verdict.retry });
    }

    // A new condition or tags can change the section (a worn item leaves the catalogue), unless an admin placed the item.
    const condition = data.condition !== undefined ? data.condition : listing.condition;
    const hasTags = data.hasTags !== undefined ? data.hasTags : condition === 'NEW_WITH_TAGS' ? listing.hasTags : null;
    const changed = condition !== listing.condition || hasTags !== listing.hasTags;
    const market = changed && !listing.marketByAdmin ? await this.autoMarket(userId, condition, hasTags) : undefined;
    await this.prisma.listing.update({ where: { id }, data: { ...data, ...(market ? { market } : {}) } });
    if (input.photos) await this.attachPhotos(userId, id, input.photos);
    if (input.videoId !== undefined) await this.attachVideo(userId, id, input.videoId);
    if (verdict) await this.moderator.record(prospective, verdict);
    if (priceChanged) await this.setMark(`price:${id}`, 30 * DAY_MS);

    // At most one price-drop notice per item a day: lowering the price by 1 BYN at a time isn't a mailing list.
    const notifiedAt = priceDropped ? await this.markAt(`price_drop:${id}`) : null;
    if (priceDropped && (notifiedAt == null || Date.now() - notifiedAt >= DAY_MS)) {
      await this.setMark(`price_drop:${id}`, DAY_MS);
      // ♡ = save + watch: everyone who saved the item hears about the price drop (D3).
      const favs = await this.prisma.favorite.findMany({ where: { listingId: id }, select: { userId: true } });
      await this.notifications.notifyMany(
        favs.map((f) => f.userId),
        'price_drop',
        { listingId: id, title: listing.title, oldPrice: listing.price, newPrice: data.price },
      );
    }
    return this.getForOwner(userId, id);
  }

  /** The automatic section of an item of this seller in this condition (see market.ts). */
  private async autoMarket(sellerId: string, condition: ListingInputT['condition'], hasTags: boolean | null | undefined) {
    const seller = await this.prisma.user.findUnique({ where: { id: sellerId }, select: { brandVerifiedAt: true, catalogApprovedAt: true } });
    return marketFor(seller, condition, hasTags);
  }

  /** Plain column values (no Prisma update operators), so they work for create, update and comparisons. */
  private toData(input: ListingInputT) {
    const { photos: _photos, videoId: _videoId, measurements, aiAttributes, ...rest } = input;
    const data: Omit<ListingInputT, 'photos' | 'videoId' | 'measurements' | 'aiAttributes'> & {
      measurements?: Prisma.InputJsonValue;
      aiAttributes?: Prisma.InputJsonValue;
      previousPrice?: number | null;
    } = { ...rest };
    if (measurements !== undefined) data.measurements = (measurements ?? undefined) as Prisma.InputJsonValue | undefined;
    if (aiAttributes !== undefined) data.aiAttributes = (aiAttributes ?? undefined) as Prisma.InputJsonValue | undefined;
    if (input.defectsPresent === false) data.defectsDescription = null;
    // Tags only mean something on a new item.
    if (input.condition !== undefined && input.condition !== 'NEW_WITH_TAGS') data.hasTags = null;
    if (input.brand !== undefined) data.brand = canonicalBrand(input.brand);
    // «Несколько размеров»: one listing holds every size; the first is its sizeValue. Older clients still send
    // extraSizes (they used to become copies) — those are folded in the same way.
    const sizes = input.sizes ?? (input.extraSizes?.length && input.sizeValue ? [input.sizeValue, ...input.extraSizes] : undefined);
    if (sizes !== undefined) {
      const list = [...new Set(sizes.map((x) => x.trim()).filter(Boolean))].slice(0, 15);
      data.sizes = list.length > 1 ? list : [];
      if (list.length) data.sizeValue = list[0];
    }
    if (input.extraSizes !== undefined) data.extraSizes = [];
    // Seals keep one order on every card, whatever order they were ticked in.
    if (input.labels) data.labels = LISTING_LABELS.filter((l) => input.labels!.includes(l));
    // A negotiable price has no number, and nothing that compares against one.
    if (input.priceNegotiable) Object.assign(data, { price: null, autoAcceptPrice: null, minOfferPrice: null, saleType: 'FIXED' });
    return data;
  }

  /** Storage keys of the photos the listing will have: the submitted list, or the current one. */
  private async photoKeys(userId: string, listingId: string, photos?: { id: string }[]) {
    if (!photos) {
      const rows = await this.prisma.photo.findMany({ where: { listingId }, orderBy: { order: 'asc' }, select: { key: true } });
      return rows.map((r) => r.key);
    }
    const rows = await this.prisma.photo.findMany({ where: { id: { in: photos.map((p) => p.id) }, ownerId: userId }, select: { id: true, key: true } });
    return photos.map((p) => rows.find((r) => r.id === p.id)?.key).filter((k): k is string => !!k);
  }

  /** Links the given photos (in order, first = cover) and detaches any others. */
  /**
   * An upload marked `?for=chat` skips the listing rules (photo size, 30 s video) and nothing stored says what it was
   * for, so media new to the listing is checked against them again before anything is saved. `listingId` is null
   * for a listing being created.
   */
  private async assertListingMedia(userId: string, listingId: string | null, photos?: { id: string }[], videoId?: string | null) {
    if (photos?.length) {
      const fresh = await this.prisma.photo.findMany({
        where: { id: { in: photos.map((p) => p.id) }, ownerId: userId, ...(listingId ? { OR: [{ listingId: null }, { listingId: { not: listingId } }] } : {}) },
        select: { width: true, height: true },
      });
      if (fresh.some((p) => Math.min(p.width, p.height) < LISTING_MIN_SIDE)) {
        throw new BadRequestException({ message: 'Фото слишком маленькое — нужно от 400 px по меньшей стороне', code: 'TOO_SMALL', fields: { photos: 'Фото слишком маленькое' } });
      }
    }
    if (videoId) {
      const v = await this.prisma.video.findFirst({ where: { id: videoId, ownerId: userId }, select: { listingId: true, provider: true, ext: true, durationMs: true } });
      if (v && (!listingId || v.listingId !== listingId)) {
        if (v.durationMs > MAX_VIDEO_MS + 500) throw new BadRequestException({ message: 'Видео должно быть не длиннее 30 секунд', code: 'TOO_LONG', fields: { video: 'Не длиннее 30 секунд' } });
        // A local WebM's length was only reported by the browser.
        if (v.provider === 'LOCAL' && v.ext === 'webm') throw new BadRequestException({ message: 'Для объявления загрузите видео в формате MP4', code: 'NO_DURATION', fields: { video: 'Нужен MP4' } });
      }
    }
  }

  private async attachPhotos(userId: string, listingId: string, photos: { id: string; isDefect: boolean }[]) {
    const owned = await this.prisma.photo.findMany({ where: { id: { in: photos.map((p) => p.id) }, ownerId: userId }, select: { id: true } });
    const ownedIds = new Set(owned.map((p) => p.id));
    await this.prisma.$transaction([
      this.prisma.photo.updateMany({ where: { listingId, id: { notIn: [...ownedIds] } }, data: { listingId: null } }),
      ...photos
        .filter((p) => ownedIds.has(p.id))
        .map((p, i) => this.prisma.photo.update({ where: { id: p.id }, data: { listingId, order: i, isCover: i === 0, isDefect: p.isDefect } })),
    ]);
  }

  /** One video per listing: links the given one (if it's the user's) and unlinks any other. */
  private async attachVideo(userId: string, listingId: string, videoId: string | null) {
    await this.prisma.video.updateMany({ where: { listingId, ...(videoId ? { id: { not: videoId } } : {}) }, data: { listingId: null } });
    if (videoId) await this.prisma.video.updateMany({ where: { id: videoId, ownerId: userId }, data: { listingId } });
  }

  /** Images moderation looks at: the photos plus the video's frames (three across a Cloudinary clip, else the poster). */
  private async moderationKeys(userId: string, listingId: string, photos?: { id: string }[], videoId?: string | null) {
    const keys = await this.photoKeys(userId, listingId, photos);
    const video =
      videoId === undefined
        ? await this.prisma.video.findUnique({ where: { listingId }, select: { key: true, provider: true } })
        : videoId
          ? await this.prisma.video.findFirst({ where: { id: videoId, ownerId: userId }, select: { key: true, provider: true } })
          : null;
    return video ? [...keys, ...videoFrameKeys(video)] : keys;
  }

  /** Missing or inconsistent fields that block publication, as field errors. */
  private publishErrors(listing: Listing, photoCount: number) {
    const fields: Record<string, string> = {};
    if (!photoCount) fields.photos = 'Добавьте хотя бы одно фото';
    if (!listing.title.trim()) fields.title = 'Укажите название';
    if (!listing.category) fields.category = 'Выберите категорию';
    if (sizeRequired(listing.category) && !listing.sizeValue) fields.size = 'Укажите размер';
    if (!listing.condition) fields.condition = 'Выберите состояние';
    else if (listing.condition === 'NEW_WITH_TAGS' && listing.hasTags == null) fields.hasTags = 'Укажите, есть ли бирка';
    if (listing.defectsPresent == null) fields.defects = 'Укажите, есть ли дефекты';
    if (listing.defectsPresent && !listing.defectsDescription?.trim()) fields.defectsDescription = 'Опишите дефекты';
    if (!listing.price && !listing.priceNegotiable) fields.price = 'Укажите цену';
    if (listing.priceNegotiable && listing.saleType === 'AUCTION') fields.price = 'На аукционе нужна стартовая цена';
    if (!listing.deliveryOptions.length) fields.deliveryOptions = 'Выберите способ передачи';
    if (listing.originalPrice != null && listing.price != null && listing.originalPrice <= listing.price) fields.originalPrice = 'Цена в магазине должна быть выше вашей';
    if (listing.minOfferPrice != null && listing.price != null && listing.minOfferPrice >= listing.price) fields.minOfferPrice = 'Порог автоотказа должен быть ниже цены';
    if (listing.saleType === 'AUCTION') {
      if (!AUCTION_DURATIONS.includes(listing.auctionHours ?? 0)) fields.auctionHours = 'Выберите длительность аукциона';
      if (listing.auctionReserve != null && listing.price != null && listing.auctionReserve < listing.price) fields.auctionReserve = 'Резерв не может быть ниже стартовой цены';
      if (listing.auctionBuyNow != null && listing.price != null && listing.auctionBuyNow <= listing.price) fields.auctionBuyNow = 'Цена «Купить сейчас» должна быть выше стартовой';
      else if (listing.auctionBuyNow != null && listing.auctionReserve != null && listing.auctionBuyNow < listing.auctionReserve) fields.auctionBuyNow = 'Цена «Купить сейчас» не может быть ниже резерва';
      if (listing.sizes.length > 1) fields.size = 'Несколько размеров можно выставить только с фиксированной ценой';
    } else if (listing.acceptsOffers && listing.autoAcceptPrice != null && listing.price != null) {
      if (listing.autoAcceptPrice >= listing.price) fields.autoAcceptPrice = 'Должно быть ниже цены — по цене покупают без торга';
      else if (listing.minOfferPrice != null && listing.autoAcceptPrice <= listing.minOfferPrice) fields.autoAcceptPrice = 'Должно быть выше порога автоотказа';
    }
    return fields;
  }

  // ---------- lifecycle ----------

  /**
   * `trustedPhotos`: the photos were checked by hand as different items (a shop import), so the photo half of the
   * duplicate check is skipped; the text check and moderation still apply.
   * `allowUnchecked`: an import may go live while no model can look at the photos (cron checks them later).
   */
  async publish(userId: string, id: string, opts: { trustedPhotos?: boolean; allowUnchecked?: boolean } = {}) {
    const listing = await this.ownListing(userId, id);
    if (listing.status === 'PUBLISHED') return this.getForOwner(userId, id);
    if (!['DRAFT', 'HIDDEN'].includes(listing.status)) throw new ConflictException({ message: 'Эту вещь нельзя опубликовать' });
    if (listing.hiddenByAdmin) throw new ConflictException({ message: 'Объявления этого аккаунта скрыты администрацией' });

    const verdict = await this.checkPublishable(userId, listing, opts.trustedPhotos, opts.allowUnchecked);
    // An account whose listings an admin hid: new items (the shop import too) are saved hidden as well.
    const seller = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { listingsHiddenAt: true, brandVerifiedAt: true, catalogApprovedAt: true } });
    const hidden = !!seller.listingsHiddenAt;
    // The status write is conditional and the auction is opened in the same transaction: two publishes racing (a
    // double click, the scheduler and the seller) can't both go through, open two auctions or notify twice.
    let won: boolean;
    try {
      won = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.listing.updateMany({
          where: { id, status: { in: ['DRAFT', 'HIDDEN'] }, hiddenByAdmin: false },
          data: {
            status: hidden ? 'HIDDEN' : 'PUBLISHED',
            hiddenByAdmin: hidden,
            // A draft is classified when it first goes live, with everything known (it may predate a change of the seller's
            // status). An item brought back from hidden keeps its section: it never moves just for being shown again.
            ...(listing.status === 'DRAFT' && !listing.marketByAdmin ? { market: marketFor(seller, listing.condition, listing.hasTags) } : {}),
            publishedAt: listing.publishedAt ?? new Date(),
            liftedAt: listing.liftedAt ?? new Date(),
            scheduledAt: null,
          },
        });
        if (!count) return false;
        // Auction clock starts at publication (decision D16). One ACTIVE auction per listing is a partial unique index:
        // ON CONFLICT DO NOTHING (skipDuplicates) treats an existing one as "already active" without failing the
        // transaction, as a caught error would in Postgres.
        if (!hidden && listing.saleType === 'AUCTION') {
          await tx.auction.createMany({
            data: [
              {
                listingId: id,
                startPrice: listing.price!,
                step: listing.auctionStep ?? defaultStep(listing.price!),
                reservePrice: listing.auctionReserve,
                buyNowPrice: listing.auctionBuyNow,
                endsAt: new Date(Date.now() + listing.auctionHours! * 3600 * 1000),
              },
            ],
            skipDuplicates: true,
          });
        }
        return true;
      });
    } catch (e) {
      // A racing publish opened the auction first: the listing is live already.
      if (isUniqueViolation(e)) return this.getForOwner(userId, id);
      throw e;
    }
    // Someone else published (or hid) it meanwhile: nothing more to do here.
    if (!won) return this.getForOwner(userId, id);
    await this.moderator.record(listing, verdict);
    if (hidden) return this.getForOwner(userId, id);
    if (!listing.publishedAt) {
      const [followers, seller] = await Promise.all([
        this.prisma.follow.findMany({ where: { sellerId: userId }, select: { followerId: true } }),
        this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } }),
      ]);
      await this.notifications.notifyMany(followers.map((f) => f.followerId), 'follow_new_item', { listingId: id, title: listing.title, seller: seller.username });
    }
    return this.getForOwner(userId, id);
  }

  /** Required fields, then automatic moderation (rules + AI ensemble); violations come back as field errors. */
  private async checkPublishable(userId: string, listing: Listing, trustedPhotos = false, allowUnchecked = false) {
    const keys = await this.moderationKeys(userId, listing.id);
    const photoCount = await this.prisma.photo.count({ where: { listingId: listing.id } });
    const fields = this.publishErrors(listing, photoCount);
    if (Object.keys(fields).length) throw new BadRequestException({ message: 'Заполните обязательные поля', fields });
    const duplicate = await this.findDuplicate(listing, trustedPhotos);
    if (duplicate) {
      throw new BadRequestException({
        message: 'У вас уже есть такое объявление',
        code: 'DUPLICATE',
        duplicateOf: duplicate.id,
        fields: { [duplicate.by === 'photo' ? 'photos' : 'title']: `Похоже на вашу вещь «${duplicate.title}». Поднимите или отредактируйте её вместо нового объявления` },
      });
    }
    const verdict = await this.moderator.check(listing, keys, { allowUnchecked });
    if (verdict.decision === 'reject') throw new BadRequestException({ message: 'Объявление не прошло проверку', code: 'MODERATION', fields: verdict.fields, retry: !!verdict.retry });
    return verdict;
  }

  /**
   * One item = one listing (as on Avito): a seller can't publish the same thing twice to take more space in
   * feeds. A duplicate is one of their live or scheduled listings with a near-identical photo, or with the same
   * title, category and size. Copies in other sizes (same groupId) are the same item on purpose.
   */
  private async findDuplicate(listing: Listing, skipPhotos = false): Promise<{ id: string; title: string; by: 'photo' | 'text' } | null> {
    const others = await this.prisma.listing.findMany({
      where: {
        sellerId: listing.sellerId,
        id: { not: listing.id },
        OR: [{ status: { in: ['PUBLISHED', 'RESERVED'] } }, { status: 'DRAFT', scheduledAt: { not: null } }],
        ...(listing.groupId ? { NOT: { groupId: listing.groupId } } : {}),
      },
      // The latest 100 are where a re-post would be; a big shop's whole catalogue isn't compared photo by photo.
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, category: true, sizeValue: true, groupId: true, photos: { select: { dhash: true } } },
    });
    if (!others.length) return null;
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
    const text = others.find((o) => norm(o.title) === norm(listing.title) && o.category === listing.category && (o.sizeValue ?? '') === (listing.sizeValue ?? ''));
    if (text) return { id: text.id, title: text.title, by: 'text' };
    if (skipPhotos) return null;

    // Stored hashes only (filled at upload, old photos by the backfill job): no image reads on this path.
    const mine = await this.prisma.photo.findMany({ where: { listingId: listing.id }, select: { dhash: true } });
    const myHashes = mine.map((p) => usableHash(p.dhash)).filter((h): h is string => !!h);
    if (!myHashes.length) return null;
    for (const o of others) {
      for (const p of o.photos) {
        const h = usableHash(p.dhash);
        // ≤ 6 of 64 bits: the same shot (re-saved, recompressed, slightly cropped), not just a similar item.
        if (h && myHashes.some((m) => hashDistance(m, h) <= 6)) return { id: o.id, title: o.title, by: 'photo' };
      }
    }
    return null;
  }

  /**
   * "Отложенная публикация": the draft is checked now, so the seller fixes problems while still here,
   * and published by the cron at the chosen time.
   */
  async schedule(userId: string, id: string, at: Date) {
    const listing = await this.ownListing(userId, id);
    if (listing.status !== 'DRAFT') throw new ConflictException({ message: 'Запланировать можно только черновик' });
    const ms = at.getTime() - Date.now();
    if (ms < 5 * 60_000) throw new BadRequestException({ message: 'Выберите время хотя бы через 5 минут', fields: { scheduledAt: 'Не раньше чем через 5 минут' } });
    if (ms > 30 * 24 * 3600_000) throw new BadRequestException({ message: 'Запланировать можно не дальше чем на 30 дней', fields: { scheduledAt: 'Не дальше 30 дней' } });
    await this.checkPublishable(userId, listing);
    await this.prisma.listing.update({ where: { id }, data: { scheduledAt: at } });
    return this.getForOwner(userId, id);
  }

  async unschedule(userId: string, id: string) {
    await this.ownListing(userId, id);
    await this.prisma.listing.update({ where: { id }, data: { scheduledAt: null } });
    return { ok: true };
  }

  private readonly logger = new Logger('Listings');

  @Cron(CronExpression.EVERY_MINUTE)
  async publishScheduled() {
    await withJobLock(this.redis, 'listings.publishScheduled', 60_000, () => this.publishDue());
  }

  private async publishDue() {
    const now = Date.now();
    for (const [id, at] of this.retriedAt) if (now - at >= 5 * 60_000) this.retriedAt.delete(id);
    const due = await this.prisma.listing.findMany({
      where: {
        status: 'DRAFT',
        scheduledAt: { lte: new Date() },
        // A blocked or deleted seller's drafts stay drafts.
        seller: { blockedAt: null, deletedAt: null },
        // Ones that just failed for want of a model wait a few minutes, so they don't take every turn from the rest.
        ...(this.retriedAt.size ? { id: { notIn: [...this.retriedAt.keys()] } } : {}),
      },
      select: { id: true, sellerId: true, title: true },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });
    for (const l of due) {
      try {
        await this.publish(l.sellerId, l.id);
        await this.notifications.notify(l.sellerId, 'listing_scheduled_published', { listingId: l.id, title: l.title });
      } catch (e) {
        // No model could look at the photos this minute: the listing stays scheduled and is tried again later.
        if (e instanceof BadRequestException && (e.getResponse() as { retry?: boolean }).retry) {
          this.retriedAt.set(l.id, Date.now());
          continue;
        }
        // Something changed since scheduling (moderation rules, a deleted photo): back to a plain draft.
        await this.prisma.listing.update({ where: { id: l.id }, data: { scheduledAt: null } });
        const reason = e instanceof BadRequestException || e instanceof ConflictException ? ((e.getResponse() as { message?: string }).message ?? null) : null;
        await this.notifications.notify(l.sellerId, 'listing_schedule_failed', { listingId: l.id, title: l.title, reason });
        if (!reason) this.logger.warn(`scheduled publish of ${l.id} failed: ${(e as Error).message}`);
      }
    }
  }

  async hide(userId: string, id: string) {
    const listing = await this.ownListing(userId, id);
    if (listing.status !== 'PUBLISHED') throw new ConflictException({ message: 'Скрыть можно только вещь в продаже' });
    await this.stopAuction(id);
    await this.prisma.listing.update({ where: { id }, data: { status: 'HIDDEN' } });
    await this.prisma.offer.updateMany({ where: { listingId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  /**
   * "Поднять" (feature 11): moves a listing to the top of "Новинки" and search by freshness. Free, once per
   * 72 h, the first time 24 h after publication — often enough to help a seller, rare enough not to flood.
   */
  async bump(userId: string, id: string) {
    const listing = await this.ownListing(userId, id);
    const next = nextBumpAt(listing);
    if (!next) throw new ConflictException({ message: 'Поднять можно только вещь в продаже' });
    if (next.getTime() > Date.now()) {
      const hours = Math.ceil((next.getTime() - Date.now()) / 3600_000);
      throw new ConflictException({ message: `Поднять снова можно через ${hours} ч`, nextAt: next });
    }
    const now = new Date();
    // Guarded update: two clicks can't both pass the cooldown.
    const { count } = await this.prisma.listing.updateMany({
      where: { id, status: 'PUBLISHED', lastBumpAt: listing.lastBumpAt },
      data: { liftedAt: now, lastBumpAt: now, bumpsCount: { increment: 1 } },
    });
    if (!count) throw new ConflictException({ message: 'Вещь уже подняли — обновите страницу' });
    return { liftedAt: now, nextAt: nextBumpAt({ ...listing, lastBumpAt: now }) };
  }

  /** "Продано вне платформы": pending requests are declined and buyers notified. */
  async markSold(userId: string, id: string) {
    const listing = await this.ownListing(userId, id);
    if (listing.status === 'RESERVED') throw new ConflictException({ message: 'Идёт сделка — завершите или отмените её в «Мои продажи»' });
    if (!['PUBLISHED', 'HIDDEN'].includes(listing.status)) throw new ConflictException({ message: 'Эту вещь нельзя пометить проданной' });
    // A SOLD page is public again: what an admin (or a block) took down must not come back through «Продано».
    if (listing.hiddenByAdmin || listing.hiddenByBlock) throw new ConflictException({ message: 'Объявление скрыто администрацией — его нельзя пометить проданным' });
    if (listing.status === 'HIDDEN') await this.ensureModerated(userId, listing);
    await this.stopAuction(id);
    await this.prisma.listing.update({ where: { id }, data: { status: 'SOLD', soldAt: new Date() } });
    await this.prisma.offer.updateMany({ where: { listingId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await this.declinePendingRequests(id, 'Уже продано');
    await this.notifyWatchers(id, 'item_sold', listing.title);
    return { ok: true };
  }

  /**
   * A hidden item about to become public (as SOLD) must show content moderation saw: the stored verdict's hash has to
   * match what it holds now; otherwise (edited while hidden before edits there were moderated) it is checked first.
   */
  private async ensureModerated(userId: string, listing: Listing) {
    const keys = await this.moderationKeys(userId, listing.id);
    const prev = listing.moderation as { hash?: string; status?: string } | null;
    if (prev?.hash === this.moderator.contentHash(listing, keys) && prev.status !== 'rejected') return;
    const verdict = await this.moderator.check(listing, keys);
    if (verdict.decision === 'reject') throw new BadRequestException({ message: 'Объявление не прошло проверку — исправьте его', code: 'MODERATION', fields: verdict.fields, retry: !!verdict.retry });
    await this.moderator.record(listing, verdict);
  }

  /** Soft delete; finished deals keep pointing at the listing. */
  async remove(userId: string, id: string) {
    const listing = await this.ownListing(userId, id);
    if (listing.status === 'RESERVED') throw new ConflictException({ message: 'Идёт сделка — завершите или отмените её в «Мои продажи»' });
    await this.stopAuction(id);
    await this.prisma.listing.update({ where: { id }, data: { status: 'DELETED' } });
    await this.prisma.offer.updateMany({ where: { listingId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await this.declinePendingRequests(id, 'Передумал продавать');
    return { ok: true };
  }

  /**
   * Taken off sale by an admin (blocked item, blocked or hidden account): pending offers are void and a running
   * auction is cancelled, bids or not, so the closing cron never tries to award an item that is gone.
   */
  async withdrawFromSale(listingIds: string[]) {
    if (!listingIds.length) return;
    const auctioned = await this.prisma.auction.findMany({ where: { listingId: { in: listingIds }, status: 'ACTIVE' }, select: { listingId: true } });
    await this.prisma.$transaction([
      this.prisma.offer.updateMany({ where: { listingId: { in: listingIds }, status: 'PENDING' }, data: { status: 'CANCELLED' } }),
      this.prisma.auction.updateMany({ where: { listingId: { in: listingIds }, status: 'ACTIVE' }, data: { status: 'CANCELLED' } }),
      // Back on sale later (unblocked), such an item is sold at a fixed price, as after an auction without a sale.
      this.prisma.listing.updateMany({ where: { id: { in: auctioned.map((a) => a.listingId) } }, data: { saleType: 'FIXED' } }),
    ]);
  }

  /**
   * The seller was blocked: everything on sale is hidden and marked as hidden by the block, so unblocking brings back
   * exactly these items. Drafts, items the seller or an admin hid, moderator-blocked, reserved, sold and deleted items
   * are left as they are.
   */
  async hideForBlock(sellerId: string) {
    const onSale = await this.prisma.listing.findMany({ where: { sellerId, status: 'PUBLISHED' }, select: { id: true } });
    const ids = onSale.map((l) => l.id);
    await this.prisma.listing.updateMany({ where: { id: { in: ids }, status: 'PUBLISHED' }, data: { status: 'HIDDEN', hiddenByBlock: true } });
    // Scheduled drafts would otherwise go live on their own (the scheduler skips blocked sellers too).
    await this.prisma.listing.updateMany({ where: { sellerId, status: 'DRAFT', scheduledAt: { not: null } }, data: { scheduledAt: null } });
    await this.withdrawFromSale(ids);
    return ids.length;
  }

  /**
   * The seller was unblocked: items hidden only by the block go back on sale. An item hidden for another reason too
   * (all of the account's items hidden by an admin) stays hidden; one blocked by a moderator or deleted meanwhile
   * isn't HIDDEN any more and is not touched. The mark is cleared either way.
   */
  async restoreAfterUnblock(sellerId: string) {
    const seller = await this.prisma.user.findUnique({ where: { id: sellerId }, select: { listingsHiddenAt: true } });
    // The account's items are also hidden by an admin: they wait for «Показать объявления» instead.
    const hiddenByAdminToo = !!seller?.listingsHiddenAt;
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.listing.updateMany({
        where: { sellerId, hiddenByBlock: true, status: 'HIDDEN', hiddenByAdmin: false },
        data: hiddenByAdminToo ? { hiddenByAdmin: true } : { status: 'PUBLISHED' },
      }),
      this.prisma.listing.updateMany({ where: { sellerId, hiddenByBlock: true }, data: { hiddenByBlock: false } }),
    ]);
    return hiddenByAdminToo ? 0 : count;
  }

  /** A running auction can be stopped only before the first bid. */
  private async stopAuction(listingId: string) {
    const a = await this.prisma.auction.findFirst({ where: { listingId, status: 'ACTIVE' }, include: { _count: { select: { bids: true } } } });
    if (!a) return;
    if (a._count.bids > 0) throw new ConflictException({ message: 'Идёт аукцион и уже есть ставки — дождитесь окончания' });
    await this.prisma.auction.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
  }

  async declinePendingRequests(listingId: string, reason: string, exceptRequestId?: string) {
    const pending = await this.prisma.buyRequest.findMany({
      where: { status: 'PENDING_SELLER', items: { some: { listingId } }, id: exceptRequestId ? { not: exceptRequestId } : undefined },
      include: { items: { include: { listing: { select: { title: true } } } } },
    });
    for (const r of pending) {
      await this.prisma.buyRequest.update({
        where: { id: r.id },
        data: { status: 'DECLINED', reason, events: { create: { status: 'DECLINED', reason } } },
      });
      await this.notifications.notify(r.buyerId, 'request_declined', { requestId: r.id, title: r.items[0]?.listing.title, reason });
    }
  }

  async notifyWatchers(listingId: string, type: 'item_reserved' | 'item_sold' | 'item_available', title: string, exceptUserId?: string) {
    const favs = await this.prisma.favorite.findMany({ where: { listingId, userId: exceptUserId ? { not: exceptUserId } : undefined }, select: { userId: true } });
    await this.notifications.notifyMany(favs.map((f) => f.userId), type, { listingId, title });
  }

  // ---------- read: product page ----------

  /**
   * Whether this is the person's (or IP's) first view of the item today: reloads and scripted hits don't inflate the
   * counter. In memory, bounded: swept hourly of past days, cleared outright if it still grows past the cap.
   */
  private firstViewToday(listingId: string, viewer: string | undefined) {
    if (!viewer) return true;
    const day = Math.floor(Date.now() / DAY_MS);
    if (Date.now() - this.viewsSweptAt > 3600_000 || this.views.size >= VIEW_KEYS_MAX) {
      for (const [k, d] of this.views) if (d !== day) this.views.delete(k);
      if (this.views.size >= VIEW_KEYS_MAX) this.views.clear();
      this.viewsSweptAt = Date.now();
    }
    const key = `${listingId}:${viewer}`;
    if (this.views.get(key) === day) return false;
    this.views.set(key, day);
    return true;
  }

  async getForOwner(userId: string, id: string) {
    return this.get(id, userId, { trackView: false });
  }

  /** `viewer`: who is looking when nobody is signed in (the IP), so a guest's reloads count once too. */
  async get(id: string, viewerId?: string, opts: { trackView?: boolean; viewer?: string } = {}) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { photos: { orderBy: { order: 'asc' } }, video: true, seller: { select: { id: true, username: true, city: true, createdAt: true } } },
    });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });

    const isOwner = viewerId === listing.sellerId;
    if (!isOwner) {
      if (listing.status === 'DRAFT') throw new NotFoundException({ message: 'Такой вещи нет' });
      if (listing.status === 'HIDDEN' || listing.status === 'BLOCKED') {
        return { unavailable: listing.status === 'HIDDEN' ? 'hidden' : 'blocked', id: listing.id, seller: { username: listing.seller.username } } as const;
      }
    }

    if (!isOwner && opts.trackView !== false) {
      if (this.firstViewToday(id, viewerId ?? opts.viewer)) {
        // Raw UPDATE: a view must not touch `updatedAt`, which the sitemap gives crawlers as the page's lastmod.
        await this.prisma.$executeRaw`UPDATE "Listing" SET "viewsCount" = "viewsCount" + 1 WHERE id = ${id}`;
        this.stats.track(id, 'views');
      }
      if (viewerId) await this.recs.record(viewerId, 'view', id);
    }

    const auctionRow = listing.saleType === 'AUCTION' || (await this.prisma.auction.count({ where: { listingId: id } })) > 0
      ? await this.prisma.auction.findFirst({ where: { listingId: id }, orderBy: { createdAt: 'desc' }, include: auctionInclude })
      : null;
    const [inCart, pendingOffers, appealOpen] = await Promise.all([
      viewerId && !isOwner ? this.prisma.cartItem.findUnique({ where: { userId_listingId: { userId: viewerId, listingId: id } } }).then(Boolean) : false,
      isOwner ? this.prisma.offer.count({ where: { listingId: id, status: 'PENDING', from: 'BUYER', expiresAt: { gt: new Date() } } }) : 0,
      isOwner && listing.status === 'BLOCKED' ? this.prisma.report.count({ where: { targetType: 'APPEAL', targetId: id, status: 'OPEN' } }).then(Boolean) : false,
    ]);
    const viewer = viewerId && !isOwner ? await this.prisma.user.findUnique({ where: { id: viewerId }, select: { sizes: true, bodyMeasurements: true } }) : null;
    const [seller, isFavorite, myRequest, ownerStats] = await Promise.all([
      this.sellerSummary(listing.sellerId, viewerId),
      viewerId ? this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: viewerId, listingId: id } } }).then(Boolean) : false,
      viewerId && !isOwner
        ? this.prisma.buyRequest.findFirst({
            where: { buyerId: viewerId, items: { some: { listingId: id } }, status: { in: [...ACTIVE_REQUEST_STATUSES, 'COMPLETED'] } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true, number: true },
          })
        : null,
      isOwner
        ? this.prisma.buyRequest.count({ where: { items: { some: { listingId: id } }, status: 'PENDING_SELLER' } })
        : null,
    ]);

    // Other sizes of the same item (multi-size listing).
    const siblings = listing.groupId
      ? await this.prisma.listing.findMany({
          where: { groupId: listing.groupId, OR: [{ status: { in: VISIBLE_IN_FEED } }, { id }] },
          select: { id: true, sizeValue: true, status: true },
        })
      : [];
    const sizeOrder = (s: string | null) => (s && /^\d+$/.test(s.replace(/^W/, '')) ? Number(s.replace(/^W/, '')) : ['XS', 'S', 'M', 'L', 'XL', 'XXL'].indexOf(s ?? ''));
    const ai = (listing.aiAttributes ?? {}) as Record<string, { accepted_by_user?: boolean; edited_by_user?: boolean }>;
    const category = categoryBySlug(listing.category);
    return {
      id: listing.id,
      status: listing.status,
      title: listing.title,
      price: listing.price,
      priceNegotiable: listing.priceNegotiable,
      previousPrice: listing.previousPrice,
      originalPrice: listing.originalPrice,
      labels: listing.labels,
      /** Section the item is shown in (brands = the main catalogue): links from its page stay in it. */
      market: marketOf(listing),
      /** «Несколько размеров»: every size in stock (empty for a one-size listing). */
      stockSizes: listing.sizes,
      category: listing.category,
      categoryLabel: category?.label ?? null,
      subcategory: listing.subcategory,
      subcategoryLabel: category?.subcategories.find((s) => s.slug === listing.subcategory)?.label ?? null,
      sizeSystem: listing.sizeSystem,
      size: listing.sizeValue,
      condition: listing.condition,
      hasTags: listing.hasTags,
      defectsPresent: listing.defectsPresent,
      defectsDescription: listing.defectsDescription,
      brand: listing.brand,
      color: listing.color,
      material: listing.material,
      measurements: listing.measurements,
      description: listing.description,
      descriptionByAi: !!ai.description?.accepted_by_user && !ai.description?.edited_by_user,
      city: listing.city,
      deliveryOptions: listing.deliveryOptions,
      acceptsOffers: listing.acceptsOffers,
      gender: listing.gender,
      styleTags: listing.styleTags,
      viewsCount: listing.viewsCount,
      favoritesCount: listing.favoritesCount,
      publishedAt: listing.publishedAt,
      createdAt: listing.createdAt,
      blockedReason: isOwner ? listing.blockedReason : null,
      photos: listing.photos.map(serializePhoto),
      video: listing.video ? serializeVideo(listing.video) : null,
      sizes:
        siblings.length > 1
          ? siblings.sort((a, b) => sizeOrder(a.sizeValue) - sizeOrder(b.sizeValue)).map((s) => ({ id: s.id, size: s.sizeValue, available: s.status === 'PUBLISHED', current: s.id === id }))
          : null,
      seller,
      isOwner,
      isFavorite,
      inCart,
      saleType: listing.saleType,
      auction: auctionRow ? serializeAuction(auctionRow, viewerId, listing.sellerId) : null,
      myRequest,
      // Size hint for the signed-in buyer: null when we know nothing about their sizes.
      fit: viewer ? fitHint(listing, { body: viewer.bodyMeasurements as BodyMeasurements | null, sizes: viewer.sizes as PreferredSizes | null }) : null,
      fitProfile: viewer ? !!(viewer.bodyMeasurements || viewer.sizes) : null,
      // Owner-only extras (frame 10 Edit Item needs these to rebuild the form).
      owner: isOwner
        ? {
            pendingRequests: ownerStats,
            pendingOffers,
            appealOpen,
            auctionStep: listing.auctionStep,
            auctionReserve: listing.auctionReserve,
            auctionHours: listing.auctionHours,
            auctionBuyNow: listing.auctionBuyNow,
            minOfferPrice: listing.minOfferPrice,
            autoAcceptPrice: listing.autoAcceptPrice,
            scheduledAt: listing.scheduledAt,
            likersOfferAt: listing.likersOfferAt,
            aiAttributes: listing.aiAttributes,
            sizeSystem: listing.sizeSystem,
            bump: (() => {
              const next = nextBumpAt(listing);
              return next ? { nextAt: next, available: next.getTime() <= Date.now(), count: listing.bumpsCount } : null;
            })(),
          }
        : null,
    };
  }

  /**
   * A seller's 2×2 collage: their latest items, one of each kind (a hoodie, jeans, shoes, a cap — not four caps),
   * topped up with the latest others when they sell fewer kinds.
   */
  async collage(sellerId: string) {
    const latest = await this.prisma.listing.findMany({
      where: { sellerId, status: 'PUBLISHED' },
      include: { photos: { orderBy: [{ isCover: 'desc' }, { order: 'asc' }], take: 1 } },
      orderBy: { publishedAt: 'desc' },
      take: 60,
    });
    const picked: typeof latest = [];
    const kinds = new Set<string>();
    for (const l of latest) {
      if (picked.length === 4 || kinds.has(kindOf(l))) continue;
      kinds.add(kindOf(l));
      picked.push(l);
    }
    for (const l of latest) if (picked.length < 4 && !picked.includes(l)) picked.push(l);
    return picked.map((l) => {
      const p = l.photos[0];
      return p ? { width: p.width, height: p.height, urls: serializePhoto(p).urls } : null;
    });
  }

  async sellerSummary(sellerId: string, viewerId?: string) {
    const summary = (await this.sellerSummaries([sellerId], viewerId)).get(sellerId);
    if (!summary) throw new NotFoundException({ message: 'Такого продавца нет' });
    return summary;
  }

  /** Seller summaries for many sellers at once: one grouped query per metric, whatever the number of sellers. */
  async sellerSummaries(ids: string[], viewerId?: string) {
    const [users, listingCounts, followers, following, deals, ratings, viewerFollows] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, city: true, bio: true, createdAt: true, bundleDiscounts: true, brandVerifiedAt: true, brandName: true, avatar: { select: { key: true, provider: true } } },
      }),
      this.prisma.listing.groupBy({ by: ['sellerId', 'status'], where: { sellerId: { in: ids }, status: { in: [...VISIBLE_IN_FEED, 'SOLD'] } }, _count: { _all: true } }),
      this.prisma.follow.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.follow.groupBy({ by: ['followerId'], where: { followerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.buyRequest.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, status: 'COMPLETED' }, _count: { _all: true } }),
      this.prisma.review.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, hidden: false }, _avg: { rating: true }, _count: { _all: true } }),
      viewerId ? this.prisma.follow.findMany({ where: { followerId: viewerId, sellerId: { in: ids } }, select: { sellerId: true } }) : [],
    ]);
    const active = new Map<string, number>();
    const sold = new Map<string, number>();
    for (const r of listingCounts) {
      const m = r.status === 'SOLD' ? sold : active;
      m.set(r.sellerId, (m.get(r.sellerId) ?? 0) + r._count._all);
    }
    const followerCount = new Map(followers.map((r) => [r.sellerId, r._count._all]));
    const followingCount = new Map(following.map((r) => [r.followerId, r._count._all]));
    const dealCount = new Map(deals.map((r) => [r.sellerId, r._count._all]));
    const ratingOf = new Map(ratings.map((r) => [r.sellerId, r]));
    const followed = new Set(viewerFollows.map((f) => f.sellerId));
    return new Map(
      users.map((user) => {
        const { bundleDiscounts, avatar, brandVerifiedAt, brandName, ...profile } = user;
        const rating = ratingOf.get(user.id);
        const summary = {
          /** «Бренд» status: the brand's name, or null. */
          brand: brandVerifiedAt ? (brandName ?? user.username) : null,
          ...profile,
          avatar: avatar ? photoUrls(avatar) : null,
          activeCount: active.get(user.id) ?? 0,
          soldCount: sold.get(user.id) ?? 0,
          followers: followerCount.get(user.id) ?? 0,
          following: followingCount.get(user.id) ?? 0,
          completedDeals: dealCount.get(user.id) ?? 0,
          isFollowing: !!viewerId && viewerId !== user.id && followed.has(user.id),
          rating: rating?._count._all ? { avg: Math.round((rating._avg.rating ?? 0) * 10) / 10, count: rating._count._all } : null,
          bundleDiscounts: tiersOf(bundleDiscounts),
        };
        return [user.id, summary] as const;
      }),
    );
  }

  /**
   * "Похожие" (Wildberries-style): items of the same category ranked by how alike they are — subcategory,
   * brand, colour, audience, size, price and how close the cover photos look (difference hash).
   * Other sizes of the same item and the viewer's own items are left out.
   */
  private async rankSimilar(listing: Listing, viewerId?: string, pool = 300) {
    const rows = await this.prisma.listing.findMany({
      where: {
        status: { in: VISIBLE_IN_FEED },
        ...marketWhere(marketOf(listing)),
        id: { not: listing.id },
        category: listing.category,
        ...(viewerId ? { sellerId: { not: viewerId } } : {}),
        ...(listing.groupId ? { NOT: { groupId: listing.groupId } } : {}),
      },
      include: { ...cardInclude, photos: { orderBy: [{ isCover: 'desc' }, { order: 'asc' }], take: 1 } },
      orderBy: { liftedAt: 'desc' },
      take: pool,
    });
    // Stored hashes only (no image reads on a public page); a photo without one simply gives no visual signal.
    const myCover = await this.prisma.photo.findFirst({ where: { listingId: listing.id }, orderBy: [{ isCover: 'desc' }, { order: 'asc' }], select: { dhash: true } });
    const mine = usableHash(myCover?.dhash);
    const price = listing.price ?? 0;
    const scored = rows.map((l) => {
      let s = 0;
      if (listing.subcategory && l.subcategory === listing.subcategory) s += 3;
      if (listing.brand && l.brand && l.brand.toLowerCase() === listing.brand.toLowerCase()) s += 2;
      if (listing.color && l.color === listing.color) s += 1.5;
      if (listing.gender && (l.gender === listing.gender || l.gender == null || l.gender === 'UNISEX')) s += 0.5;
      if (listing.sizeValue && l.sizeValue === listing.sizeValue) s += 0.5;
      if (price && l.price) s -= Math.min(2, Math.abs(l.price - price) / price) * 1.5;
      const h = mine ? usableHash(l.photos[0]?.dhash) : null;
      // Photos within ~20 of 64 bits share composition and tones: a weak but useful visual signal.
      if (mine && h) s += Math.max(0, (20 - hashDistance(mine, h)) / 20) * 2;
      return { l, s };
    });
    return scored.sort((a, b) => b.s - a.s).map((x) => x.l);
  }

  /**
   * Search by photo: what the AI recognised (category, subcategory, brand, colour — confident answers only) plus
   * how close each cover photo looks. The category only weighs in, it doesn't filter: when the AI files the item
   * under a neighbouring category (a backpack as an accessory), a close photo still comes out on top.
   */
  /**
   * Candidates for a search by photo (ai/photo-search.ts ranks them): what's on sale in the market, of the type the
   * AI saw (any type when it couldn't tell), with the cover photo and the words that describe the item.
   */
  async photoCandidates(category: string | null, market: Market, viewerId?: string) {
    return this.prisma.listing.findMany({
      where: {
        status: { in: VISIBLE_IN_FEED },
        ...marketWhere(market),
        ...(category ? { category } : {}),
        ...(viewerId ? { sellerId: { not: viewerId } } : {}),
        ...(await this.notInterested(viewerId)),
      },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        subcategory: true,
        color: true,
        brand: true,
        photos: { orderBy: [{ isCover: 'desc' }, { order: 'asc' }], take: 1, select: { id: true, key: true, provider: true, dhash: true, palette: true } },
      },
      orderBy: [{ liftedAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: category ? 400 : 600,
    });
  }

  /**
   * The listing behind «Похожие» / related blocks, under the item page's own rule (see get()): drafts, hidden and
   * blocked items are their owner's only; to anyone else their title and content don't exist.
   */
  private async publicListing(id: string, viewerId?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listing.sellerId !== viewerId && !PUBLIC_STATUSES.includes(listing.status)) throw new NotFoundException({ message: 'Такой вещи нет' });
    return listing;
  }

  async similar(id: string, offset: number, limit: number, viewerId?: string) {
    const listing = await this.publicListing(id, viewerId);
    const ranked = await this.rankSimilar(listing, viewerId);
    return {
      source: { id: listing.id, title: listing.title },
      items: await this.cards(ranked.slice(offset, offset + limit), viewerId),
      total: ranked.length,
    };
  }

  async related(id: string, viewerId?: string) {
    const listing = await this.publicListing(id, viewerId);
    const base = { status: { in: VISIBLE_IN_FEED }, id: { not: id } };

    const [ranked, fromSeller] = await Promise.all([
      this.rankSimilar(listing, viewerId, 120),
      this.prisma.listing.findMany({ where: { ...base, sellerId: listing.sellerId }, include: cardInclude, orderBy: { publishedAt: 'desc' }, take: 8 }),
    ]);
    const similar = ranked.slice(0, 8);

    let forYou: Awaited<ReturnType<ListingsService['cards']>> = [];
    if (viewerId && (await this.recs.hasProfile(viewerId))) {
      const exclude = new Set([id, ...similar.map((s) => s.id), ...fromSeller.map((s) => s.id)]);
      forYou = (await this.feed('for_you', 0, 16, viewerId, marketOf(listing))).items.filter((c) => !exclude.has(c.id)).slice(0, 8);
    }
    return {
      similar: await this.cards(similar, viewerId),
      fromSeller: await this.cards(fromSeller, viewerId),
      forYou,
    };
  }

  // ---------- read: discovery ----------

  /** Items the viewer marked «Не интересно»: left out of their feeds and search. */
  private async notInterested(viewerId?: string): Promise<Prisma.ListingWhereInput> {
    const ids = await this.notInterestedIds(viewerId);
    return ids.length ? { id: { notIn: ids } } : {};
  }

  /** The 500 latest «Не интересно» marks: older ones have mostly sold anyway, and the list goes into every query. */
  private async notInterestedIds(viewerId?: string): Promise<string[]> {
    if (!viewerId) return [];
    const rows = await this.prisma.signal.findMany({
      where: { userId: viewerId, type: 'not_interested', listingId: { not: null } },
      select: { listingId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => r.listingId!);
  }

  async setNotInterested(userId: string, listingId: string, on: boolean) {
    await this.prisma.signal.deleteMany({ where: { userId, listingId, type: 'not_interested' } });
    if (on) await this.recs.record(userId, 'not_interested', listingId);
    return { ok: true };
  }

  async feed(chip: string, offset: number, limit: number, viewerId?: string, market?: Market) {
    // Guests have no «Для вас»: they get «Новое». A signed-in person without a profile yet sees the popular items.
    const effective = chip === 'for_you' && !viewerId ? 'new' : chip;
    const notInterested = await this.notInterestedIds(viewerId);
    const where: Prisma.ListingWhereInput = { status: { in: VISIBLE_IN_FEED }, ...marketWhere(market), ...(notInterested.length ? { id: { notIn: notInterested } } : {}) };

    if (effective === 'for_you' || effective === 'popular') {
      // The 1000 latest items are the same for everyone for a minute: loaded once, then each viewer's own items and
      // «Не интересно» are taken out (frame 06: own items are excluded from personalised and popular feeds).
      const shared = await this.cache.get(`pool:${market ?? 'brands'}`, 60_000, () =>
        this.prisma.listing.findMany({ where: { status: 'PUBLISHED', ...marketWhere(market) }, select: RANK_SELECT, orderBy: { publishedAt: 'desc' }, take: CANDIDATE_POOL }),
      );
      const hidden = new Set(notInterested);
      const pool = shared.filter((p) => p.sellerId !== viewerId && !hidden.has(p.id));
      const ids = effective === 'for_you' && (await this.recs.hasProfile(viewerId!)) ? await this.recs.rankForUser(viewerId!, pool) : await this.recs.rankPopular(pool);
      return { chip: effective, items: await this.cardsByIds(ids.slice(offset, offset + limit), viewerId), total: ids.length };
    }

    if (effective === 'auctions') {
      const auctionWhere: Prisma.ListingWhereInput = { status: 'PUBLISHED', ...marketWhere(market), auctions: { some: { status: 'ACTIVE' } } };
      const [rows, total] = await Promise.all([
        this.prisma.auction.findMany({
          where: { status: 'ACTIVE', listing: { status: 'PUBLISHED', ...marketWhere(market) } },
          orderBy: { endsAt: 'asc' },
          skip: offset,
          take: limit,
          select: { listingId: true },
        }),
        this.prisma.listing.count({ where: auctionWhere }),
      ]);
      return { chip: effective, items: await this.cardsByIds(rows.map((r) => r.listingId), viewerId), total };
    }
    if (effective === 'under_50') where.price = { lte: 50 };
    if (['clothing', 'shoes', 'accessories', 'bags'].includes(effective)) {
      where.category = { in: categoriesInGroup(effective as 'clothing') };
    }
    // Newest first, but no two of a kind side by side.
    const [pool, total] = await Promise.all([
      this.prisma.listing.findMany({ where, select: RANK_SELECT, orderBy: [{ liftedAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }], take: CANDIDATE_POOL }),
      this.prisma.listing.count({ where }),
    ]);
    const ids = spread(pool).map((p) => p.id);
    return { chip: effective, items: await this.cardsByIds(ids.slice(offset, offset + limit), viewerId), total: Math.min(total, ids.length) };
  }

  /**
   * Data for the home page, the brands' showcase: the feed above is market=brands, under it the brands themselves and
   * the categories. The second-hand market lives on its own page (/resale) and isn't mixed in here.
   */
  async home(viewerId?: string) {
    // Counts and category tiles are the same for everyone: computed at most every two minutes. The brands block is
    // too for guests; a signed-in viewer gets their own (their brand left out, «Вы подписаны»).
    const [shared, brands] = await Promise.all([
      this.cache.get('home', 120_000, () => this.homeShared()),
      viewerId ? this.topWardrobes(viewerId, 'brands') : this.cache.get('home:brands', 120_000, () => this.topWardrobes(undefined, 'brands')),
    ]);
    return { totalVisible: shared.totalVisible, brandsVisible: shared.brandsVisible, brands, categories: shared.categories, forYouAvailable: !!viewerId };
  }

  private async homeShared() {
    const [totalVisible, brandsVisible, categoryCounts] = await Promise.all([
      this.prisma.listing.count({ where: { status: { in: VISIBLE_IN_FEED } } }),
      this.prisma.listing.count({ where: { status: { in: VISIBLE_IN_FEED }, ...marketWhere('brands') } }),
      this.prisma.listing.groupBy({ by: ['category'], where: { status: 'PUBLISHED', ...marketWhere('brands') }, _count: true }),
    ]);

    const categories = await Promise.all(
      categoryCounts
        .filter((c) => c.category)
        .sort((a, b) => b._count - a._count)
        .slice(0, 8)
        .map(async (c) => {
          // The tile is 4:5 and its photo fills it edge to edge: among the category's popular items, the cover whose
          // proportions are closest to the tile's (the least cropped); popularity breaks ties.
          const popular = await this.prisma.listing.findMany({ where: { status: 'PUBLISHED', category: c.category, ...marketWhere('brands') }, include: cardInclude, orderBy: { favoritesCount: 'desc' }, take: 30 });
          const misfit = (l: CardListing) => (l.photos[0] ? Math.abs(Math.log(l.photos[0].width / l.photos[0].height / TILE_RATIO)) : Infinity);
          const sample = popular.reduce<CardListing | null>((best, l) => (!best || misfit(l) < misfit(best) - 0.02 ? l : best), null);
          return { slug: c.category!, label: categoryBySlug(c.category)?.label ?? c.category!, count: c._count, cover: sample ? serializeCard(sample).cover : null };
        }),
    );

    return { totalVisible, brandsVisible, categories };
  }

  /** Wardrobe cards (summary + collage) for these sellers, in this order; summaries are one batch. */
  private async wardrobeCards(sellerIds: string[], viewerId?: string) {
    const [summaries, collages] = await Promise.all([this.sellerSummaries(sellerIds, viewerId), Promise.all(sellerIds.map((id) => this.collage(id)))]);
    return sellerIds.flatMap((id, i) => {
      const s = summaries.get(id);
      return s ? [{ ...s, collage: collages[i] }] : [];
    });
  }

  /** The sellers with the most on sale, each with a collage of their latest items (home: the brands). */
  private async topWardrobes(viewerId: string | undefined, market: Market) {
    const top = await this.prisma.listing.groupBy({
      by: ['sellerId'],
      where: {
        status: 'PUBLISHED',
        sellerId: viewerId ? { not: viewerId } : undefined,
        ...marketWhere(market),
        // The brands' block shows brands: a reseller whose single item an admin let into the catalogue isn't one.
        ...(market === 'brands' ? { seller: { brandVerifiedAt: { not: null } } } : {}),
      },
      _count: true,
      orderBy: { _count: { sellerId: 'desc' } },
      take: 6,
    });
    return this.wardrobeCards(
      top.map((t) => t.sellerId),
      viewerId,
    );
  }

  /** «Гардеробы»: other people's wardrobes with something on sale, the most recently active first. */
  async wardrobes(offset: number, limit: number, q: string | undefined, viewerId?: string) {
    const where: Prisma.ListingWhereInput = {
      status: 'PUBLISHED',
      // Wardrobes are the second-hand market's people; brands stand on the home page.
      ...marketWhere('resale'),
      seller: { brandVerifiedAt: null },
      ...(viewerId ? { sellerId: { not: viewerId } } : {}),
      ...(q?.trim() ? { seller: { brandVerifiedAt: null, username: { contains: q.trim().replace(/^@/, '').toLowerCase() } } } : {}),
    };
    const all = await this.prisma.listing.groupBy({ by: ['sellerId'], where, _max: { publishedAt: true }, orderBy: { _max: { publishedAt: 'desc' } } });
    // Each wardrobe is a collage and a summary: a page is capped whatever `limit` asks for.
    const page = all.slice(offset, offset + Math.min(limit, WARDROBES_MAX));
    const items = await this.wardrobeCards(
      page.map((t) => t.sellerId),
      viewerId,
    );
    return { items, total: all.length };
  }

  async search(q: SearchQueryT, viewerId?: string) {
    // "Мой размер": the sizes the buyer saved in the profile.
    if (q.my_size === '1' && viewerId) {
      const me = await this.prisma.user.findUnique({ where: { id: viewerId }, select: { sizes: true } });
      const s = (me?.sizes ?? {}) as PreferredSizes;
      const mine = [...(s.clothing ?? []), ...(s.shoes ?? []), ...(s.jeans ?? [])];
      if (mine.length) q = { ...q, size: [...new Set([...(q.size ?? []), ...mine])] };
    }
    const where: Prisma.ListingWhereInput = { AND: [this.searchWhere(q), marketWhere(q.market), await this.notInterested(viewerId)] };
    let items;
    let total: number;
    if (q.sort === 'similar' && q.ids) {
      // A search by photo: the items keep the order the photo ranked them in, whatever narrowed them.
      const found = new Set((await this.prisma.listing.findMany({ where, select: { id: true } })).map((r) => r.id));
      const ids = q.ids.filter((id) => found.has(id));
      total = ids.length;
      items = await this.cardsByIds(ids.slice(q.offset, q.offset + q.limit), viewerId);
    } else if (q.sort === 'for_you' && viewerId) {
      const pool = await this.prisma.listing.findMany({
        where,
        select: RANK_SELECT,
        orderBy: { publishedAt: 'desc' },
        take: CANDIDATE_POOL,
      });
      const ids = await this.recs.rankForUser(viewerId, pool);
      total = ids.length;
      items = await this.cardsByIds(ids.slice(q.offset, q.offset + q.limit), viewerId);
    } else {
      const orderBy: Prisma.ListingOrderByWithRelationInput[] =
        q.sort === 'cheap'
          ? [{ price: { sort: 'asc', nulls: 'last' } }]
          : q.sort === 'expensive'
            ? [{ price: { sort: 'desc', nulls: 'last' } }]
            : q.sort === 'popular'
              ? [{ favoritesCount: 'desc' }, { viewsCount: 'desc' }]
              : [{ liftedAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }];
      const [rows, count] = await Promise.all([
        this.prisma.listing.findMany({ where, include: cardInclude, orderBy, skip: q.offset, take: q.limit }),
        this.prisma.listing.count({ where }),
      ]);
      items = await this.cards(rows, viewerId);
      total = count;
    }

    // What the person searches for shapes «Для вас» (the first page only, so scrolling doesn't count twice).
    if (viewerId && q.offset === 0 && !q.ids) {
      const meta = { category: q.category, brand: q.brand, style: q.style, size: q.size, color: q.color };
      const traits = Object.values(meta).some((v) => v?.length);
      if (q.q?.trim() || traits) await this.recs.record(viewerId, q.q?.trim() ? 'search' : 'filter', undefined, meta);
    }

    // Empty-state hint (frame 07): "без фильтра «M» — 23 вещи".
    let relax: { filter: string; label: string; count: number } | null = null;
    if (total === 0) {
      const hasFilters = !!(q.category?.length || q.subcategory?.length || q.style?.length || q.size?.length || q.color?.length || q.brand?.length || q.price_max != null || q.condition?.length);
      const candidates: Array<[keyof SearchQueryT, string]> = [
        // After a natural-language search the leftover words are the most likely culprit.
        ...(q.q && hasFilters ? ([['q', `слов «${q.q}»`]] as Array<[keyof SearchQueryT, string]>) : []),
        ['style', `стиля «${q.style?.join(', ')}»`],
        ['subcategory', 'подкатегории'],
        ['size', `«${q.size?.join(', ')}»`],
        ['condition', 'по состоянию'],
        ['color', 'по цвету'],
        ['brand', `«${q.brand?.join(', ')}»`],
        ['price_max', 'по цене'],
        ['city', `«${q.city}»`],
      ];
      // At most three extra counts: an empty result page shouldn't cost ten full scans.
      let tries = 0;
      for (const [key, label] of candidates) {
        const value = q[key];
        if (value == null || (Array.isArray(value) && !value.length)) continue;
        if (++tries > 3) break;
        const count = await this.prisma.listing.count({ where: { AND: [this.searchWhere({ ...q, [key]: undefined, ...(key === 'price_max' ? { price_min: undefined } : {}) }), marketWhere(q.market)] } });
        if (count > 0) {
          relax = { filter: key, label, count };
          break;
        }
      }
    }
    return { items, total, relax };
  }

  private searchWhere(q: SearchQueryT): Prisma.ListingWhereInput {
    const and: Prisma.ListingWhereInput[] = [];
    if (q.ids) and.push({ id: { in: q.ids } });
    if (q.q) {
      for (const token of q.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
        // Crude Russian stemming: match on the word without its last 1–2 letters ("куртки" → "курт").
        const stem = token.length > 5 ? token.slice(0, -2) : token.length > 3 ? token.slice(0, -1) : token;
        const catMatches = CATEGORIES.filter((c) => c.label.toLowerCase().includes(stem) || c.slug.includes(token)).map((c) => c.slug);
        const subMatches = CATEGORIES.flatMap((c) => c.subcategories.filter((s) => s.label.toLowerCase().includes(stem)).map((s) => s.slug));
        and.push({
          OR: [
            { title: { contains: stem, mode: 'insensitive' } },
            { brand: { contains: stem, mode: 'insensitive' } },
            { description: { contains: stem, mode: 'insensitive' } },
            ...(catMatches.length ? [{ category: { in: catMatches } }] : []),
            ...(subMatches.length ? [{ subcategory: { in: subMatches } }] : []),
          ],
        });
      }
    }
    if (q.category?.length) and.push({ category: { in: q.category } });
    if (q.subcategory?.length) and.push({ subcategory: { in: q.subcategory } });
    if (q.style?.length) and.push({ styleTags: { hasSome: q.style } });
    if (q.gender?.length) {
      // A gender that wasn't chosen means "fits anyone": such items show up for women and for men,
      // except skirts and dresses for men.
      const g = q.gender.filter((x): x is 'MALE' | 'FEMALE' => x === 'MALE' || x === 'FEMALE');
      const womenOnly = g.length === 1 && g[0] === 'MALE' ? CATEGORIES.filter((c) => c.genders && !c.genders.includes('MALE')).map((c) => c.slug) : [];
      const neutral = { OR: [{ gender: null }, { gender: 'UNISEX' as const }], ...(womenOnly.length ? { category: { notIn: womenOnly } } : {}) };
      if (g.length) and.push({ OR: [{ gender: { in: g } }, neutral] });
    }
    if (q.size?.length) and.push({ OR: [{ sizeValue: { in: q.size } }, { sizes: { hasSome: q.size } }] });
    if (q.condition?.length) and.push({ condition: { in: q.condition as ('GOOD' | 'LIKE_NEW')[] } });
    if (q.color?.length) and.push({ color: { in: q.color } });
    if (q.brand?.length) and.push({ OR: q.brand.map((b) => ({ brand: { equals: canonicalBrand(b) ?? b, mode: 'insensitive' as const } })) });
    if (q.city) and.push({ city: q.city });
    if (q.seller) and.push({ seller: { username: q.seller.replace(/^@/, '').toLowerCase() } });
    if (q.price_min != null || q.price_max != null) and.push({ price: { gte: q.price_min, lte: q.price_max } });
    return { status: q.available === '1' ? 'PUBLISHED' : { in: VISIBLE_IN_FEED }, AND: and };
  }

  /** Crawlers fetch it often and it is 45 000 rows: rebuilt at most every five minutes. */
  sitemap() {
    return this.cache.get('sitemap', 300_000, () => this.buildSitemap());
  }

  private async buildSitemap() {
    const [listings, sellers] = await Promise.all([
      this.prisma.listing.findMany({ where: { status: { in: ['PUBLISHED', 'RESERVED'] } }, select: { id: true, updatedAt: true }, orderBy: { liftedAt: 'desc' }, take: 45_000 }),
      this.prisma.listing.groupBy({ by: ['sellerId'], where: { status: 'PUBLISHED' }, _max: { updatedAt: true } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: sellers.map((s) => s.sellerId) }, blockedAt: null }, select: { id: true, username: true } });
    const last = new Map(sellers.map((s) => [s.sellerId, s._max.updatedAt]));
    return {
      listings: listings.map((l) => ({ id: l.id, updatedAt: l.updatedAt })),
      wardrobes: users.map((u) => ({ username: u.username, updatedAt: last.get(u.id) })),
    };
  }

  // ---------- wardrobe ----------

  /**
   * A wardrobe page: counts per section, and one section's items, WARDROBE_PAGE at a time (`offset`, `hasMore`), so a
   * big shop's wardrobe isn't loaded whole on every visit. Visitors see sold items after everything else.
   */
  async wardrobe(username: string, viewerId: string | undefined, section: string, sort: string, offset = 0) {
    const user = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!user) throw new NotFoundException({ message: 'Такого гардероба нет' });
    const isOwner = viewerId === user.id;

    // Visitors see PUBLISHED, RESERVED and SOLD; the owner also sees hidden and blocked items, and drafts apart.
    const statuses: ListingStatus[] = isOwner ? ['PUBLISHED', 'RESERVED', 'SOLD', 'HIDDEN', 'BLOCKED'] : ['PUBLISHED', 'RESERVED', 'SOLD'];
    const base: Prisma.ListingWhereInput = { sellerId: user.id, status: { in: statuses } };
    const freshSince = new Date(Date.now() - 14 * DAY_MS);
    const sectionWhere: Prisma.ListingWhereInput =
      section === 'all'
        ? {}
        : section === 'new'
          ? { publishedAt: { gte: freshSince } }
          : section === 'selling'
            ? { status: 'PUBLISHED' }
            : section === 'sold'
              ? { status: 'SOLD' }
              : { category: { in: categoriesInSection(section as WardrobeSection) } };
    const orderBy: Prisma.ListingOrderByWithRelationInput =
      sort === 'old' ? { createdAt: 'asc' } : sort === 'cheap' ? { price: 'asc' } : sort === 'expensive' ? { price: 'desc' } : { createdAt: 'desc' };

    const [byCategory, fresh, rows, draftRows, seller] = await Promise.all([
      this.prisma.listing.groupBy({ by: ['category', 'status'], where: base, _count: { _all: true } }),
      this.prisma.listing.count({ where: { ...base, publishedAt: { gte: freshSince } } }),
      this.wardrobePage({ AND: [base, sectionWhere] }, orderBy, offset, isOwner),
      isOwner && section === 'all'
        ? this.prisma.listing.findMany({ where: { sellerId: user.id, status: 'DRAFT' }, include: cardInclude, orderBy, take: WARDROBE_PAGE })
        : Promise.resolve([] as CardListing[]),
      this.sellerSummary(user.id, viewerId),
    ]);

    const counts = { all: 0, top: 0, bottom: 0, shoes: 0, accessories: 0, new: fresh, selling: 0, sold: 0 };
    for (const g of byCategory) {
      const n = g._count._all;
      counts.all += n;
      counts[categoryBySlug(g.category)?.section ?? 'accessories'] += n;
      if (g.status === 'PUBLISHED') counts.selling += n;
      if (g.status === 'SOLD') counts.sold += n;
    }

    const hasMore = rows.length > WARDROBE_PAGE;
    const page = rows.slice(0, WARDROBE_PAGE);
    const cards = await this.cards(page, viewerId);
    // The default order mixes kinds (no two of a kind side by side); an explicit sort is kept as asked.
    // For visitors sold items stay last (frame 09): the page is already ordered that way, so each part is mixed apart.
    const mix = (part: typeof cards) => {
      if (sort !== 'new') return part;
      const byId = new Map(page.map((l) => [l.id, l]));
      return spread(part.map((c) => ({ c, category: c.category, subcategory: byId.get(c.id)?.subcategory ?? null, sellerId: user.id }))).map((x) => x.c);
    };
    const ordered = isOwner ? mix(cards) : [...mix(cards.filter((c) => c.status !== 'SOLD')), ...mix(cards.filter((c) => c.status === 'SOLD'))];
    const groups = (['top', 'bottom', 'shoes', 'accessories'] as const)
      .map((s) => ({ section: s, items: ordered.filter((c) => (categoryBySlug(c.category)?.section ?? 'accessories') === s) }))
      .filter((g) => g.items.length);

    return {
      seller,
      isOwner,
      counts,
      groups,
      drafts: isOwner ? mix(await this.cards(draftRows, viewerId)) : [],
      offset,
      /** More of this section past this page: ask again with `offset` + 200. */
      hasMore,
      nextOffset: hasMore ? offset + WARDROBE_PAGE : null,
    };
  }

  /**
   * WARDROBE_PAGE + 1 items of a wardrobe from `offset` (the extra one tells there is more). For visitors the unsold
   * items come first and sold ones after, paged as one list.
   */
  private async wardrobePage(where: Prisma.ListingWhereInput, orderBy: Prisma.ListingOrderByWithRelationInput, offset: number, isOwner: boolean): Promise<CardListing[]> {
    const take = WARDROBE_PAGE + 1;
    if (isOwner) return this.prisma.listing.findMany({ where, include: cardInclude, orderBy, skip: offset, take });
    const unsold: Prisma.ListingWhereInput = { AND: [where, { status: { not: 'SOLD' } }] };
    const sold: Prisma.ListingWhereInput = { AND: [where, { status: 'SOLD' }] };
    const unsoldCount = await this.prisma.listing.count({ where: unsold });
    const first = offset < unsoldCount ? await this.prisma.listing.findMany({ where: unsold, include: cardInclude, orderBy, skip: offset, take }) : [];
    if (first.length >= take) return first;
    const rest = await this.prisma.listing.findMany({ where: sold, include: cardInclude, orderBy, skip: Math.max(0, offset - unsoldCount), take: take - first.length });
    return [...first, ...rest];
  }
}
