import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DeliveryMethod, Prisma, RequestSource, RequestStatus } from '../generated/prisma/client.js';
import { applyDiscount, discountFor, tiersOf } from '../listings/bundle.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { StatsService } from '../stats/stats.js';
import { ListingsService } from '../listings/listings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';

const REPLY_MS = 48 * 3600 * 1000;
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
}

@Injectable()
export class RequestsService {
  private readonly logger = new Logger('Requests');

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
    private readonly recs: RecommendationsService,
    private readonly stats: StatsService,
  ) {}

  // ---------- serialization ----------

  private serialize(r: RequestRow, viewerId: string) {
    const role = r.buyerId === viewerId ? 'buyer' : 'seller';
    const accepted = AFTER_ACCEPT.includes(r.status);
    const counterpart = role === 'buyer' ? r.seller : r.buyer;
    const items = r.items.map((i) => ({ ...serializeCard(i.listing), dealPrice: i.price }));
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
      deliveryPoint: r.deliveryPoint,
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
    if (listings.some((l) => l.status !== 'PUBLISHED' || !l.price)) throw new ConflictException({ message: 'Вещь недоступна для покупки', code: 'UNAVAILABLE' });
    const allowed = listings.reduce<DeliveryMethod[]>((acc, l) => acc.filter((m) => l.deliveryOptions.includes(m)), ['IN_PERSON', 'PICKUP', 'DELIVERY']);
    this.validateDelivery(input, allowed);

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
        items: { create: listings.map((l, i) => ({ listingId: l.id, price: priced.itemPrices[i] })) },
        events: { create: [{ status: 'CREATED', byUserId: buyerId }, { status: 'PENDING_SELLER', byUserId: buyerId }] },
      },
      include: requestInclude,
    });
    if (input.source === 'CART') await this.prisma.cartItem.deleteMany({ where: { userId: buyerId, listingId: { in: ids } } });
    await this.linkThreads(request.id, buyerId, ids);
    const title = listings.length > 1 ? `${listings[0].title} и ещё ${listings.length - 1}` : listings[0].title;
    await this.notifications.notify(sellerId, 'request_new', { requestId: request.id, title, price: request.priceTotal, buyer: request.buyer.username });
    for (const l of listings) {
      await this.recs.record(buyerId, 'request', l.id);
      this.stats.track(l.id, 'requests');
    }
    return this.serialize(request, buyerId);
  }

  /**
   * Accepted offer → deal at the agreed price in ACCEPTED: the item is reserved for the buyer, who then
   * picks how to receive it (frame 13 SELLER OFFER SCREEN). Runs inside the offer's transaction.
   */
  async createFromOffer(tx: Prisma.TransactionClient, offer: { listingId: string; buyerId: string; sellerId: string; amount: number; acceptedBy: string }) {
    const listing = await tx.listing.findUniqueOrThrow({ where: { id: offer.listingId } });
    const reserved = await tx.listing.updateMany({ where: { id: listing.id, status: 'PUBLISHED' }, data: { status: 'RESERVED' } });
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
        items: { create: [{ listingId: listing.id, price: offer.amount }] },
        events: { create: [{ status: 'CREATED', byUserId: offer.buyerId }, { status: 'ACCEPTED', byUserId: offer.acceptedBy }] },
      },
    });
  }

  /** After an accepted offer, competing requests are declined and watchers told the item is reserved. */
  async afterOfferAccepted(requestId: string, listingId: string, buyerId: string, title: string) {
    await this.listings.declinePendingRequests(listingId, 'Уже продано', requestId);
    await this.listings.notifyWatchers(listingId, 'item_reserved', title, buyerId);
    await this.linkThreads(requestId, buyerId, [listingId]);
  }

  /** Buyer picks delivery for a deal created from an accepted offer: ACCEPTED → WAITING_HANDOVER. */
  async confirmDelivery(buyerId: string, id: string, input: DeliveryInput) {
    const r0 = await this.load(id, buyerId);
    if (r0.buyerId !== buyerId) throw new ForbiddenException({ message: 'Это действие недоступно' });
    const allowed = r0.items.reduce<DeliveryMethod[]>((acc, i) => acc.filter((m) => i.listing.deliveryOptions.includes(m)), ['IN_PERSON', 'PICKUP', 'DELIVERY']);
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
    await this.notifications.notify(r.sellerId, 'request_accepted', { requestId: id, title: r.items[0]?.listing.title, buyer: r.buyer.username, confirmed: true });
    return this.get(id, buyerId);
  }

  // ---------- transitions ----------

  private async transition(
    id: string,
    actorId: string,
    opts: { role: 'buyer' | 'seller' | 'any'; from: RequestStatus[]; to: RequestStatus; reason?: string | null; data?: Prisma.BuyRequestUpdateInput },
  ) {
    const r = await this.load(id, actorId);
    const role = r.buyerId === actorId ? 'buyer' : 'seller';
    if (opts.role !== 'any' && opts.role !== role) throw new ForbiddenException({ message: 'Это действие недоступно' });
    if (!opts.from.includes(r.status)) throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу', status: r.status });
    // Optimistic guard: the status must still be the one we read.
    const { count } = await this.prisma.buyRequest.updateMany({ where: { id, status: r.status }, data: { status: opts.to } });
    if (!count) throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу' });
    await this.prisma.buyRequest.update({
      where: { id },
      data: { ...opts.data, reason: opts.reason ?? undefined, events: { create: { status: opts.to, byUserId: actorId, reason: opts.reason } } },
    });
    return { r, role };
  }

  /** Accept: the listing is reserved atomically (no double sale), competing requests are declined. */
  async accept(sellerId: string, id: string) {
    const r = await this.load(id, sellerId);
    if (r.sellerId !== sellerId) throw new ForbiddenException({ message: 'Это действие недоступно' });
    if (r.status !== 'PENDING_SELLER') throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу' });
    const listingIds = r.items.map((i) => i.listingId);

    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.listing.updateMany({ where: { id: { in: listingIds }, status: 'PUBLISHED' }, data: { status: 'RESERVED' } });
      if (reserved.count !== listingIds.length) throw new ConflictException({ message: 'Вещь уже недоступна', code: 'UNAVAILABLE' });
      const moved = await tx.buyRequest.updateMany({ where: { id, status: 'PENDING_SELLER' }, data: { status: 'WAITING_HANDOVER', expiresAt: null } });
      if (!moved.count) throw new ConflictException({ message: 'Статус сделки уже изменился — обновите страницу' });
      await tx.buyRequestEvent.createMany({
        data: [
          { requestId: id, status: 'ACCEPTED', byUserId: sellerId },
          { requestId: id, status: 'WAITING_HANDOVER', byUserId: sellerId },
        ],
      });
      // Pending offers on these items are void now.
      await tx.offer.updateMany({ where: { listingId: { in: listingIds }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    });

    const title = r.items[0]?.listing.title ?? '';
    for (const listingId of listingIds) {
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

  private async release(r: RequestRow) {
    for (const item of r.items) {
      // A released auction item returns as a fixed-price listing.
      await this.prisma.listing.updateMany({ where: { id: item.listingId, status: 'RESERVED' }, data: { status: 'PUBLISHED', saleType: 'FIXED' } });
      await this.listings.notifyWatchers(item.listingId, 'item_available', item.listing.title);
    }
  }

  /** Buyer may withdraw a pending request; either side may cancel before the handover. */
  async cancel(actorId: string, id: string, reason?: string | null) {
    const r0 = await this.load(id, actorId);
    const isBuyer = r0.buyerId === actorId;
    const from: RequestStatus[] = isBuyer ? ['PENDING_SELLER', 'ACCEPTED', 'WAITING_HANDOVER'] : ['ACCEPTED', 'WAITING_HANDOVER'];
    const { r } = await this.transition(id, actorId, { role: 'any', from, to: 'CANCELLED', reason: reason || null, data: { cancelledById: actorId, expiresAt: null } });

    // Reservation is released: the item goes back on sale and watchers hear about it.
    if (r.status === 'WAITING_HANDOVER' || r.status === 'ACCEPTED') await this.release(r);
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
    const { r } = await this.transition(id, buyerId, { role: 'buyer', from: ['WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT'], to: 'RECEIVED' });
    await this.complete(id, r.items.map((i) => i.listingId), buyerId);
    await this.notifications.notify(r.sellerId, 'deal_completed', { requestId: id, title: r.items[0]?.listing.title });
    return this.get(id, buyerId);
  }

  async dispute(actorId: string, id: string, reason: string) {
    const { r, role } = await this.transition(id, actorId, { role: 'any', from: ['WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT'], to: 'DISPUTED', reason });
    this.logger.warn(`Dispute opened on #${r.number} by ${role}: ${reason}`);
    return this.get(id, actorId);
  }

  private async complete(id: string, listingIds: string[], byUserId: string | null) {
    await this.prisma.$transaction([
      this.prisma.buyRequest.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date(), events: { create: { status: 'COMPLETED', byUserId } } },
      }),
      this.prisma.listing.updateMany({ where: { id: { in: listingIds } }, data: { status: 'SOLD', soldAt: new Date() } }),
      this.prisma.cartItem.deleteMany({ where: { listingId: { in: listingIds } } }),
    ]);
    // Ask the buyer to rate the seller (reviews: buyer → seller only).
    const r = await this.prisma.buyRequest.findUnique({ where: { id }, select: { buyerId: true, seller: { select: { username: true } }, items: { take: 1, select: { listing: { select: { id: true, title: true } } } } } });
    if (r) await this.notifications.notify(r.buyerId, 'review_request', { requestId: id, listingId: r.items[0]?.listing.id, title: r.items[0]?.listing.title, seller: r.seller.username });
  }

  // ---------- scheduled rules (frame 14 MVP) ----------

  /** Auto-cancel after 48 h without a reply; auto-complete 7 days after handover. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    const expired = await this.prisma.buyRequest.findMany({
      where: { status: { in: ['PENDING_SELLER', 'ACCEPTED'] }, expiresAt: { lt: new Date() }, source: { not: 'AUCTION' } },
      include: requestInclude,
    });
    for (const r of expired) {
      const reason = r.status === 'ACCEPTED' ? 'Покупатель не выбрал способ получения за 48 часов' : 'Продавец не ответил за 48 часов';
      const { count } = await this.prisma.buyRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'CANCELLED', reason } });
      if (!count) continue;
      await this.prisma.buyRequestEvent.create({ data: { requestId: r.id, status: 'CANCELLED', reason } });
      if (r.status === 'ACCEPTED') await this.release(r);
      await this.notifications.notify(r.buyerId, 'request_expired', { requestId: r.id, title: r.items[0]?.listing.title });
    }

    const stale = await this.prisma.buyRequest.findMany({
      where: { status: { in: ['HANDED_OVER', 'IN_TRANSIT'] }, handedOverAt: { lt: new Date(Date.now() - AUTO_COMPLETE_MS) } },
      include: { items: true },
    });
    for (const r of stale) await this.complete(r.id, r.items.map((i) => i.listingId), null);
    if (expired.length || stale.length) this.logger.log(`sweep: ${expired.length} expired, ${stale.length} auto-completed`);
  }

  // ---------- reads ----------

  async get(id: string, viewerId: string) {
    const r = await this.load(id, viewerId);
    const events = await this.prisma.buyRequestEvent.findMany({ where: { requestId: id }, orderBy: { at: 'asc' } });
    return { ...this.serialize(r, viewerId), events: events.map((e) => ({ status: e.status, at: e.at, reason: e.reason, byMe: e.byUserId === viewerId })) };
  }

  async purchases(buyerId: string, tab: 'active' | 'completed' | 'cancelled') {
    const statusByTab: Record<typeof tab, RequestStatus[]> = {
      active: ACTIVE_REQUEST,
      completed: ['COMPLETED'],
      cancelled: ['CANCELLED', 'DECLINED'],
    };
    const [rows, counts] = await Promise.all([
      this.prisma.buyRequest.findMany({ where: { buyerId, status: { in: statusByTab[tab] } }, include: requestInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.buyRequest.groupBy({ by: ['status'], where: { buyerId }, _count: true }),
    ]);
    const count = (s: RequestStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count, 0);
    const items = rows.map((r) => this.serialize(r, buyerId));
    // Deals that need the buyer's action come first.
    items.sort((a, b) => Number(b.needsMyAction) - Number(a.needsMyAction));
    return { items, counts: { active: count(statusByTab.active), completed: count(statusByTab.completed), cancelled: count(statusByTab.cancelled) } };
  }

  async sales(sellerId: string, tab: 'action' | 'deals' | 'sold') {
    const where: Record<typeof tab, Prisma.BuyRequestWhereInput> = {
      action: { status: { in: ['PENDING_SELLER', 'WAITING_HANDOVER'] } },
      deals: { status: { in: ACTIVE_REQUEST } },
      sold: { status: 'COMPLETED' },
    };
    const rows = await this.prisma.buyRequest.findMany({
      where: { sellerId, ...where[tab] },
      include: requestInclude,
      // Longest-waiting first in "Требует действия".
      orderBy: { createdAt: tab === 'action' ? 'asc' : 'desc' },
    });
    const items = rows.map((r) => this.serialize(r, sellerId));
    const soldTotal = tab === 'sold' ? items.reduce((s, i) => s + i.priceTotal, 0) : null;
    return { items, soldTotal, summary: await this.salesSummary(sellerId) };
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
