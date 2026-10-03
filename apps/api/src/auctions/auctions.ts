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
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { Auction, Bid, Listing } from '../generated/prisma/client.js';
import { auctionInclude, EXTEND_WINDOW_MS, serializeAuction, WINNER_REPLY_MS } from './rules.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger('Auctions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
  ) {}

  activeFor(listingId: string) {
    return this.prisma.auction.findFirst({ where: { listingId, status: 'ACTIVE' } });
  }

  latestFor(listingId: string) {
    return this.prisma.auction.findFirst({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      include: auctionInclude,
    });
  }

  async bid(userId: string, auctionId: string, amount: number) {
    const result = await this.prisma.$transaction(async (tx) => {
      const a = await tx.auction.findUnique({ where: { id: auctionId }, include: { listing: { select: { id: true, title: true, sellerId: true, status: true } } } });
      if (!a) throw new NotFoundException({ message: 'Аукцион не найден' });
      if (a.status !== 'ACTIVE' || a.endsAt <= new Date() || a.listing.status !== 'PUBLISHED') throw new ConflictException({ message: 'Аукцион уже завершён' });
      if (a.listing.sellerId === userId) throw new ForbiddenException({ message: 'Нельзя делать ставки на свою вещь' });
      const top = await tx.bid.findFirst({ where: { auctionId }, orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }] });
      const minBid = top ? top.amount + a.step : a.startPrice;
      if (amount < minBid) throw new BadRequestException({ message: `Минимальная ставка — ${minBid} BYN`, fields: { amount: `Не меньше ${minBid} BYN` }, minBid });
      if (top?.bidderId === userId) throw new ConflictException({ message: 'Ваша ставка уже самая высокая' });
      const bid = await tx.bid.create({ data: { auctionId, bidderId: userId, amount } });
      // Anti-sniping: a bid in the last 5 minutes pushes the end 5 minutes out.
      const left = a.endsAt.getTime() - Date.now();
      let endsAt = a.endsAt;
      if (left < EXTEND_WINDOW_MS) {
        endsAt = new Date(Date.now() + EXTEND_WINDOW_MS);
        await tx.auction.update({ where: { id: auctionId }, data: { endsAt, extendedTimes: { increment: 1 } } });
      }
      return { a, bid, previousLeader: top?.bidderId ?? null, endsAt };
    });

    const { a, previousLeader } = result;
    const bidder = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
    await this.notifications.notify(a.listing.sellerId, 'auction_bid', { listingId: a.listing.id, title: a.listing.title, amount, bidder: bidder.username });
    if (previousLeader && previousLeader !== userId) {
      await this.notifications.notify(previousLeader, 'auction_outbid', { listingId: a.listing.id, title: a.listing.title, amount });
    }
    return this.forListing(a.listing.id, userId);
  }

  async forListing(listingId: string, viewerId?: string) {
    const a = await this.latestFor(listingId);
    if (!a) return { auction: null };
    const l = await this.prisma.listing.findUniqueOrThrow({ where: { id: listingId }, select: { sellerId: true } });
    return { auction: serializeAuction(a, viewerId, l.sellerId) };
  }

  /** The seller may cancel only while nobody has bid; the item becomes a fixed-price listing. */
  async cancel(sellerId: string, auctionId: string) {
    const a = await this.prisma.auction.findUnique({ where: { id: auctionId }, include: { listing: true, _count: { select: { bids: true } } } });
    if (!a || a.listing.sellerId !== sellerId) throw new NotFoundException({ message: 'Аукцион не найден' });
    if (a.status !== 'ACTIVE') throw new ConflictException({ message: 'Аукцион уже завершён' });
    if (a._count.bids > 0) throw new ConflictException({ message: 'Уже есть ставки — аукцион нельзя отменить' });
    await this.prisma.$transaction([
      this.prisma.auction.update({ where: { id: auctionId }, data: { status: 'CANCELLED' } }),
      this.prisma.listing.update({ where: { id: a.listingId }, data: { saleType: 'FIXED' } }),
    ]);
    return { ok: true };
  }

  /** Auctions I bid on, newest first, with my position. */
  async mine(userId: string) {
    const bids = await this.prisma.bid.findMany({ where: { bidderId: userId }, select: { auctionId: true }, distinct: ['auctionId'], orderBy: { createdAt: 'desc' }, take: 50 });
    const auctions = await this.prisma.auction.findMany({
      where: { id: { in: bids.map((b) => b.auctionId) } },
      include: { listing: { include: cardInclude }, ...auctionInclude },
    });
    const order = new Map(bids.map((b, i) => [b.auctionId, i]));
    return {
      items: auctions
        .sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0))
        .map((a) => ({ listing: serializeCard(a.listing), auction: serializeAuction(a, userId, a.listing.sellerId) })),
    };
  }

  // ---------- closing (decision D16) ----------

  /** Creates the winner's deal: item reserved, buyer picks delivery within 48 h (same as an accepted offer). */
  private async awardTo(a: Auction & { listing: Listing }, bid: Bid, runnerUp: boolean) {
    const request = await this.prisma.$transaction(async (tx) => {
      if (!runnerUp) {
        const reserved = await tx.listing.updateMany({ where: { id: a.listingId, status: 'PUBLISHED' }, data: { status: 'RESERVED' } });
        if (!reserved.count) throw new Error('listing no longer available');
      }
      const r = await tx.buyRequest.create({
        data: {
          buyerId: bid.bidderId,
          sellerId: a.listing.sellerId,
          priceTotal: bid.amount,
          source: 'AUCTION',
          deliveryMethod: a.listing.deliveryOptions[0] ?? 'IN_PERSON',
          status: 'ACCEPTED',
          expiresAt: new Date(Date.now() + WINNER_REPLY_MS),
          items: { create: [{ listingId: a.listingId, price: bid.amount }] },
          events: { create: [{ status: 'CREATED', byUserId: bid.bidderId }, { status: 'ACCEPTED', reason: runnerUp ? 'Второе место в аукционе' : 'Победа в аукционе' }] },
        },
      });
      await tx.auction.update({ where: { id: a.id }, data: { status: 'SOLD', requestId: r.id } });
      return r;
    });
    await this.notifications.notify(bid.bidderId, runnerUp ? 'auction_runner_up' : 'auction_won', { listingId: a.listingId, requestId: request.id, title: a.listing.title, amount: bid.amount });
    await this.notifications.notify(a.listing.sellerId, 'auction_sold', { listingId: a.listingId, requestId: request.id, title: a.listing.title, amount: bid.amount, runnerUp });
    return request;
  }

  /** No bids or reserve not met: the auction ends and the item stays on sale at its start price. */
  private async noSale(a: Auction & { listing: Listing }, reason: 'no_bids' | 'reserve' | 'no_show') {
    await this.prisma.$transaction([
      this.prisma.auction.update({ where: { id: a.id }, data: { status: 'NO_SALE' } }),
      this.prisma.listing.updateMany({ where: { id: a.listingId, status: { in: ['PUBLISHED', 'RESERVED'] } }, data: { status: 'PUBLISHED', saleType: 'FIXED' } }),
    ]);
    await this.notifications.notify(a.listing.sellerId, 'auction_no_sale', { listingId: a.listingId, title: a.listing.title, reason });
    if (reason === 'reserve') {
      const bidders = await this.prisma.bid.findMany({ where: { auctionId: a.id }, select: { bidderId: true }, distinct: ['bidderId'] });
      await this.notifications.notifyMany(bidders.map((b) => b.bidderId), 'auction_no_sale', { listingId: a.listingId, title: a.listing.title, reason });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async closeEnded() {
    const ended = await this.prisma.auction.findMany({ where: { status: 'ACTIVE', endsAt: { lt: new Date() } }, include: { listing: true } });
    for (const a of ended) {
      try {
        const top = await this.prisma.bid.findFirst({ where: { auctionId: a.id }, orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }] });
        if (!top) await this.noSale(a, 'no_bids');
        else if (a.reservePrice != null && top.amount < a.reservePrice) await this.noSale(a, 'reserve');
        else {
          await this.awardTo(a, top, false);
          await this.listings.declinePendingRequests(a.listingId, 'Вещь ушла с аукциона');
        }
      } catch (e) {
        this.logger.warn(`close ${a.id}: ${(e as Error).message}`);
      }
    }

    // Winner silent for 48 h → offer it to the next-highest bidder (above the reserve), else back on sale.
    const silent = await this.prisma.buyRequest.findMany({
      where: { source: 'AUCTION', status: 'ACCEPTED', expiresAt: { lt: new Date() } },
      include: { auction: { include: { listing: true } } },
    });
    for (const r of silent) {
      const a = r.auction;
      if (!a) continue;
      const { count } = await this.prisma.buyRequest.updateMany({ where: { id: r.id, status: 'ACCEPTED' }, data: { status: 'CANCELLED', reason: 'Победитель не выбрал способ получения за 48 часов', expiresAt: null } });
      if (!count) continue;
      await this.prisma.buyRequestEvent.create({ data: { requestId: r.id, status: 'CANCELLED', reason: 'Победитель не выбрал способ получения за 48 часов' } });
      await this.notifications.notify(r.buyerId, 'request_expired', { requestId: r.id, title: a.listing.title });
      const tried = await this.prisma.buyRequest.findMany({ where: { items: { some: { listingId: a.listingId } }, source: 'AUCTION' }, select: { buyerId: true } });
      const triedIds = new Set(tried.map((t) => t.buyerId));
      const next = (await this.prisma.bid.findMany({ where: { auctionId: a.id }, orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }] })).find(
        (b) => !triedIds.has(b.bidderId) && (a.reservePrice == null || b.amount >= a.reservePrice),
      );
      if (next) {
        await this.prisma.auction.update({ where: { id: a.id }, data: { requestId: null } });
        await this.awardTo(a, next, true);
      } else {
        await this.noSale(a, 'no_show');
        await this.listings.notifyWatchers(a.listingId, 'item_available', a.listing.title);
      }
    }
    if (ended.length || silent.length) this.logger.log(`closed ${ended.length} auctions, ${silent.length} silent winners`);
  }
}

const BidDto = z.object({ amount: z.coerce.number().int('Целое число').min(1, 'Введите сумму') });

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.auctions.mine(user.id);
  }

  @Post(':id/bids')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  bid(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(BidDto)) dto: z.infer<typeof BidDto>) {
    return this.auctions.bid(user.id, id, dto.amount);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auctions.cancel(user.id, id);
  }
}

