import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { NegotiationAdvisor } from '../ai/negotiation.js';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { Offer, Prisma } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestsService } from '../requests/requests.service.js';
import { StatsService } from '../stats/stats.js';

/** Negotiation rules from frame 13. */
const OFFER_TTL_MS = 48 * 3600 * 1000;
const MAX_ROUNDS = 3;
const MIN_SHARE = 0.3;
const COOLDOWN_AFTER_DECLINE_MS = 24 * 3600 * 1000;
/** "Скидка лайкнувшим": one mailing per listing per 3 days, so likers aren't spammed. */
const LIKERS_COOLDOWN_MS = 72 * 3600 * 1000;

const offerInclude = {
  listing: { include: cardInclude },
  buyer: { select: { id: true, username: true } },
  seller: { select: { id: true, username: true } },
} satisfies Prisma.OfferInclude;
type OfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

@Injectable()
export class OffersService {
  private readonly logger = new Logger('Offers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly requests: RequestsService,
    private readonly negotiation: NegotiationAdvisor,
    private readonly stats: StatsService,
  ) {}

  private serialize(o: OfferRow, viewerId: string, history: Offer[] = []) {
    const role = o.buyerId === viewerId ? 'buyer' : 'seller';
    const pending = o.status === 'PENDING' && o.expiresAt > new Date();
    // The side that did not make the latest offer is the one who answers it.
    const myTurn = pending && ((o.from === 'BUYER' && role === 'seller') || (o.from === 'SELLER' && role === 'buyer'));
    // A discount the seller sent to everyone who liked the item is accepted or declined, not haggled over.
    const fromLikers = history[0]?.round === 1 && history[0]?.from === 'SELLER';
    return {
      id: o.id,
      role,
      round: o.round,
      amount: o.amount,
      from: o.from,
      status: pending || o.status !== 'PENDING' ? o.status : 'EXPIRED',
      expiresAt: o.expiresAt,
      createdAt: o.createdAt,
      requestId: o.requestId,
      listPrice: o.listing.price,
      listing: serializeCard(o.listing),
      counterpart: role === 'buyer' ? o.seller : o.buyer,
      myTurn,
      fromLikers,
      canCounter: myTurn && o.round < MAX_ROUNDS && !fromLikers,
      /** Allowed range for a counter-offer: strictly between the last two prices. */
      counterRange: myTurn && o.round < MAX_ROUNDS && !fromLikers ? this.counterRange(o, history) : null,
      history: history.map((h) => ({ round: h.round, amount: h.amount, from: h.from, status: h.status, createdAt: h.createdAt })),
    };
  }

  private counterRange(o: OfferRow, history: Offer[]) {
    const previous = history.filter((h) => h.round < o.round).sort((a, b) => b.round - a.round)[0];
    const other = previous?.amount ?? o.listing.price ?? o.amount;
    return { min: Math.min(o.amount, other) + 1, max: Math.max(o.amount, other) - 1 };
  }

  private async load(id: string, viewerId: string) {
    const o = await this.prisma.offer.findUnique({ where: { id }, include: offerInclude });
    if (!o) throw new NotFoundException({ message: 'Предложение не найдено' });
    if (o.buyerId !== viewerId && o.sellerId !== viewerId) throw new ForbiddenException({ message: 'Нет доступа' });
    return o;
  }

  private history(o: { listingId: string; buyerId: string; createdAt: Date }) {
    // Rounds of the same negotiation: same listing + buyer, started within the round-1 window.
    return this.prisma.offer.findMany({ where: { listingId: o.listingId, buyerId: o.buyerId }, orderBy: { createdAt: 'desc' }, take: MAX_ROUNDS }).then((rows) => {
      const lastStart = rows.findIndex((r) => r.round === 1);
      return (lastStart === -1 ? rows : rows.slice(0, lastStart + 1)).reverse();
    });
  }

  /** The buyer's current negotiation on a listing (shown on Product instead of the offer button). */
  async forListing(listingId: string, buyerId: string) {
    const latest = await this.prisma.offer.findFirst({ where: { listingId, buyerId }, orderBy: { createdAt: 'desc' }, include: offerInclude });
    if (!latest) return { offer: null };
    return { offer: this.serialize(latest, buyerId, await this.history(latest)) };
  }

  /** AI hint for the side whose turn it is: accept, counter (with an amount in range) or decline. */
  async advice(actorId: string, id: string) {
    const { o, role } = await this.answerable(id, actorId);
    const history = await this.history(o);
    const range = o.round < MAX_ROUNDS ? this.counterRange(o, history) : null;
    return this.negotiation.advise(o, role as 'buyer' | 'seller', history, range, MAX_ROUNDS);
  }

  /** A first offer that is likely to be accepted (shown in the offer sheet). */
  async opening(buyerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'PUBLISHED' || listing.sellerId === buyerId || !listing.acceptsOffers || listing.saleType === 'AUCTION') return { suggestion: null };
    return { suggestion: await this.negotiation.opening(listing) };
  }

  async create(buyerId: string, listingId: string, amount: number) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, include: { seller: { select: { username: true } } } });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listing.sellerId === buyerId) throw new BadRequestException({ message: 'Это ваша вещь' });
    if (listing.status !== 'PUBLISHED' || (!listing.price && !listing.priceNegotiable)) throw new ConflictException({ message: 'Вещь недоступна', code: 'UNAVAILABLE' });
    if (listing.saleType === 'AUCTION') throw new BadRequestException({ message: 'Это аукцион — сделайте ставку', code: 'AUCTION' });
    if (!listing.acceptsOffers) throw new BadRequestException({ message: 'Продавец не принимает предложения цены' });
    // «Цена договорная»: the buyer names the first price, there is nothing to compare it with.
    if (listing.price && amount >= listing.price) throw new BadRequestException({ message: 'Это не меньше цены — просто нажмите «Купить»', code: 'NOT_LOWER', fields: { amount: 'Это не меньше цены продавца' } });
    if (listing.price && amount < Math.ceil(listing.price * MIN_SHARE)) throw new BadRequestException({ message: 'Слишком низкое предложение', fields: { amount: 'Слишком низкое предложение' } });

    const latest = await this.prisma.offer.findFirst({ where: { listingId, buyerId }, orderBy: { createdAt: 'desc' } });
    if (latest?.status === 'PENDING' && latest.expiresAt > new Date()) throw new ConflictException({ message: 'У вас уже есть активное предложение на эту вещь', offerId: latest.id });
    if (latest?.status === 'DECLINED' && Date.now() - latest.updatedAt.getTime() < COOLDOWN_AFTER_DECLINE_MS) {
      throw new ConflictException({ message: 'Новое предложение можно отправить через 24 часа после отказа' });
    }

    // Below the seller's hidden minimum the offer is declined automatically (frame 13 hypothesis).
    const autoDecline = listing.minOfferPrice != null && amount < listing.minOfferPrice;
    const offer = await this.prisma.offer.create({
      data: {
        listingId,
        buyerId,
        sellerId: listing.sellerId,
        round: 1,
        amount,
        from: 'BUYER',
        status: autoDecline ? 'DECLINED' : 'PENDING',
        expiresAt: new Date(Date.now() + OFFER_TTL_MS),
      },
      include: offerInclude,
    });
    this.stats.track(listingId, 'offers');
    if (autoDecline) {
      await this.notifications.notify(buyerId, 'offer_declined', { listingId, title: listing.title, amount, auto: true });
    } else if (listing.autoAcceptPrice != null && amount >= listing.autoAcceptPrice) {
      await this.autoAccept(offer.id, listing.sellerId, buyerId);
      return (await this.forListing(listingId, buyerId)).offer!;
    } else {
      await this.notifications.notify(listing.sellerId, 'offer_new', { offerId: offer.id, listingId, title: listing.title, amount, price: listing.price, buyer: offer.buyer.username });
    }
    return this.serialize(offer, buyerId, [offer]);
  }

  private async answerable(id: string, actorId: string) {
    const o = await this.load(id, actorId);
    const role = o.buyerId === actorId ? 'buyer' : 'seller';
    if (o.status !== 'PENDING') throw new ConflictException({ message: 'Предложение уже неактуально' });
    if (o.expiresAt <= new Date()) throw new ConflictException({ message: 'Срок предложения истёк' });
    const responder = o.from === 'BUYER' ? 'seller' : 'buyer';
    if (role !== responder) throw new ForbiddenException({ message: 'Ждём ответа другой стороны' });
    return { o, role };
  }

  async counter(actorId: string, id: string, amount: number) {
    const { o, role } = await this.answerable(id, actorId);
    if (o.round >= MAX_ROUNDS) throw new BadRequestException({ message: 'Это последний раунд — можно только принять или отклонить' });
    if (o.round === 1 && o.from === 'SELLER') throw new BadRequestException({ message: 'Это скидка от продавца — её можно принять или отклонить' });
    const range = this.counterRange(o, await this.history(o));
    if (amount < range.min || amount > range.max) {
      throw new BadRequestException({ message: `Цена должна быть между ${range.min - 1} и ${range.max + 1} BYN`, fields: { amount: `От ${range.min} до ${range.max} BYN` } });
    }
    const next = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.offer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'COUNTERED' } });
      if (!moved.count) throw new ConflictException({ message: 'Предложение уже неактуально' });
      return tx.offer.create({
        data: {
          listingId: o.listingId,
          buyerId: o.buyerId,
          sellerId: o.sellerId,
          round: o.round + 1,
          amount,
          from: role === 'seller' ? 'SELLER' : 'BUYER',
          expiresAt: new Date(Date.now() + OFFER_TTL_MS),
        },
        include: offerInclude,
      });
    });
    const auto = role === 'buyer' ? await this.prisma.listing.findUnique({ where: { id: o.listingId }, select: { autoAcceptPrice: true } }) : null;
    if (auto?.autoAcceptPrice != null && amount >= auto.autoAcceptPrice) {
      await this.autoAccept(next.id, o.sellerId, o.buyerId);
      return (await this.forListing(o.listingId, actorId)).offer!;
    }
    const to = role === 'seller' ? o.buyerId : o.sellerId;
    await this.notifications.notify(to, 'offer_countered', { offerId: next.id, listingId: o.listingId, title: o.listing.title, amount, by: role === 'seller' ? o.seller.username : o.buyer.username });
    return this.serialize(next, actorId, await this.history(next));
  }

  async accept(actorId: string, id: string) {
    const { o, role } = await this.answerable(id, actorId);
    const request = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.offer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
      if (!moved.count) throw new ConflictException({ message: 'Предложение уже неактуально' });
      const r = await this.requests.createFromOffer(tx, { listingId: o.listingId, buyerId: o.buyerId, sellerId: o.sellerId, amount: o.amount, acceptedBy: actorId });
      await tx.offer.update({ where: { id }, data: { requestId: r.id } });
      // Other buyers' open offers on this item are void.
      await tx.offer.updateMany({ where: { listingId: o.listingId, status: 'PENDING', id: { not: id } }, data: { status: 'CANCELLED' } });
      return r;
    });
    await this.requests.afterOfferAccepted(request.id, o.listingId, o.buyerId, o.listing.title);
    const to = role === 'seller' ? o.buyerId : o.sellerId;
    await this.notifications.notify(to, 'offer_accepted', { offerId: id, requestId: request.id, listingId: o.listingId, title: o.listing.title, amount: o.amount });
    return { ...this.serialize({ ...o, status: 'ACCEPTED', requestId: request.id }, actorId, await this.history(o)), requestId: request.id };
  }

  /** The seller's auto-accept threshold was met: accepted on the seller's behalf, who is told about the deal. */
  private async autoAccept(offerId: string, sellerId: string, buyerId: string) {
    const r = await this.accept(sellerId, offerId);
    const buyer = await this.prisma.user.findUnique({ where: { id: buyerId }, select: { username: true } });
    await this.notifications.notify(sellerId, 'offer_auto_accepted', { offerId, requestId: r.requestId, listingId: r.listing.id, title: r.listing.title, amount: r.amount, buyer: buyer?.username });
  }

  /** How many people a "скидка лайкнувшим" would reach, and when it's available again. */
  async likersInfo(sellerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { sellerId: true, likersOfferAt: true } });
    if (!listing || listing.sellerId !== sellerId) throw new NotFoundException({ message: 'Такой вещи нет' });
    const recipients = await this.likers(listingId, sellerId);
    const nextAt = listing.likersOfferAt ? new Date(listing.likersOfferAt.getTime() + LIKERS_COOLDOWN_MS) : null;
    return { count: recipients.length, nextAt: nextAt && nextAt > new Date() ? nextAt : null };
  }

  /** People who saved the item and aren't already negotiating on it. */
  private async likers(listingId: string, sellerId: string) {
    const [favs, busy] = await Promise.all([
      this.prisma.favorite.findMany({ where: { listingId, userId: { not: sellerId }, user: { deletedAt: null, blockedAt: null } }, select: { userId: true } }),
      this.prisma.offer.findMany({ where: { listingId, status: 'PENDING', expiresAt: { gt: new Date() } }, select: { buyerId: true } }),
    ]);
    const skip = new Set(busy.map((b) => b.buyerId));
    return favs.map((f) => f.userId).filter((u) => !skip.has(u));
  }

  /**
   * "Скидка лайкнувшим" (Poshmark/Depop "offer to likers"): a personal lower price for everyone who saved
   * the item, valid 48 h. Each gets an ordinary offer from the seller, so accepting it opens a normal deal.
   */
  async offerLikers(sellerId: string, listingId: string, amount: number) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.sellerId !== sellerId || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listing.status !== 'PUBLISHED' || !listing.price) throw new ConflictException({ message: 'Скидку можно отправить только по вещи в продаже' });
    if (listing.saleType === 'AUCTION') throw new BadRequestException({ message: 'Для аукциона скидка не отправляется' });
    if (amount >= listing.price) throw new BadRequestException({ message: 'Цена со скидкой должна быть ниже текущей', fields: { amount: 'Ниже текущей цены' } });
    if (amount < Math.ceil(listing.price * 0.5)) throw new BadRequestException({ message: 'Скидка больше 50% — лучше просто снизить цену', fields: { amount: 'Не ниже 50% цены' } });
    if (listing.likersOfferAt && Date.now() - listing.likersOfferAt.getTime() < LIKERS_COOLDOWN_MS) {
      throw new ConflictException({ message: 'Скидку лайкнувшим можно отправлять раз в 3 дня' });
    }
    const recipients = await this.likers(listingId, sellerId);
    if (!recipients.length) throw new ConflictException({ message: 'Пока некому отправить: вещь никто не добавил в избранное' });

    const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
    // Guarded on likersOfferAt, so two clicks can't send two mailings.
    const { count } = await this.prisma.listing.updateMany({ where: { id: listingId, likersOfferAt: listing.likersOfferAt }, data: { likersOfferAt: new Date() } });
    if (!count) throw new ConflictException({ message: 'Скидка уже отправлена' });
    await this.prisma.offer.createMany({
      data: recipients.map((buyerId) => ({ listingId, buyerId, sellerId, round: 1, amount, from: 'SELLER' as const, expiresAt })),
    });
    const seller = await this.prisma.user.findUnique({ where: { id: sellerId }, select: { username: true } });
    await this.notifications.notifyMany(recipients, 'offer_likers', { listingId, title: listing.title, amount, price: listing.price, seller: seller?.username });
    return { sent: recipients.length };
  }

  async decline(actorId: string, id: string) {
    const { o, role } = await this.answerable(id, actorId);
    await this.prisma.offer.update({ where: { id }, data: { status: 'DECLINED' } });
    const to = role === 'seller' ? o.buyerId : o.sellerId;
    await this.notifications.notify(to, 'offer_declined', { offerId: id, listingId: o.listingId, title: o.listing.title, amount: o.amount });
    return { ok: true };
  }

  /** The side that made the latest offer may withdraw it. */
  async cancel(actorId: string, id: string) {
    const o = await this.load(id, actorId);
    const role = o.buyerId === actorId ? 'buyer' : 'seller';
    if (o.status !== 'PENDING' || (o.from === 'BUYER') !== (role === 'buyer')) throw new ConflictException({ message: 'Это предложение нельзя отменить' });
    await this.prisma.offer.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  /** Offers waiting for my answer (seller: incoming; buyer: counter-offers) or all my negotiations. */
  async list(userId: string, role: 'seller' | 'buyer', onlyMyTurn: boolean) {
    const rows = await this.prisma.offer.findMany({
      where: {
        ...(role === 'seller' ? { sellerId: userId } : { buyerId: userId }),
        ...(onlyMyTurn ? { status: 'PENDING', from: role === 'seller' ? 'BUYER' : 'SELLER', expiresAt: { gt: new Date() } } : { status: { in: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] } }),
      },
      include: offerInclude,
      orderBy: { createdAt: onlyMyTurn ? 'asc' : 'desc' },
      take: 50,
    });
    // Collapse rounds: only the latest round per negotiation.
    const seen = new Set<string>();
    const latest = rows.filter((r) => {
      const key = `${r.listingId}:${r.buyerId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { items: await Promise.all(latest.map(async (o) => this.serialize(o, userId, await this.history(o)))) };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expire() {
    const stale = await this.prisma.offer.findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, include: { listing: { select: { title: true } } } });
    for (const o of stale) {
      const { count } = await this.prisma.offer.updateMany({ where: { id: o.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      // Unanswered "скидка лайкнувшим" offers expire quietly: one note per liker would flood the seller.
      if (count && !(o.round === 1 && o.from === 'SELLER')) await this.notifications.notify(o.from === 'BUYER' ? o.buyerId : o.sellerId, 'offer_expired', { offerId: o.id, listingId: o.listingId, title: o.listing.title, amount: o.amount });
    }
    if (stale.length) this.logger.log(`expired ${stale.length} offers`);
  }
}

const AmountDto = z.object({ amount: z.coerce.number().int('Целое число').min(1, 'Введите сумму') });
const CreateDto = AmountDto.extend({ listingId: z.uuid() });

@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateDto)) dto: z.infer<typeof CreateDto>) {
    return this.offers.create(user.id, dto.listingId, dto.amount);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('role') role = 'seller', @Query('turn') turn?: string) {
    return this.offers.list(user.id, role === 'buyer' ? 'buyer' : 'seller', turn === 'mine');
  }

  @Get('likers/:listingId')
  likersInfo(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.offers.likersInfo(user.id, listingId);
  }

  @Post('likers/:listingId')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  offerLikers(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string, @Body(new ZodPipe(AmountDto)) dto: z.infer<typeof AmountDto>) {
    return this.offers.offerLikers(user.id, listingId, dto.amount);
  }

  @Get('listing/:listingId')
  forListing(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.offers.forListing(listingId, user.id);
  }

  @Get('opening/:listingId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  opening(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.offers.opening(user.id, listingId);
  }

  @Get(':id/advice')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  advice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.advice(user.id, id);
  }

  @Post(':id/counter')
  @HttpCode(200)
  counter(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AmountDto)) dto: z.infer<typeof AmountDto>) {
    return this.offers.counter(user.id, id, dto.amount);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.accept(user.id, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.decline(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.cancel(user.id, id);
  }
}
