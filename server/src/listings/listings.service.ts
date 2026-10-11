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
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { AUCTION_DURATIONS, auctionInclude, defaultStep, serializeAuction } from '../auctions/rules.js';
import { ListingModerator, ModerationVerdict } from '../ai/moderation.js';
import { nextBumpAt, StatsService } from '../stats/stats.js';
import { canonicalBrand } from '../catalog/brands.js';
import { tiersOf } from './bundle.js';
import { BodyMeasurements, fitHint, PreferredSizes } from './fit.js';
import { hashDistance, MediaService, serializeVideo } from '../media/media.service.js';
import { cardInclude, CardListing, serializeCard, serializePhoto } from './listing.serializer.js';
import type { ListingInputT, SearchQueryT } from './listings.dto.js';

const VISIBLE_IN_FEED: ListingStatus[] = ['PUBLISHED', 'RESERVED'];
const ACTIVE_REQUEST_STATUSES = ['PENDING_SELLER', 'ACCEPTED', 'WAITING_PAYMENT', 'WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED'] as const;
/** Fields frozen while a deal is in progress (frame 10 EDIT ITEM). */
const LOCKED_WHEN_RESERVED = ['price', 'sizeValue', 'sizeSystem', 'condition', 'defectsPresent', 'defectsDescription'] as const;
const CANDIDATE_POOL = 1000;
/** Edits of these on a live listing are moderated again. */
const MODERATED_FIELDS = ['title', 'description', 'brand', 'defectsDescription', 'category', 'subcategory'] as const;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly notifications: NotificationsService,
    private readonly moderator: ListingModerator,
    private readonly stats: StatsService,
    private readonly media: MediaService,
  ) {}

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
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { city: true } });
    const listing = await this.prisma.listing.create({
      data: { sellerId: userId, city: me?.city ?? null, deliveryOptions: ['IN_PERSON'], ...this.toData(input) },
    });
    if (input.photos) await this.attachPhotos(userId, listing.id, input.photos);
    if (input.videoId !== undefined) await this.attachVideo(userId, listing.id, input.videoId);
    return this.getForOwner(userId, listing.id);
  }

  async update(userId: string, id: string, input: ListingInputT) {
    const listing = await this.ownListing(userId, id);
    if (listing.status === 'BLOCKED') throw new ForbiddenException({ message: 'Вещь заблокирована модератором' });
    const data = this.toData(input);

    const runningAuction = await this.prisma.auction.findFirst({ where: { listingId: id, status: 'ACTIVE' } });
    if (runningAuction) {
      const frozen = (['price', 'saleType', 'auctionStep', 'auctionReserve', 'auctionHours', 'auctionBuyNow'] as const).filter((f) => f in data && data[f] !== listing[f]);
      if (frozen.length) throw new ConflictException({ message: 'Идёт аукцион — цену и условия торгов менять нельзя' });
    }
    if (listing.status === 'RESERVED') {
      const changed = LOCKED_WHEN_RESERVED.filter((f) => f in data && data[f] !== listing[f]);
      if (changed.length) throw new ConflictException({ message: 'Идёт сделка — цену, размер, состояние и дефекты менять нельзя' });
    }

    const priceDropped = listing.status === 'PUBLISHED' && data.price != null && listing.price != null && data.price < listing.price;
    if (priceDropped) data.previousPrice = listing.price;

    // Live listings are moderated again when their text, category or photos change; a rejected edit isn't saved.
    let verdict: ModerationVerdict | null = null;
    const live = listing.status === 'PUBLISHED' || listing.status === 'RESERVED';
    const prospective = { ...listing, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) } as typeof listing;
    if (live && (MODERATED_FIELDS.some((f) => f in data && data[f] !== listing[f]) || input.photos || input.videoId)) {
      verdict = await this.moderator.check(prospective, await this.moderationKeys(userId, id, input.photos, input.videoId));
      if (verdict.decision === 'reject') throw new BadRequestException({ message: 'Изменения не прошли проверку', code: 'MODERATION', fields: verdict.fields });
    }

    await this.prisma.listing.update({ where: { id }, data });
    if (input.photos) await this.attachPhotos(userId, id, input.photos);
    if (input.videoId !== undefined) await this.attachVideo(userId, id, input.videoId);
    if (verdict) await this.moderator.record(prospective, verdict);

    if (priceDropped) {
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
    if (input.brand !== undefined) data.brand = canonicalBrand(input.brand);
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

  /** Images moderation looks at: the photos plus the video's poster frame (stored like a photo). */
  private async moderationKeys(userId: string, listingId: string, photos?: { id: string }[], videoId?: string | null) {
    const keys = await this.photoKeys(userId, listingId, photos);
    const video =
      videoId === undefined
        ? await this.prisma.video.findUnique({ where: { listingId }, select: { key: true } })
        : videoId
          ? await this.prisma.video.findFirst({ where: { id: videoId, ownerId: userId }, select: { key: true } })
          : null;
    return video ? [...keys, video.key] : keys;
  }

  /** Missing or inconsistent fields that block publication, as field errors. */
  private publishErrors(listing: Listing, photoCount: number) {
    const fields: Record<string, string> = {};
    if (!photoCount) fields.photos = 'Добавьте хотя бы одно фото';
    if (!listing.title.trim()) fields.title = 'Укажите название';
    if (!listing.category) fields.category = 'Выберите категорию';
    if (sizeRequired(listing.category) && !listing.sizeValue) fields.size = 'Укажите размер';
    if (!listing.condition) fields.condition = 'Выберите состояние';
    if (listing.defectsPresent == null) fields.defects = 'Укажите, есть ли дефекты';
    if (listing.defectsPresent && !listing.defectsDescription?.trim()) fields.defectsDescription = 'Опишите дефекты';
    if (!listing.price) fields.price = 'Укажите цену';
    if (!listing.deliveryOptions.length) fields.deliveryOptions = 'Выберите способ передачи';
    if (listing.originalPrice != null && listing.price != null && listing.originalPrice <= listing.price) fields.originalPrice = 'Цена в магазине должна быть выше вашей';
    if (listing.saleType === 'AUCTION') {
      if (!AUCTION_DURATIONS.includes(listing.auctionHours ?? 0)) fields.auctionHours = 'Выберите длительность аукциона';
      if (listing.auctionReserve != null && listing.price != null && listing.auctionReserve < listing.price) fields.auctionReserve = 'Резерв не может быть ниже стартовой цены';
      if (listing.auctionBuyNow != null && listing.price != null && listing.auctionBuyNow <= listing.price) fields.auctionBuyNow = 'Цена «Купить сейчас» должна быть выше стартовой';
      else if (listing.auctionBuyNow != null && listing.auctionReserve != null && listing.auctionBuyNow < listing.auctionReserve) fields.auctionBuyNow = 'Цена «Купить сейчас» не может быть ниже резерва';
      if (listing.extraSizes.length) fields.extraSizes = 'Несколько размеров можно выставить только с фиксированной ценой';
    } else if (listing.acceptsOffers && listing.autoAcceptPrice != null && listing.price != null) {
      if (listing.autoAcceptPrice >= listing.price) fields.autoAcceptPrice = 'Должно быть ниже цены — по цене покупают без торга';
      else if (listing.minOfferPrice != null && listing.autoAcceptPrice <= listing.minOfferPrice) fields.autoAcceptPrice = 'Должно быть выше порога автоотказа';
    }
    return fields;
  }

  /**
   * "Несколько размеров" (Avito multi-listing): every extra size becomes its own listing with the same
   * photos, text and price, linked by groupId, so buying, deals and reviews stay one item = one listing.
   */
  private async publishSizeCopies(listing: Listing, verdict: ModerationVerdict) {
    const sizes = [...new Set(listing.extraSizes.map((s) => s.trim()).filter((s) => s && s !== listing.sizeValue))].slice(0, 10);
    if (!sizes.length) return;
    const groupId = listing.groupId ?? listing.id;
    const [photos, video] = await Promise.all([
      this.prisma.photo.findMany({ where: { listingId: listing.id }, orderBy: { order: 'asc' } }),
      this.prisma.video.findUnique({ where: { listingId: listing.id } }),
    ]);
    const now = new Date();
    for (const size of sizes) {
      const copy = await this.prisma.listing.create({
        data: {
          sellerId: listing.sellerId,
          status: 'PUBLISHED',
          groupId,
          title: listing.title,
          category: listing.category,
          subcategory: listing.subcategory,
          sizeSystem: listing.sizeSystem,
          sizeValue: size,
          condition: listing.condition,
          price: listing.price,
          originalPrice: listing.originalPrice,
          defectsPresent: listing.defectsPresent,
          defectsDescription: listing.defectsDescription,
          brand: listing.brand,
          color: listing.color,
          material: listing.material,
          description: listing.description,
          city: listing.city,
          deliveryOptions: listing.deliveryOptions,
          acceptsOffers: listing.acceptsOffers,
          minOfferPrice: listing.minOfferPrice,
          autoAcceptPrice: listing.autoAcceptPrice,
          gender: listing.gender,
          styleTags: listing.styleTags,
          aiAttributes: listing.aiAttributes ?? undefined,
          aiModelVersion: listing.aiModelVersion,
          publishedAt: now,
          liftedAt: now,
        },
      });
      // Storage files are shared: rows point at the same keys, nothing is copied.
      await this.prisma.photo.createMany({
        data: photos.map((p) => ({ ownerId: p.ownerId, listingId: copy.id, provider: p.provider, key: p.key, url: p.url, version: p.version, format: p.format, bytes: p.bytes, width: p.width, height: p.height, order: p.order, isCover: p.isCover, isDefect: p.isDefect, quality: p.quality ?? undefined })),
      });
      if (video) {
        await this.prisma.video.create({ data: { ownerId: video.ownerId, listingId: copy.id, key: video.key, ext: video.ext, mime: video.mime, width: video.width, height: video.height, durationMs: video.durationMs } });
      }
      await this.moderator.record(copy, verdict);
    }
    await this.prisma.listing.update({ where: { id: listing.id }, data: { groupId, extraSizes: [] } });
  }

  // ---------- lifecycle ----------

  async publish(userId: string, id: string) {
    const listing = await this.ownListing(userId, id);
    if (listing.status === 'PUBLISHED') return this.getForOwner(userId, id);
    if (!['DRAFT', 'HIDDEN'].includes(listing.status)) throw new ConflictException({ message: 'Эту вещь нельзя опубликовать' });

    const verdict = await this.checkPublishable(userId, listing);
    await this.prisma.listing.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: listing.publishedAt ?? new Date(), liftedAt: listing.liftedAt ?? new Date(), scheduledAt: null },
    });
    await this.moderator.record(listing, verdict);
    if (listing.saleType === 'FIXED') await this.publishSizeCopies(listing, verdict);
    // Auction clock starts at publication (decision D16).
    if (listing.saleType === 'AUCTION' && !(await this.prisma.auction.findFirst({ where: { listingId: id, status: 'ACTIVE' } }))) {
      await this.prisma.auction.create({
        data: {
          listingId: id,
          startPrice: listing.price!,
          step: listing.auctionStep ?? defaultStep(listing.price!),
          reservePrice: listing.auctionReserve,
          buyNowPrice: listing.auctionBuyNow,
          endsAt: new Date(Date.now() + listing.auctionHours! * 3600 * 1000),
        },
      });
    }
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
  private async checkPublishable(userId: string, listing: Listing) {
    const keys = await this.moderationKeys(userId, listing.id);
    const photoCount = await this.prisma.photo.count({ where: { listingId: listing.id } });
    const fields = this.publishErrors(listing, photoCount);
    if (Object.keys(fields).length) throw new BadRequestException({ message: 'Заполните обязательные поля', fields });
    const duplicate = await this.findDuplicate(listing);
    if (duplicate) {
      throw new BadRequestException({
        message: 'У вас уже есть такое объявление',
        code: 'DUPLICATE',
        duplicateOf: duplicate.id,
        fields: { [duplicate.by === 'photo' ? 'photos' : 'title']: `Похоже на вашу вещь «${duplicate.title}». Поднимите или отредактируйте её вместо нового объявления` },
      });
    }
    const verdict = await this.moderator.check(listing, keys);
    if (verdict.decision === 'reject') throw new BadRequestException({ message: 'Объявление не прошло проверку', code: 'MODERATION', fields: verdict.fields });
    return verdict;
  }

  /**
   * One item = one listing (as on Avito): a seller can't publish the same thing twice to take more space in
   * feeds. A duplicate is one of their live or scheduled listings with a near-identical photo, or with the same
   * title, category and size. Copies in other sizes (same groupId) are the same item on purpose.
   */
  private async findDuplicate(listing: Listing): Promise<{ id: string; title: string; by: 'photo' | 'text' } | null> {
    const others = await this.prisma.listing.findMany({
      where: {
        sellerId: listing.sellerId,
        id: { not: listing.id },
        OR: [{ status: { in: ['PUBLISHED', 'RESERVED'] } }, { status: 'DRAFT', scheduledAt: { not: null } }],
        ...(listing.groupId ? { NOT: { groupId: listing.groupId } } : {}),
      },
      select: { id: true, title: true, category: true, sizeValue: true, groupId: true, photos: { select: { id: true, key: true, dhash: true } } },
    });
    if (!others.length) return null;
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
    const text = others.find((o) => norm(o.title) === norm(listing.title) && o.category === listing.category && (o.sizeValue ?? '') === (listing.sizeValue ?? ''));
    if (text) return { id: text.id, title: text.title, by: 'text' };

    const mine = await this.prisma.photo.findMany({ where: { listingId: listing.id }, select: { id: true, key: true, dhash: true } });
    const myHashes = (await Promise.all(mine.map((p) => this.media.dhash(p)))).filter((h): h is string => !!h);
    if (!myHashes.length) return null;
    for (const o of others) {
      for (const p of o.photos) {
        const h = await this.media.dhash(p);
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
    const due = await this.prisma.listing.findMany({ where: { status: 'DRAFT', scheduledAt: { lte: new Date() } }, select: { id: true, sellerId: true, title: true }, take: 20 });
    for (const l of due) {
      try {
        await this.publish(l.sellerId, l.id);
        await this.notifications.notify(l.sellerId, 'listing_scheduled_published', { listingId: l.id, title: l.title });
      } catch (e) {
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
    await this.stopAuction(id);
    await this.prisma.listing.update({ where: { id }, data: { status: 'SOLD', soldAt: new Date() } });
    await this.prisma.offer.updateMany({ where: { listingId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await this.declinePendingRequests(id, 'Уже продано');
    await this.notifyWatchers(id, 'item_sold', listing.title);
    return { ok: true };
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

  async getForOwner(userId: string, id: string) {
    return this.get(id, userId, { trackView: false });
  }

  async get(id: string, viewerId?: string, opts: { trackView?: boolean } = {}) {
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
      await this.prisma.listing.update({ where: { id }, data: { viewsCount: { increment: 1 } } });
      this.stats.track(id, 'views');
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
      previousPrice: listing.previousPrice,
      originalPrice: listing.originalPrice,
      category: listing.category,
      categoryLabel: category?.label ?? null,
      subcategory: listing.subcategory,
      subcategoryLabel: category?.subcategories.find((s) => s.slug === listing.subcategory)?.label ?? null,
      sizeSystem: listing.sizeSystem,
      size: listing.sizeValue,
      condition: listing.condition,
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
            extraSizes: listing.extraSizes,
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

  async sellerSummary(sellerId: string, viewerId?: string) {
    const [user, active, sold, followers, following, completedDeals, rating] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: sellerId }, select: { id: true, username: true, city: true, bio: true, createdAt: true, bundleDiscounts: true } }),
      this.prisma.listing.count({ where: { sellerId, status: { in: VISIBLE_IN_FEED } } }),
      this.prisma.listing.count({ where: { sellerId, status: 'SOLD' } }),
      this.prisma.follow.count({ where: { sellerId } }),
      this.prisma.follow.count({ where: { followerId: sellerId } }),
      this.prisma.buyRequest.count({ where: { sellerId, status: 'COMPLETED' } }),
      this.prisma.review.aggregate({ where: { sellerId, hidden: false }, _avg: { rating: true }, _count: true }),
    ]);
    const isFollowing =
      viewerId && viewerId !== sellerId
        ? !!(await this.prisma.follow.findUnique({ where: { followerId_sellerId: { followerId: viewerId, sellerId } } }))
        : false;
    const { bundleDiscounts, ...profile } = user;
    return {
      ...profile,
      activeCount: active,
      soldCount: sold,
      followers,
      following,
      completedDeals,
      isFollowing,
      rating: rating._count ? { avg: Math.round((rating._avg.rating ?? 0) * 10) / 10, count: rating._count } : null,
      bundleDiscounts: tiersOf(bundleDiscounts),
    };
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
        id: { not: listing.id },
        category: listing.category,
        ...(viewerId ? { sellerId: { not: viewerId } } : {}),
        ...(listing.groupId ? { NOT: { groupId: listing.groupId } } : {}),
      },
      include: { ...cardInclude, photos: { orderBy: [{ isCover: 'desc' }, { order: 'asc' }], take: 1 } },
      orderBy: { liftedAt: 'desc' },
      take: pool,
    });
    const coverOf = async (l: { id: string }) => {
      const p = await this.prisma.photo.findFirst({ where: { listingId: l.id }, orderBy: [{ isCover: 'desc' }, { order: 'asc' }], select: { id: true, key: true, dhash: true } });
      return p ? this.media.dhash(p) : null;
    };
    const mine = await coverOf(listing);
    const price = listing.price ?? 0;
    const scored = await Promise.all(
      rows.map(async (l) => {
        let s = 0;
        if (listing.subcategory && l.subcategory === listing.subcategory) s += 3;
        if (listing.brand && l.brand && l.brand.toLowerCase() === listing.brand.toLowerCase()) s += 2;
        if (listing.color && l.color === listing.color) s += 1.5;
        if (listing.gender && (l.gender === listing.gender || l.gender == null || l.gender === 'UNISEX')) s += 0.5;
        if (listing.sizeValue && l.sizeValue === listing.sizeValue) s += 0.5;
        if (price && l.price) s -= Math.min(2, Math.abs(l.price - price) / price) * 1.5;
        const cover = l.photos[0];
        const h = mine && cover ? await this.media.dhash(cover) : null;
        // Photos within ~20 of 64 bits share composition and tones: a weak but useful visual signal.
        if (mine && h) s += Math.max(0, (20 - hashDistance(mine, h)) / 20) * 2;
        return { l, s };
      }),
    );
    return scored.sort((a, b) => b.s - a.s).map((x) => x.l);
  }

  /**
   * Search by photo: what the AI recognised (category, subcategory, brand, colour — confident answers only) plus
   * how close each cover photo looks. The category only weighs in, it doesn't filter: when the AI files the item
   * under a neighbouring category (a backpack as an accessory), a close photo still comes out on top.
   */
  async photoSearch(look: { category?: string | null; subcategory?: string | null; brand?: string | null; color?: string | null }, dhash: string, viewerId?: string) {
    const rows = await this.prisma.listing.findMany({
      where: { status: { in: VISIBLE_IN_FEED }, ...(viewerId ? { sellerId: { not: viewerId } } : {}) },
      include: { ...cardInclude, photos: { orderBy: [{ isCover: 'desc' }, { order: 'asc' }], take: 1 } },
      orderBy: { liftedAt: 'desc' },
      take: 600,
    });
    const scored = await Promise.all(
      rows.map(async (l) => {
        let s = 0;
        if (look.category && l.category === look.category) s += 3;
        if (look.subcategory && l.subcategory === look.subcategory) s += 3;
        if (look.brand && l.brand && l.brand.toLowerCase() === look.brand.toLowerCase()) s += 2;
        if (look.color && l.color === look.color) s += 1.5;
        const cover = l.photos[0];
        const h = cover ? await this.media.dhash(cover) : null;
        if (h) s += Math.max(0, (24 - hashDistance(dhash, h)) / 24) * 5;
        return { l, s };
      }),
    );
    const ranked = scored.sort((a, b) => b.s - a.s).map((x) => x.l);
    return this.cards(ranked.slice(0, 48), viewerId);
  }

  async similar(id: string, offset: number, limit: number, viewerId?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    const ranked = await this.rankSimilar(listing, viewerId);
    return {
      source: { id: listing.id, title: listing.title },
      items: await this.cards(ranked.slice(offset, offset + limit), viewerId),
      total: ranked.length,
    };
  }

  async related(id: string, viewerId?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException({ message: 'Такой вещи нет' });
    const base = { status: { in: VISIBLE_IN_FEED }, id: { not: id } };

    const [ranked, fromSeller] = await Promise.all([
      this.rankSimilar(listing, viewerId, 120),
      this.prisma.listing.findMany({ where: { ...base, sellerId: listing.sellerId }, include: cardInclude, orderBy: { publishedAt: 'desc' }, take: 8 }),
    ]);
    const similar = ranked.slice(0, 8);

    let forYou: Awaited<ReturnType<ListingsService['cards']>> = [];
    if (viewerId && (await this.recs.hasProfile(viewerId))) {
      const exclude = new Set([id, ...similar.map((s) => s.id), ...fromSeller.map((s) => s.id)]);
      forYou = (await this.feed('for_you', 0, 16, viewerId)).items.filter((c) => !exclude.has(c.id)).slice(0, 8);
    }
    return {
      similar: await this.cards(similar, viewerId),
      fromSeller: await this.cards(fromSeller, viewerId),
      forYou,
    };
  }

  // ---------- read: discovery ----------

  async feed(chip: string, offset: number, limit: number, viewerId?: string) {
    const effective = chip === 'for_you' && (!viewerId || !(await this.recs.hasProfile(viewerId))) ? 'new' : chip;
    const where: Prisma.ListingWhereInput = { status: { in: VISIBLE_IN_FEED } };

    if (effective === 'for_you' || effective === 'popular') {
      // Own items are excluded from personalised and popular feeds (frame 06).
      const pool = await this.prisma.listing.findMany({
        where: { ...where, sellerId: viewerId ? { not: viewerId } : undefined, status: 'PUBLISHED' },
        select: { id: true, sellerId: true, category: true, brand: true, color: true, sizeValue: true, price: true, publishedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: CANDIDATE_POOL,
      });
      let ids: string[];
      if (effective === 'for_you') {
        ids = await this.recs.rankForUser(viewerId!, pool);
      } else {
        const pop = await this.recs.popularity(pool.map((p) => p.id));
        ids = [...pool].sort((a, b) => (pop.get(b.id) ?? 0) - (pop.get(a.id) ?? 0)).map((p) => p.id);
      }
      return { chip: effective, items: await this.cardsByIds(ids.slice(offset, offset + limit), viewerId), total: ids.length };
    }

    if (effective === 'auctions') {
      const auctionWhere: Prisma.ListingWhereInput = { status: 'PUBLISHED', auctions: { some: { status: 'ACTIVE' } } };
      const [rows, total] = await Promise.all([
        this.prisma.auction.findMany({
          where: { status: 'ACTIVE', listing: { status: 'PUBLISHED' } },
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
    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({ where, include: cardInclude, orderBy: [{ liftedAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }], skip: offset, take: limit }),
      this.prisma.listing.count({ where }),
    ]);
    return { chip: effective, items: await this.cards(rows, viewerId), total };
  }

  /** Data for the sections under the feed: Новинки, Популярное, Гардеробы, Категории. */
  async home(viewerId?: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [fresh, newToday, popular, totalVisible, categoryCounts, forYouAvailable] = await Promise.all([
      this.feed('new', 0, 16, viewerId),
      this.prisma.listing.count({ where: { status: 'PUBLISHED', publishedAt: { gte: startOfDay } } }),
      this.feed('popular', 0, 16, viewerId),
      this.prisma.listing.count({ where: { status: { in: VISIBLE_IN_FEED } } }),
      this.prisma.listing.groupBy({ by: ['category'], where: { status: 'PUBLISHED' }, _count: true }),
      viewerId ? this.recs.hasProfile(viewerId) : false,
    ]);

    const categories = await Promise.all(
      categoryCounts
        .filter((c) => c.category)
        .sort((a, b) => b._count - a._count)
        .slice(0, 8)
        .map(async (c) => {
          const sample = await this.prisma.listing.findFirst({ where: { status: 'PUBLISHED', category: c.category }, include: cardInclude, orderBy: { favoritesCount: 'desc' } });
          return { slug: c.category!, label: categoryBySlug(c.category)?.label ?? c.category!, count: c._count, cover: sample ? serializeCard(sample).cover : null };
        }),
    );

    return {
      totalVisible,
      newToday,
      fresh: fresh.items,
      popular: popular.items,
      wardrobes: await this.topWardrobes(viewerId),
      categories,
      forYouAvailable,
    };
  }

  private async topWardrobes(viewerId?: string) {
    const top = await this.prisma.listing.groupBy({
      by: ['sellerId'],
      where: { status: 'PUBLISHED', sellerId: viewerId ? { not: viewerId } : undefined },
      _count: true,
      orderBy: { _count: { sellerId: 'desc' } },
      take: 6,
    });
    return Promise.all(
      top.map(async (t) => {
        const [summary, items] = await Promise.all([
          this.sellerSummary(t.sellerId, viewerId),
          this.prisma.listing.findMany({ where: { sellerId: t.sellerId, status: 'PUBLISHED' }, include: cardInclude, orderBy: { publishedAt: 'desc' }, take: 4 }),
        ]);
        return { ...summary, collage: items.map((i) => serializeCard(i).cover) };
      }),
    );
  }

  async search(q: SearchQueryT, viewerId?: string) {
    // "Мой размер": the sizes the buyer saved in the profile.
    if (q.my_size === '1' && viewerId) {
      const me = await this.prisma.user.findUnique({ where: { id: viewerId }, select: { sizes: true } });
      const s = (me?.sizes ?? {}) as PreferredSizes;
      const mine = [...(s.clothing ?? []), ...(s.shoes ?? []), ...(s.jeans ?? [])];
      if (mine.length) q = { ...q, size: [...new Set([...(q.size ?? []), ...mine])] };
    }
    const where = this.searchWhere(q);
    let items;
    let total: number;
    if (q.sort === 'for_you' && viewerId) {
      const pool = await this.prisma.listing.findMany({
        where,
        select: { id: true, sellerId: true, category: true, brand: true, color: true, sizeValue: true, price: true, publishedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: CANDIDATE_POOL,
      });
      const ids = await this.recs.rankForUser(viewerId, pool);
      total = ids.length;
      items = await this.cardsByIds(ids.slice(q.offset, q.offset + q.limit), viewerId);
    } else {
      const orderBy: Prisma.ListingOrderByWithRelationInput[] =
        q.sort === 'cheap'
          ? [{ price: 'asc' }]
          : q.sort === 'expensive'
            ? [{ price: 'desc' }]
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

    if (viewerId && (q.size?.length || q.brand?.length) && q.offset === 0) await this.recs.record(viewerId, 'filter');

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
      for (const [key, label] of candidates) {
        const value = q[key];
        if (value == null || (Array.isArray(value) && !value.length)) continue;
        const count = await this.prisma.listing.count({ where: this.searchWhere({ ...q, [key]: undefined, ...(key === 'price_max' ? { price_min: undefined } : {}) }) });
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
    if (q.size?.length) and.push({ sizeValue: { in: q.size } });
    if (q.condition?.length) and.push({ condition: { in: q.condition as ('GOOD' | 'LIKE_NEW')[] } });
    if (q.color?.length) and.push({ color: { in: q.color } });
    if (q.brand?.length) and.push({ OR: q.brand.map((b) => ({ brand: { equals: canonicalBrand(b) ?? b, mode: 'insensitive' as const } })) });
    if (q.city) and.push({ city: q.city });
    if (q.seller) and.push({ seller: { username: q.seller.replace(/^@/, '').toLowerCase() } });
    if (q.price_min != null || q.price_max != null) and.push({ price: { gte: q.price_min, lte: q.price_max } });
    return { status: q.available === '1' ? 'PUBLISHED' : { in: VISIBLE_IN_FEED }, AND: and };
  }

  async sitemap() {
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

  async wardrobe(username: string, viewerId: string | undefined, section: string, sort: string) {
    const user = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!user) throw new NotFoundException({ message: 'Такого гардероба нет' });
    const isOwner = viewerId === user.id;

    // Visitors see PUBLISHED, RESERVED and SOLD; the owner also sees hidden, drafts and blocked.
    const statuses: ListingStatus[] = isOwner ? ['PUBLISHED', 'RESERVED', 'SOLD', 'HIDDEN', 'DRAFT', 'BLOCKED'] : ['PUBLISHED', 'RESERVED', 'SOLD'];
    const rows = await this.prisma.listing.findMany({
      where: { sellerId: user.id, status: { in: statuses } },
      include: cardInclude,
      orderBy:
        sort === 'old' ? { createdAt: 'asc' } : sort === 'cheap' ? { price: 'asc' } : sort === 'expensive' ? { price: 'desc' } : { createdAt: 'desc' },
    });

    const sectionOf = (l: Listing) => categoryBySlug(l.category)?.section ?? 'accessories';
    const fresh = (l: Listing) => !!l.publishedAt && Date.now() - l.publishedAt.getTime() < 14 * 24 * 3600 * 1000;
    const counts = {
      all: rows.filter((r) => r.status !== 'DRAFT').length,
      top: 0,
      bottom: 0,
      shoes: 0,
      accessories: 0,
      new: rows.filter((r) => r.status !== 'DRAFT' && fresh(r)).length,
      selling: rows.filter((r) => r.status === 'PUBLISHED').length,
      sold: rows.filter((r) => r.status === 'SOLD').length,
    };
    for (const r of rows) if (r.status !== 'DRAFT') counts[sectionOf(r)]++;

    const filtered = rows.filter((r) => {
      if (section === 'all') return true;
      if (section === 'new') return r.status !== 'DRAFT' && fresh(r);
      if (section === 'selling') return r.status === 'PUBLISHED';
      if (section === 'sold') return r.status === 'SOLD';
      return r.status !== 'DRAFT' && categoriesInSection(section as WardrobeSection).includes(r.category ?? '');
    });

    const cards = await this.cards(filtered, viewerId);
    // Sold items go last in every section for visitors (frame 09).
    const ordered = isOwner ? cards : [...cards.filter((c) => c.status !== 'SOLD'), ...cards.filter((c) => c.status === 'SOLD')];
    const groups = (['top', 'bottom', 'shoes', 'accessories'] as const)
      .map((s) => ({ section: s, items: ordered.filter((c) => c.status !== 'DRAFT' && (categoryBySlug(c.category)?.section ?? 'accessories') === s) }))
      .filter((g) => g.items.length);

    return {
      seller: await this.sellerSummary(user.id, viewerId),
      isOwner,
      counts,
      groups,
      drafts: isOwner ? ordered.filter((c) => c.status === 'DRAFT') : [],
    };
  }
}
