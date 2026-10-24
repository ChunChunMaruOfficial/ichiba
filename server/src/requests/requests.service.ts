import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withJobLock } from '../common/job-lock.js';
import type { DeliveryMethod, Prisma, RequestSource, RequestStatus } from '../generated/prisma/client.js';
import { applyDiscount, discountFor, tiersOf } from '../listings/bundle.js';
import { ChatService } from '../chat/chat.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { StatsService } from '../stats/stats.js';
import { ListingsService } from '../listings/listings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService, SIGNAL_WEIGHTS } from '../recommendations/recommendations.service.js';
import { RedisService } from '../redis/redis.js';

const REPLY_MS = 48 * 3600 * 1000;
/** Deals per page of «Мои покупки» / «Мои продажи». */
const PAGE = 60;
/** Ways to receive an item a buyer can choose. Pickup was folded into "in person" (older deals keep it). */
const DELIVERY_METHODS: DeliveryMethod[] = ['IN_PERSON', 'DELIVERY'];
const AUTO_COMPLETE_MS = 7 * 24 * 3600 * 1000;

export const ACTIVE_REQUEST: RequestStatus[] = ['PENDING_SELLER', 'ACCEPTED', 'WAITING_PAYMENT', 'WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED', 'DISPUTED'];
const AFTER_ACCEPT: RequestStatus[] = ['ACCEPTED', 'WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'DISPUTED'];

const requestInclude = {
  items: { include: { listing: { include: cardInclude } } },
  buyer: { select: { id: true, username: true, phone: true } },
  seller: { select: { id: true, username: true, phone: true, city: true } },
  threads: { select: { id: true }, take: 1 },
  review: { select: { id: true, rating: true, text: true, tags: true, reply: true, createdAt: true, repliedAt: true, hidden: true } },
} satisfies Prisma.BuyRequestInclude;
type RequestRow = Prisma.BuyRequestGetPayload<{ include: typeof requestInclude }>;

export interface DeliveryInput {
  deliveryMethod: DeliveryMethod;
  deliveryPoint?: string | null;
  contactPhone?: string | null;
  buyerComment?: string | null;
}

export interface CreateRequestInput extends DeliveryInput {
  listingIds: string[];
  source: RequestSource;
  /** «Купить» on a «Несколько размеров» listing: the size picked, by listing id (the cart keeps its own). */
  sizes?: Record<string, string>;
  /** The total the buyer saw on the checkout screen; a different total now means the price changed meanwhile. */
  expectedTotal?: number;
}

/** «Несколько размеров»: one listing with several sizes, never reserved or sold as a whole by a deal. */
const multiSize = (l: { sizes: string[] }) => l.sizes.length > 1;
/**
 * The size a buyer picked is still for sale on the listing as it is now: among its sizes, or — once the seller has
 * cut it down to one size — that one size. A size taken off since can't be sold.
 */
const sizeInStock = (l: { sizes: string[]; sizeValue: string | null }, size: string | null | undefined) =>
  !size || l.sizes.includes(size) || (l.sizes.length <= 1 && l.sizeValue === size);
/** Deal states in which the seller already has the buyer's contacts (the same gate as the phone number). */
const CONTACTS_SHOWN: RequestStatus[] = ['WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'DISPUTED'];
/** «Минск, ул. Ленина 1, кв. 5» → «Минск»: what a seller sees of the address before the deal is on. */
const cityOf = (point: string | null) => {
  const parts = point?.split(',') ?? [];
  return parts.length > 1 ? parts[0].trim() || null : null;
};

@Injectable()
export class RequestsService {
  private readonly logger = new Logger('Requests');

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
    private readonly recs: RecommendationsService,
    private readonly stats: StatsService,
    private readonly chat: ChatService,
    private readonly redis: RedisService,
  ) {}

  /**
   * The buyer's comment opens the conversation: it is posted as their first chat message (through the same
   * antifraud checks as any message). A failure here never fails the request itself.
   */
  private async postComment(requestId: string, buyerId: string, comment: string | null | undefined) {
    const body = comment?.trim();
    if (!body) return;
    try {
      const thread = await this.chat.open(buyerId, { requestId });
      await this.chat.send(buyerId, thread.id, { body, photoIds: [], videoIds: [] });
    } catch (e) {
      this.logger.warn(`comment of request ${requestId} not posted to chat: ${(e as Error).message}`);
    }
  }

  // ---------- serialization ----------

  private serialize(r: RequestRow, viewerId: string) {
    const role = r.buyerId === viewerId ? 'buyer' : 'seller';
    const accepted = AFTER_ACCEPT.includes(r.status);
    const counterpart = role === 'buyer' ? r.seller : r.buyer;
    // The size the buyer picked replaces the listing's «S · M · L».
    const items = r.items.map((i) => ({ ...serializeCard(i.listing), ...(i.size ? { size: i.size } : {}), dealPrice: i.price }));
    return {
      id: r.id,
      number: r.number,
      role,
      status: r.status,
      priceTotal: r.priceTotal,
      subtotal: r.subtotal,
      discountPercent: r.discountPercent,
      listPriceTotal: r.items.reduce((s, i) => s + (i.listing.price ?? i.price), 0),
      source: r.source,
      deliveryMethod: r.deliveryMethod,
      // The buyer's address reaches the seller only for a live, accepted deal; before that (and after a decline or
      // cancel) just the city, so a request alone never hands out someone's home address.
      deliveryPoint: role === 'buyer' || CONTACTS_SHOWN.includes(r.status) ? r.deliveryPoint : cityOf(r.deliveryPoint),
      buyerComment: r.buyerComment,
      trackingNumber: r.trackingNumber,
      reason: r.reason,
      cancelledByMe: r.cancelledById ? r.cancelledById === viewerId : null,
      expiresAt: r.expiresAt,
      handedOverAt: r.handedOverAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      items,
      counterpart: {
        id: counterpart.id,
        username: counterpart.username,
        // Contacts are revealed only once the seller has accepted.
        phone: accepted && r.status !== 'ACCEPTED' ? (role === 'buyer' ? r.seller.phone : (r.contactPhone ?? r.buyer.phone)) : null,
      },
      sellerCity: r.seller.city,
      threadId: r.threads[0]?.id ?? null,
      needsMyAction: this.needsAction(r, role),
      review:
        r.review && (!r.review.hidden || role === 'buyer')
          ? { ...r.review, canEdit: role === 'buyer' && Date.now() - r.review.createdAt.getTime() < 14 * 24 * 3600 * 1000 }
          : null,
      // The buyer reviews the seller once, within 30 days after completion.
      canReview: role === 'buyer' && r.status === 'COMPLETED' && !r.review && !!r.completedAt && Date.now() - r.completedAt.getTime() < 30 * 24 * 3600 * 1000,
    };
  }

  private needsAction(r: RequestRow, role: 'buyer' | 'seller') {
    if (role === 'seller') return r.status === 'PENDING_SELLER' || r.status === 'WAITING_HANDOVER';
    return r.status === 'ACCEPTED' || r.status === 'HANDED_OVER' || r.status === 'IN_TRANSIT';
  }

  private async load(id: string, viewerId: string) {
    const r = await this.prisma.buyRequest.findUnique({ where: { id }, include: requestInclude });
    if (!r) throw new NotFoundException({ message: 'Сделка не найдена' });
    if (r.buyerId !== viewerId && r.sellerId !== viewerId) throw new ForbiddenException({ message: 'Нет доступа' });
    return r;
  }

  private validateDelivery(input: DeliveryInput, allowed: DeliveryMethod[]) {
    if (!allowed.includes(input.deliveryMethod)) {
      throw new BadRequestException({ message: 'Продавец не предлагает этот способ получения', fields: { deliveryMethod: 'Выберите другой способ' } });
    }
    if (input.deliveryMethod === 'DELIVERY' && !input.deliveryPoint?.trim()) {
      throw new BadRequestException({ message: 'Укажите адрес доставки', fields: { deliveryPoint: 'Укажите город и адрес' } });
    }
  }

  /** Links an existing listing chat to the new deal so both sides land in the same thread. */
  private async linkThreads(requestId: string, buyerId: string, listingIds: string[]) {
    await this.prisma.thread.updateMany({ where: { buyerId, listingId: { in: listingIds } }, data: { requestId } });
  }

  // ---------- create ----------

  /** "Купить" (one item) or cart checkout (several items from one seller, frame 12). */
  async create(buyerId: string, input: CreateRequestInput) {
    const ids = [...new Set(input.listingIds)];
    const listings = await this.prisma.listing.findMany({ where: { id: { in: ids } } });
    if (listings.length !== ids.length || listings.some((l) => l.status === 'DELETED')) throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listings.some((l) => l.sellerId === buyerId)) throw new BadRequestException({ message: 'Это ваша вещь' });
    if (new Set(listings.map((l) => l.sellerId)).size > 1) throw new BadRequestException({ message: 'Один запрос — вещи одного продавца' });
    if (listings.some((l) => l.saleType === 'AUCTION')) throw new BadRequestException({ message: 'Это аукцион — сделайте ставку', code: 'AUCTION' });
    if (listings.some((l) => l.status === 'RESERVED')) throw new ConflictException({ message: 'Пока вы оформляли, вещь зарезервировали', code: 'RESERVED' });
    if (listings.some((l) => l.priceNegotiable)) throw new BadRequestException({ message: 'Цена договорная — предложите свою цену или напишите продавцу', code: 'NEGOTIABLE' });
    if (listings.some((l) => l.status !== 'PUBLISHED' || !l.price)) throw new ConflictException({ message: 'Вещь недоступна для покупки', code: 'UNAVAILABLE' });
    const allowed = listings.reduce<DeliveryMethod[]>((acc, l) => acc.filter((m) => l.deliveryOptions.includes(m)), DELIVERY_METHODS);
    this.validateDelivery(input, allowed);
    const picked: Record<string, string | null> =
      input.source === 'CART'
        ? Object.fromEntries((await this.prisma.cartItem.findMany({ where: { userId: buyerId, listingId: { in: ids } } })).map((c) => [c.listingId, c.size]))
        : (input.sizes ?? {});
    for (const l of listings.filter(multiSize)) {
      const size = picked[l.id];
      if (!size || !l.sizes.includes(size)) throw new BadRequestException({ message: `Выберите размер: ${l.title}`, code: 'SIZE', fields: { size: 'Выберите размер' } });
    }

    const existing = await this.prisma.buyRequest.findFirst({
      where: { buyerId, status: { in: ACTIVE_REQUEST }, items: { some: { listingId: { in: ids } } } },
      select: { id: true },
    });
    if (existing) throw new ConflictException({ message: 'Вы уже отправили запрос на эту вещь', requestId: existing.id, code: 'DUPLICATE' });

    const sellerId = listings[0].sellerId;
    // Several items of one seller: the seller's bundle discount applies (feature 10).
    const seller = await this.prisma.user.findUniqueOrThrow({ where: { id: sellerId }, select: { bundleDiscounts: true } });
    const percent = listings.length > 1 ? discountFor(tiersOf(seller.bundleDiscounts), listings.length) : 0;
    const priced = applyDiscount(listings.map((l) => l.price!), percent);
    // The buyer agreed to the total on their screen: a price edited (or a discount changed) since is not silently applied.
    if (input.expectedTotal != null && input.expectedTotal !== priced.total) {
      throw new ConflictException({ code: 'PRICE_CHANGED', message: 'Цена изменилась — проверьте сумму', priceTotal: priced.total });
    }
    const request = await this.prisma.buyRequest.create({
      data: {
        buyerId,
        sellerId,
        priceTotal: priced.total,
        subtotal: percent ? priced.subtotal : null,
        discountPercent: percent,
        source: input.source,
        deliveryMethod: input.deliveryMethod,
        deliveryPoint: input.deliveryPoint?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        buyerComment: input.buyerComment?.trim() || null,
        status: 'PENDING_SELLER',
        expiresAt: new Date(Date.now() + REPLY_MS),
        items: { create: listings.map((l, i) => ({ listingId: l.id, price: priced.itemPrices[i], size: multiSize(l) ? picked[l.id] : null })) },
        events: { create: [{ status: 'CREATED', byUserId: buyerId }, { status: 'PENDING_SELLER', byUserId: buyerId }] },
      },
      include: requestInclude,
    });
    if (input.source === 'CART') await this.prisma.cartItem.deleteMany({ where: { userId: buyerId, listingId: { in: ids } } });
    await this.linkThreads(request.id, buyerId, ids);
    await this.postComment(request.id, buyerId, input.buyerComment);
    const title = listings.length > 1 ? `${listings[0].title} и ещё ${listings.length - 1}` : listings[0].title;
    await this.notifications.notify(sellerId, 'request_new', { requestId: request.id, title, price: request.priceTotal, buyer: request.buyer.username });
    for (const l of listings) {
      await this.recs.record(buyerId, 'request', l.id);
      this.stats.track(l.id, 'requests');
    }
    // Reloaded: posting the comment may have opened the conversation (threadId).
    return input.buyerComment?.trim() ? this.get(request.id, buyerId) : this.serialize(request, buyerId);
  }

  /**
   * Accepted offer → deal at the agreed price in ACCEPTED: the item is reserved for the buyer, who then
   * picks how to receive it (frame 13 SELLER OFFER SCREEN). Runs inside the offer's transaction.
   */
  async createFromOffer(tx: Prisma.TransactionClient, offer: { listingId: string; buyerId: string; sellerId: string; amount: number; acceptedBy: string; size?: string | null }) {
    const listing = await tx.listing.findUniqueOrThrow({ where: { id: offer.listingId } });
    // Several sizes: the listing stays on sale for the other sizes; the seller takes the sold one off by hand.
    // The offer was for a size the seller has taken off since: nothing to sell.
    if (!sizeInStock(listing, offer.size)) throw new ConflictException({ message: 'Выбранный размер уже недоступен', code: 'UNAVAILABLE' });
    const reserved = multiSize(listing)
      ? { count: listing.status === 'PUBLISHED' && !!offer.size ? 1 : 0 }
      : await tx.listing.updateMany({ where: { id: listing.id, status: 'PUBLISHED' }, data: { status: 'RESERVED' } });
    if (!reserved.count) throw new ConflictException({ message: 'Вещь уже недоступна', code: 'UNAVAILABLE' });
    return tx.buyRequest.create({
      data: {
        buyerId: offer.buyerId,
        sellerId: offer.sellerId,
        priceTotal: offer.amount,
        source: 'OFFER',
        deliveryMethod: listing.deliveryOptions[0] ?? 'IN_PERSON',
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + REPLY_MS),
        items: { create: [{ listingId: listing.id, price: offer.amount, size: multiSize(listing) ? (offer.size ?? null) : null }] },
        events: { create: [{ status: 'CREATED', byUserId: offer.buyerId }, { status: 'ACCEPTED', byUserId: offer.acceptedBy }] },
      },
    });
  }

  /** After an accepted offer, competing requests are declined and watchers told the item is reserved. */
  async afterOfferAccepted(requestId: string, listingId: string, buyerId: string, title: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { sizes: true } });
    if (listing && !multiSize(listing)) {
      await this.listings.declinePendingRequests(listingId, 'Уже продано', requestId);
      await this.listings.notifyWatchers(listingId, 'item_reserved', title, buyerId);
    }
    await this.linkThreads(requestId, buyerId, [listingId]);
  }

  /** Buyer picks delivery for a deal created from an accepted offer: ACCEPTED → WAITING_HANDOVER. */
  async confirmDelivery(buyerId: string, id: string, input: DeliveryInput) {
    const r0 = await this.load(id, buyerId);
    if (r0.buyerId !== buyerId) throw new ForbiddenException({ message: 'Это действие недоступно' });
    const allowed = r0.items.reduce<DeliveryMethod[]>((acc, i) => acc.filter((m) => i.listing.deliveryOptions.includes(m)), DELIVERY_METHODS);
    this.validateDelivery(input, allowed);
    const { r } = await this.transition(id, buyerId, {
      role: 'buyer',
      from: ['ACCEPTED'],
      to: 'WAITING_HANDOVER',
      data: {
        deliveryMethod: input.deliveryMethod,
        deliveryPoint: input.deliveryPoint?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        buyerComment: input.buyerComment?.trim() || null,
        expiresAt: null,
      },
    });
    await this.postComment(id, buyerId, input.buyerComment);
    await this.notifications.notify(r.sellerId, 'request_accepted', { requestId: id, title: r.items[0]?.listing.title, buyer: r.buyer.username, confirmed: true });
    return this.get(id, buyerId);
  }

  // ---------- transitions ----------

  /**
   * A status move with its data, its event and whatever `inTx` adds (releasing a reservation, completing) in one
   * transaction: a failure half-way never leaves a deal moved without its history or an item still reserved.
   */
  private async transition(
    id: string,
    actorId: string,
    opts: {
      role: 'buyer' | 'seller' | 'any';
      from: RequestStatus[];
      to: RequestStatus;
      reason?: string | null;
      data?: Prisma.BuyRequestUpdateInput;
      inTx?: (tx: Prisma.TransactionClient, r: RequestRow) => Promise<void>;
    },
  ) {
    const r = await this.load(id, actorId);
    const role = r.buyerId === actorId ? 'buyer' : 'seller';
    if (opts.role !== 'any' && opts.role !== role) throw new ForbiddenException({ message: 'Это действие недоступно' });
    if (!opts.from.includes(r.status)) throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу', status: r.status });
    await this.prisma.$transaction(async (tx) => {
      // Optimistic guard: the status must still be the one we read.
      const { count } = await tx.buyRequest.updateMany({ where: { id, status: r.status }, data: { status: opts.to } });
      if (!count) throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу' });
      await tx.buyRequest.update({
        where: { id },
        data: { ...opts.data, reason: opts.reason ?? undefined, events: { create: { status: opts.to, byUserId: actorId, reason: opts.reason } } },
      });
      await opts.inTx?.(tx, r);
    });
    return { r, role };
  }

  /** Accept: the listing is reserved atomically (no double sale), competing requests are declined. */
  async accept(sellerId: string, id: string) {
    const r = await this.load(id, sellerId);
    if (r.sellerId !== sellerId) throw new ForbiddenException({ message: 'Это действие недоступно' });
    if (r.status !== 'PENDING_SELLER') throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу' });
    const listingIds = r.items.map((i) => i.listingId);

    const single = await this.prisma.$transaction(async (tx) => {
      // A size the seller has taken off since the request (sold elsewhere) can't be sold again — also when the
      // listing is down to one size now and so no longer counts as «Несколько размеров».
      const current = await tx.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, sizes: true, sizeValue: true } });
      if (r.items.some((i) => !sizeInStock(current.find((c) => c.id === i.listingId) ?? { sizes: [], sizeValue: null }, i.size))) {
        throw new ConflictException({ message: 'Выбранный размер уже недоступен', code: 'UNAVAILABLE' });
      }
      // Several sizes: such a listing stays on sale (other sizes, other buyers); only one-of-a-kind items are reserved.
      // Decided from the rows read here, not from the request loaded before: the seller may have changed the sizes.
      const single = current.filter((l) => !multiSize(l)).map((l) => l.id);
      const multi = current.filter(multiSize).map((l) => l.id);
      const reserved = await tx.listing.updateMany({ where: { id: { in: single }, status: 'PUBLISHED' }, data: { status: 'RESERVED' } });
      const onSale = await tx.listing.count({ where: { id: { in: multi }, status: 'PUBLISHED' } });
      if (reserved.count + onSale !== listingIds.length) throw new ConflictException({ message: 'Вещь уже недоступна', code: 'UNAVAILABLE' });
      const moved = await tx.buyRequest.updateMany({ where: { id, status: 'PENDING_SELLER' }, data: { status: 'WAITING_HANDOVER', expiresAt: null } });
      if (!moved.count) throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу' });
      await tx.buyRequestEvent.createMany({
        data: [
          { requestId: id, status: 'ACCEPTED', byUserId: sellerId },
          { requestId: id, status: 'WAITING_HANDOVER', byUserId: sellerId },
        ],
      });
      // Pending offers on these items are void now.
      await tx.offer.updateMany({ where: { listingId: { in: single }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      return single;
    });

    const title = r.items[0]?.listing.title ?? '';
    for (const listingId of single) {
      await this.listings.declinePendingRequests(listingId, 'Уже продано', id);
      await this.listings.notifyWatchers(listingId, 'item_reserved', title, r.buyerId);
    }
    await this.notifications.notify(r.buyerId, 'request_accepted', { requestId: id, title, seller: r.seller.username });
    return this.get(id, sellerId);
  }

  async decline(sellerId: string, id: string, reason?: string | null) {
    const { r } = await this.transition(id, sellerId, { role: 'seller', from: ['PENDING_SELLER'], to: 'DECLINED', reason: reason || null, data: { expiresAt: null } });
    await this.notifications.notify(r.buyerId, 'request_declined', { requestId: id, title: r.items[0]?.listing.title, reason });
    return this.get(id, sellerId);
  }

  /**
   * Inside the deal's transaction: one-of-a-kind items this deal reserved go back on sale (an auction item as a
   * fixed-price listing) — unless another live deal holds the item, as a deal for another size of a listing that is
   * down to one size now may. Single or multi-size is decided from the listing as it is now. Returns the ids freed.
   */
  private async releaseTx(tx: Prisma.TransactionClient, requestId: string, listingIds: string[]) {
    const current = await tx.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, sizes: true } });
    const single = current.filter((l) => !multiSize(l)).map((l) => l.id);
    if (!single.length) return [];
    const busy = await tx.buyRequestItem.findMany({
      where: { listingId: { in: single }, requestId: { not: requestId }, request: { status: { in: ACTIVE_REQUEST } } },
      select: { listingId: true },
    });
    const released: string[] = [];
    for (const listingId of single.filter((l) => !busy.some((b) => b.listingId === l))) {
      const { count } = await tx.listing.updateMany({ where: { id: listingId, status: 'RESERVED' }, data: { status: 'PUBLISHED', saleType: 'FIXED' } });
      if (count) released.push(listingId);
    }
    return released;
  }

  /** After the commit: watchers of the items put back on sale hear about it. */
  private async notifyReleased(r: { items: { listingId: string; listing: { title: string } }[] }, released: string[]) {
    for (const listingId of released) await this.listings.notifyWatchers(listingId, 'item_available', r.items.find((i) => i.listingId === listingId)?.listing.title ?? '');
  }

  /** Buyer may withdraw a pending request; either side may cancel before the handover. */
  async cancel(actorId: string, id: string, reason?: string | null) {
    const r0 = await this.load(id, actorId);
    const isBuyer = r0.buyerId === actorId;
    const from: RequestStatus[] = isBuyer ? ['PENDING_SELLER', 'ACCEPTED', 'WAITING_HANDOVER'] : ['ACCEPTED', 'WAITING_HANDOVER'];
    let released: string[] = [];
    const { r } = await this.transition(id, actorId, {
      role: 'any',
      from,
      to: 'CANCELLED',
      reason: reason || null,
      data: { cancelledById: actorId, expiresAt: null },
      // Reservation is released in the same transaction: the item goes back on sale and watchers hear about it.
      inTx: async (tx, r) => {
        if (r.status === 'WAITING_HANDOVER' || r.status === 'ACCEPTED') released = await this.releaseTx(tx, id, r.items.map((i) => i.listingId));
      },
    });
    await this.notifyReleased(r, released);
    const other = isBuyer ? r.sellerId : r.buyerId;
    await this.notifications.notify(other, 'request_cancelled', { requestId: id, title: r.items[0]?.listing.title, reason, by: isBuyer ? 'buyer' : 'seller' });
    return this.get(id, actorId);
  }

  async handedOver(sellerId: string, id: string) {
    const { r } = await this.transition(id, sellerId, { role: 'seller', from: ['WAITING_HANDOVER'], to: 'HANDED_OVER', data: { handedOverAt: new Date() } });
    await this.notifications.notify(r.buyerId, 'deal_handed_over', { requestId: id, title: r.items[0]?.listing.title });
    return this.get(id, sellerId);
  }

  async setTracking(sellerId: string, id: string, trackingNumber: string) {
    const r0 = await this.load(id, sellerId);
    if (r0.deliveryMethod !== 'DELIVERY') throw new BadRequestException({ message: 'Трек-номер нужен только для доставки' });
    const { r } = await this.transition(id, sellerId, {
      role: 'seller',
      from: ['WAITING_HANDOVER'],
      to: 'IN_TRANSIT',
      data: { trackingNumber, handedOverAt: new Date() },
    });
    await this.notifications.notify(r.buyerId, 'deal_in_transit', { requestId: id, title: r.items[0]?.listing.title, trackingNumber });
    return this.get(id, sellerId);
  }

  /** "Я получил вещь": RECEIVED immediately rolls into COMPLETED and the item becomes SOLD. */
  async received(buyerId: string, id: string) {
    const { r } = await this.transition(id, buyerId, {
      role: 'buyer',
      from: ['WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT'],
      to: 'RECEIVED',
      // Completed in the same transaction, guarded on the RECEIVED just written.
      inTx: async (tx) => {
        await this.completeTx(tx, id, ['RECEIVED'], buyerId);
      },
    });
    await this.askForReview(id);
    // A size sold from a «Несколько размеров» listing: the seller takes it off by hand, so remind them.
    const sizes = r.items.filter((i) => i.size).map((i) => i.size);
    await this.notifications.notify(r.sellerId, 'deal_completed', { requestId: id, title: r.items[0]?.listing.title, sizes });
    return this.get(id, buyerId);
  }

  async dispute(actorId: string, id: string, reason: string) {
    const { r, role } = await this.transition(id, actorId, { role: 'any', from: ['WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT'], to: 'DISPUTED', reason });
    this.logger.warn(`Dispute opened on #${r.number} by ${role}: ${reason}`);
    // The other side learns at once that the deal is frozen until an admin looks at it.
    const other = role === 'buyer' ? r.sellerId : r.buyerId;
    const title = r.items[0]?.listing.title ?? `#${r.number}`;
    await this.notifications.notify(other, 'dispute_opened', { requestId: id, title, reason, by: role });
    return this.get(id, actorId);
  }

  /**
   * Completes a deal still in one of `from` (inside the caller's transaction); false when it has moved meanwhile —
   * a dispute, a cancel or the buyer's own confirmation — and then nothing is written.
   * One-of-a-kind items become SOLD; a «Несколько размеров» listing stays on sale — the seller takes the size off.
   */
  private async completeTx(tx: Prisma.TransactionClient, id: string, from: RequestStatus[], byUserId: string | null) {
    const { count } = await tx.buyRequest.updateMany({ where: { id, status: { in: from } }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (!count) return false;
    await tx.buyRequestEvent.create({ data: { requestId: id, status: 'COMPLETED', byUserId } });
    const deal = await tx.buyRequest.findUniqueOrThrow({ where: { id }, select: { buyerId: true, items: { select: { listingId: true, listing: { select: { sizes: true } } } } } });
    const single = deal.items.filter((i) => !multiSize(i.listing)).map((i) => i.listingId);
    const multi = deal.items.filter((i) => multiSize(i.listing)).map((i) => i.listingId);
    await tx.listing.updateMany({ where: { id: { in: single } }, data: { status: 'SOLD', soldAt: new Date() } });
    // Bought: the strongest word on taste there is (on top of the request's signal).
    await tx.signal.createMany({ data: deal.items.map((i) => ({ userId: deal.buyerId, listingId: i.listingId, type: 'purchase', weight: SIGNAL_WEIGHTS.purchase })) });
    await tx.cartItem.deleteMany({ where: { OR: [{ listingId: { in: single } }, { listingId: { in: multi }, userId: deal.buyerId }] } });
    return true;
  }

  /** Asks the buyer to rate the seller of a completed deal (reviews: buyer → seller only). */
  private async askForReview(id: string) {
    const r = await this.prisma.buyRequest.findUnique({ where: { id }, select: { buyerId: true, seller: { select: { username: true } }, items: { take: 1, select: { listing: { select: { id: true, title: true } } } } } });
    if (r) await this.notifications.notify(r.buyerId, 'review_request', { requestId: id, listingId: r.items[0]?.listing.id, title: r.items[0]?.listing.title, seller: r.seller.username });
  }

  // ---------- scheduled rules (frame 14 MVP) ----------

  /** Auto-cancel after 48 h without a reply; auto-complete 7 days after handover. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  sweep() {
    return withJobLock(this.redis, 'requests.sweep', 10 * 60_000, () => this.sweepNow());
  }

  private async sweepNow() {
    const expired = await this.prisma.buyRequest.findMany({
      where: { status: { in: ['PENDING_SELLER', 'ACCEPTED'] }, expiresAt: { lt: new Date() }, source: { not: 'AUCTION' } },
      include: requestInclude,
      take: 500,
    });
    for (const r of expired) {
      const reason = r.status === 'ACCEPTED' ? 'Покупатель не выбрал способ получения за 48 часов' : 'Продавец не ответил за 48 часов';
      const released = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.buyRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'CANCELLED', reason } });
        if (!count) return null;
        await tx.buyRequestEvent.create({ data: { requestId: r.id, status: 'CANCELLED', reason } });
        return r.status === 'ACCEPTED' ? this.releaseTx(tx, r.id, r.items.map((i) => i.listingId)) : [];
      });
      if (!released) continue;
      await this.notifyReleased(r, released);
      const title = r.items[0]?.listing.title;
      await this.notifications.notify(r.buyerId, 'request_expired', { requestId: r.id, title });
      // The seller hears too: their request disappeared, or a reserved item is back on sale.
      await this.notifications.notify(r.sellerId, 'request_expired', { requestId: r.id, title, reason });
    }

    const stale = await this.prisma.buyRequest.findMany({
      where: { status: { in: ['HANDED_OVER', 'IN_TRANSIT'] }, handedOverAt: { lt: new Date(Date.now() - AUTO_COMPLETE_MS) } },
      include: { items: { select: { size: true, listing: { select: { title: true } } } } },
      take: 500,
    });
    let completed = 0;
    for (const r of stale) {
      // Guarded on the handover states: a dispute or the buyer's own «received» since the query wins.
      if (!(await this.prisma.$transaction((tx) => this.completeTx(tx, r.id, ['HANDED_OVER', 'IN_TRANSIT'], null)))) continue;
      completed++;
      await this.askForReview(r.id);
      const sizes = r.items.filter((i) => i.size).map((i) => i.size);
      await this.notifications.notify(r.sellerId, 'deal_completed', { requestId: r.id, title: r.items[0]?.listing.title, sizes, auto: true });
    }
    if (expired.length || completed) this.logger.log(`sweep: ${expired.length} expired, ${completed} auto-completed`);
  }

  // ---------- reads ----------

  async get(id: string, viewerId: string) {
    const r = await this.load(id, viewerId);
    const events = await this.prisma.buyRequestEvent.findMany({ where: { requestId: id }, orderBy: { at: 'asc' } });
    return { ...this.serialize(r, viewerId), events: events.map((e) => ({ status: e.status, at: e.at, reason: e.reason, byMe: e.byUserId === viewerId })) };
  }

  /** `all` (no filter chosen): every deal, the ones waiting for me first. */
  async purchases(buyerId: string, tab: 'all' | 'active' | 'completed' | 'cancelled', offset = 0) {
    const statusByTab: Record<Exclude<typeof tab, 'all'>, RequestStatus[]> = {
      active: ACTIVE_REQUEST,
      completed: ['COMPLETED'],
      cancelled: ['CANCELLED', 'DECLINED'],
    };
    const [rows, counts] = await Promise.all([
      this.prisma.buyRequest.findMany({
        where: { buyerId, ...(tab === 'all' ? {} : { status: { in: statusByTab[tab] } }) },
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: PAGE + 1,
      }),
      this.prisma.buyRequest.groupBy({ by: ['status'], where: { buyerId }, _count: true }),
    ]);
    const count = (s: RequestStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count, 0);
    const items = rows.slice(0, PAGE).map((r) => this.serialize(r, buyerId));
    // Deals that need the buyer's action come first (within the page).
    items.sort((a, b) => Number(b.needsMyAction) - Number(a.needsMyAction));
    return {
      items,
      hasMore: rows.length > PAGE,
      counts: { active: count(statusByTab.active), completed: count(statusByTab.completed), cancelled: count(statusByTab.cancelled) },
    };
  }

  /** `all` (no filter chosen): every deal, the ones waiting for me first. */
  async sales(sellerId: string, tab: 'all' | 'action' | 'deals' | 'sold', offset = 0) {
    const where: Record<typeof tab, Prisma.BuyRequestWhereInput> = {
      all: {},
      action: { status: { in: ['PENDING_SELLER', 'WAITING_HANDOVER'] } },
      deals: { status: { in: ACTIVE_REQUEST } },
      sold: { status: 'COMPLETED' },
    };
    const [rows, sold] = await Promise.all([
      this.prisma.buyRequest.findMany({
        where: { sellerId, ...where[tab] },
        include: requestInclude,
        // Longest-waiting first in "Требует действия".
        orderBy: { createdAt: tab === 'action' ? 'asc' : 'desc' },
        skip: offset,
        take: PAGE + 1,
      }),
      // Summed in the database: the page holds only part of the sold deals.
      tab === 'sold' ? this.prisma.buyRequest.aggregate({ where: { sellerId, status: 'COMPLETED' }, _sum: { priceTotal: true } }) : null,
    ]);
    const items = rows.slice(0, PAGE).map((r) => this.serialize(r, sellerId));
    if (tab === 'all') items.sort((a, b) => Number(b.needsMyAction) - Number(a.needsMyAction));
    const soldTotal = sold ? (sold._sum.priceTotal ?? 0) : null;
    return { items, hasMore: rows.length > PAGE, soldTotal, summary: await this.salesSummary(sellerId) };
  }

  async salesSummary(sellerId: string) {
    const [newRequests, waitingHandover, offers] = await Promise.all([
      this.prisma.buyRequest.count({ where: { sellerId, status: 'PENDING_SELLER' } }),
      this.prisma.buyRequest.count({ where: { sellerId, status: 'WAITING_HANDOVER' } }),
      this.prisma.offer.count({ where: { sellerId, status: 'PENDING', from: 'BUYER', expiresAt: { gt: new Date() } } }),
    ]);
    return { newRequests, waitingHandover, offers };
  }
}
