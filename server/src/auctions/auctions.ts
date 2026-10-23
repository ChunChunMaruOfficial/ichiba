import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { withJobLock } from '../common/job-lock.js';
import { ZodPipe } from '../common/zod.js';
import type { Auction, AuctionStatus, Bid, Listing, Prisma } from '../generated/prisma/client.js';
import { auctionInclude, buyNowAvailable, EXTEND_WINDOW_MS, serializeAuction, WINNER_REPLY_MS } from './rules.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';

/** Highest bid or auto-bid limit accepted at all: keeps amounts far from int4 and stops absurd griefing bids. */
const MAX_AMOUNT = 1_000_000;

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger('Auctions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
    private readonly redis: RedisService,
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

  /** Serialises all bidding on one auction: concurrent bids queue up instead of racing. */
  private async lock(tx: Prisma.TransactionClient, auctionId: string) {
    await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    const a = await tx.auction.findUnique({ where: { id: auctionId }, include: { listing: { select: { id: true, title: true, sellerId: true, status: true, deliveryOptions: true } } } });
    if (!a) throw new NotFoundException({ message: 'Аукцион не найден' });
    if (a.status !== 'ACTIVE' || a.endsAt <= new Date() || a.listing.status !== 'PUBLISHED') throw new ConflictException({ message: 'Аукцион уже завершён' });
    return a;
  }

  /** Row lock for the closing job: unlike `lock`, it doesn't refuse an auction that has already ended. */
  private async lockForClose(tx: Prisma.TransactionClient, auctionId: string) {
    await tx.$queryRaw`SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    return tx.auction.findUnique({ where: { id: auctionId }, include: { listing: true } });
  }

  private top(tx: Prisma.TransactionClient, auctionId: string) {
    return tx.bid.findFirst({ where: { auctionId }, orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }] });
  }

  /**
   * Proxy bidding (eBay-style): every active auto-bid answers a higher bid automatically, one step above
   * the strongest competitor, never above its own limit. On equal limits the earlier one wins.
   * Returns the auto-bids that ran out (their owners were outbid).
   */
  private async resolveProxies(tx: Prisma.TransactionClient, a: { id: string; step: number }) {
    const exhausted = new Set<string>();
    for (let guard = 0; guard < 50; guard++) {
      const top = await this.top(tx, a.id);
      if (!top) break;
      const autos = await tx.autoBid.findMany({ where: { auctionId: a.id, active: true }, orderBy: [{ maxAmount: 'desc' }, { createdAt: 'asc' }] });
      const leaderAuto = autos.find((x) => x.bidderId === top.bidderId);
      const leaderMax = Math.max(top.amount, leaderAuto?.maxAmount ?? 0);
      const challenger = autos.find((x) => x.bidderId !== top.bidderId && x.maxAmount >= top.amount + a.step);
      // Auto-bids that can no longer beat the current price are done.
      for (const x of autos) {
        if (x.bidderId !== top.bidderId && x.maxAmount < top.amount + a.step) {
          await tx.autoBid.update({ where: { id: x.id }, data: { active: false } });
          exhausted.add(x.bidderId);
        }
      }
      if (!challenger) break;
      if (challenger.maxAmount > leaderMax) {
        // Challenger takes the lead at one step above what the leader can pay.
        const amount = Math.max(top.amount + a.step, Math.min(challenger.maxAmount, leaderMax + a.step));
        await tx.bid.create({ data: { auctionId: a.id, bidderId: challenger.bidderId, amount, auto: true } });
        if (leaderAuto) {
          await tx.autoBid.update({ where: { id: leaderAuto.id }, data: { active: false } });
          exhausted.add(leaderAuto.bidderId);
        }
      } else {
        // Leader holds: the challenger's limit is shown as their bid, the leader answers one step above.
        if (challenger.maxAmount < leaderMax) {
          await tx.bid.create({ data: { auctionId: a.id, bidderId: challenger.bidderId, amount: challenger.maxAmount, auto: true } });
          await tx.bid.create({ data: { auctionId: a.id, bidderId: top.bidderId, amount: Math.min(leaderMax, challenger.maxAmount + a.step), auto: true } });
        } else {
          // Equal limits: the earlier leader wins at that price.
          await tx.bid.create({ data: { auctionId: a.id, bidderId: top.bidderId, amount: leaderMax, auto: true } });
        }
        await tx.autoBid.update({ where: { id: challenger.id }, data: { active: false } });
        exhausted.add(challenger.bidderId);
      }
    }
    return exhausted;
  }

  /**
   * A bid. With maxAmount the user sets an auto-bid: the system bids the minimum needed now and keeps
   * answering for them up to maxAmount (the leader may raise their limit without bidding against themselves).
   */
  async bid(userId: string, auctionId: string, input: { amount?: number; maxAmount?: number }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const a = await this.lock(tx, auctionId);
      if (a.listing.sellerId === userId) throw new ForbiddenException({ message: 'Нельзя делать ставки на свою вещь' });
      const before = await this.top(tx, auctionId);
      const minBid = before ? before.amount + a.step : a.startPrice;
      const leading = before?.bidderId === userId;
      // A bid far above anything the item could fetch is a typo or griefing: capped by the buy-now price, or 50× the start.
      const ceiling = Math.min(a.buyNowPrice ?? a.startPrice * 50, MAX_AMOUNT);
      const tooHigh = (field: 'amount' | 'maxAmount') => new BadRequestException({ message: `Слишком большая сумма — не больше ${ceiling} BYN`, fields: { [field]: `Не больше ${ceiling} BYN` } });

      if (input.maxAmount != null) {
        const floor = leading ? before!.amount + a.step : minBid;
        if (input.maxAmount < floor) throw new BadRequestException({ message: `Лимит автоставки — от ${floor} BYN`, fields: { maxAmount: `Не меньше ${floor} BYN` }, minBid: floor });
        if (a.buyNowPrice != null && input.maxAmount >= a.buyNowPrice && buyNowAvailable(a, before?.amount ?? null)) {
          throw new BadRequestException({ message: `Лимит не меньше цены «Купить сейчас» — просто выкупите вещь за ${a.buyNowPrice} BYN`, fields: { maxAmount: 'Выше цены «Купить сейчас»' }, code: 'USE_BUY_NOW' });
        }
        if (input.maxAmount > ceiling) throw tooHigh('maxAmount');
        await tx.autoBid.upsert({
          where: { auctionId_bidderId: { auctionId, bidderId: userId } },
          create: { auctionId, bidderId: userId, maxAmount: input.maxAmount },
          update: { maxAmount: input.maxAmount, active: true },
        });
        if (!leading) await tx.bid.create({ data: { auctionId, bidderId: userId, amount: minBid } });
      } else {
        const amount = input.amount ?? minBid;
        if (amount < minBid) throw new BadRequestException({ message: `Минимальная ставка — ${minBid} BYN`, fields: { amount: `Не меньше ${minBid} BYN` }, minBid });
        if (amount > ceiling) throw tooHigh('amount');
        if (leading) throw new ConflictException({ message: 'Ваша ставка уже самая высокая' });
        await tx.bid.create({ data: { auctionId, bidderId: userId, amount } });
      }

      const exhausted = await this.resolveProxies(tx, a);
      const after = (await this.top(tx, auctionId))!;
      // Anti-sniping: any bid in the last 5 minutes pushes the end 5 minutes out.
      if (after.id !== before?.id && a.endsAt.getTime() - Date.now() < EXTEND_WINDOW_MS) {
        await tx.auction.update({ where: { id: auctionId }, data: { endsAt: new Date(Date.now() + EXTEND_WINDOW_MS), extendedTimes: { increment: 1 } } });
      }
      return { a, before, after, exhausted };
    });

    const { a, before, after, exhausted } = result;
    if (after.id !== before?.id) {
      const bidder = await this.prisma.user.findUniqueOrThrow({ where: { id: after.bidderId }, select: { username: true } });
      await this.notifications.notify(a.listing.sellerId, 'auction_bid', { listingId: a.listing.id, title: a.listing.title, amount: after.amount, bidder: bidder.username });
      // Everyone who was leading or whose auto-bid ran out, but isn't the leader now, has been outbid.
      const outbid = new Set([...exhausted, ...(before ? [before.bidderId] : [])]);
      outbid.delete(after.bidderId);
      for (const uid of outbid) {
        await this.notifications.notify(uid, 'auction_outbid', { listingId: a.listing.id, title: a.listing.title, amount: after.amount, auto: exhausted.has(uid) });
      }
    }
    return this.forListing(a.listing.id, userId);
  }

  async cancelAutoBid(userId: string, auctionId: string) {
    await this.prisma.autoBid.updateMany({ where: { auctionId, bidderId: userId, active: true }, data: { active: false } });
    return this.forListing((await this.prisma.auction.findUniqueOrThrow({ where: { id: auctionId } })).listingId, userId);
  }

  /** "Купить сейчас": ends the auction at the buy-now price, while bids are below 75% of it. */
  async buyNow(userId: string, auctionId: string) {
    const { a, request, bidders } = await this.prisma.$transaction(async (tx) => {
      const a = await this.lock(tx, auctionId);
      if (a.listing.sellerId === userId) throw new ForbiddenException({ message: 'Это ваша вещь' });
      const top = await this.top(tx, auctionId);
      if (!buyNowAvailable(a, top?.amount ?? null)) throw new ConflictException({ message: 'Выкуп уже недоступен — торги слишком близко к цене выкупа', code: 'BUY_NOW_UNAVAILABLE' });
      const bid = await tx.bid.create({ data: { auctionId, bidderId: userId, amount: a.buyNowPrice!, isBuyNow: true } });
      await tx.autoBid.updateMany({ where: { auctionId, active: true }, data: { active: false } });
      const request = await this.awardTx(tx, a, bid, 'Выкуп по цене «Купить сейчас»');
      const bidders = await tx.bid.findMany({ where: { auctionId, bidderId: { not: userId } }, select: { bidderId: true }, distinct: ['bidderId'] });
      return { a, request, bidders };
    });
    await this.listings.declinePendingRequests(a.listingId, 'Вещь выкупили');
    await this.notifications.notify(userId, 'auction_won', { listingId: a.listingId, requestId: request.id, title: a.listing.title, amount: a.buyNowPrice, buyNow: true });
    await this.notifications.notify(a.listing.sellerId, 'auction_sold', { listingId: a.listingId, requestId: request.id, title: a.listing.title, amount: a.buyNowPrice, buyNow: true });
    await this.notifications.notifyMany(bidders.map((b) => b.bidderId), 'auction_bought_out', { listingId: a.listingId, title: a.listing.title, amount: a.buyNowPrice });
    return { requestId: request.id, ...(await this.forListing(a.listingId, userId)) };
  }

  async forListing(listingId: string, viewerId?: string) {
    const a = await this.latestFor(listingId);
    if (!a) return { auction: null };
    const l = await this.prisma.listing.findUniqueOrThrow({ where: { id: listingId }, select: { sellerId: true } });
    return { auction: serializeAuction(a, viewerId, l.sellerId) };
  }

  /** The seller may cancel only while nobody has bid; the item becomes a fixed-price listing. */
  async cancel(sellerId: string, auctionId: string) {
    // Under the row lock bids queue behind us, so a bid can't slip in between the count and the cancel.
    await this.prisma.$transaction(async (tx) => {
      const a = await this.lockForClose(tx, auctionId);
      if (!a || a.listing.sellerId !== sellerId) throw new NotFoundException({ message: 'Аукцион не найден' });
      if (a.status !== 'ACTIVE') throw new ConflictException({ message: 'Аукцион уже завершён' });
      if ((await tx.bid.count({ where: { auctionId } })) > 0) throw new ConflictException({ message: 'Уже есть ставки — аукцион нельзя отменить' });
      const { count } = await tx.auction.updateMany({ where: { id: auctionId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      if (!count) throw new ConflictException({ message: 'Аукцион уже завершён' });
      await tx.listing.update({ where: { id: a.listingId }, data: { saleType: 'FIXED' } });
    });
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

  /** Winner's deal inside a transaction: item reserved, buyer picks delivery within 48 h. */
  private async awardTx(
    tx: Prisma.TransactionClient,
    a: Pick<Auction, 'id' | 'listingId'> & { listing: { sellerId: string; deliveryOptions: Listing['deliveryOptions'] } },
    bid: Bid,
    reason: string,
    runnerUp = false,
  ) {
    if (!runnerUp) {
      const reserved = await tx.listing.updateMany({ where: { id: a.listingId, status: 'PUBLISHED' }, data: { status: 'RESERVED' } });
      if (!reserved.count) throw new ConflictException({ message: 'Вещь уже недоступна', code: 'UNAVAILABLE' });
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
        events: { create: [{ status: 'CREATED', byUserId: bid.bidderId }, { status: 'ACCEPTED', reason }] },
      },
    });
    // A first award closes a running auction; a runner-up award re-assigns one already sold. Anything else means
    // another run got there first, and the whole transaction (reservation and deal included) is rolled back.
    const { count } = await tx.auction.updateMany({ where: { id: a.id, status: runnerUp ? 'SOLD' : 'ACTIVE' }, data: { status: 'SOLD', requestId: r.id } });
    if (!count) throw new ConflictException({ message: 'Аукцион уже завершён' });
    return r;
  }

  /** Tells the winner (or runner-up) and the seller about the deal created by `awardTx`. */
  private async notifyAward(a: Auction & { listing: Listing }, bid: Bid, requestId: string, runnerUp: boolean) {
    await this.notifications.notify(bid.bidderId, runnerUp ? 'auction_runner_up' : 'auction_won', { listingId: a.listingId, requestId, title: a.listing.title, amount: bid.amount });
    await this.notifications.notify(a.listing.sellerId, 'auction_sold', { listingId: a.listingId, requestId, title: a.listing.title, amount: bid.amount, runnerUp });
  }

  /**
   * No bids, reserve not met or no buyer: the auction (still in status `from`) ends and the item stays on sale at a
   * fixed price. Returns false when another run already moved it.
   */
  private async noSaleTx(tx: Prisma.TransactionClient, a: Pick<Auction, 'id' | 'listingId'>, from: AuctionStatus) {
    const { count } = await tx.auction.updateMany({ where: { id: a.id, status: from }, data: { status: 'NO_SALE' } });
    if (!count) return false;
    await tx.listing.updateMany({ where: { id: a.listingId, status: { in: ['PUBLISHED', 'RESERVED'] } }, data: { status: 'PUBLISHED', saleType: 'FIXED' } });
    return true;
  }

  private async notifyNoSale(a: Auction & { listing: Listing }, reason: 'no_bids' | 'reserve' | 'no_show') {
    await this.notifications.notify(a.listing.sellerId, 'auction_no_sale', { listingId: a.listingId, title: a.listing.title, reason });
    if (reason === 'reserve') {
      const bidders = await this.prisma.bid.findMany({ where: { auctionId: a.id }, select: { bidderId: true }, distinct: ['bidderId'] });
      await this.notifications.notifyMany(bidders.map((b) => b.bidderId), 'auction_no_sale', { listingId: a.listingId, title: a.listing.title, reason });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  closeEnded() {
    return withJobLock(this.redis, 'auctions.closeEnded', 60_000, () => this.closeEndedNow());
  }

  /**
   * One ended auction, settled under its row lock and re-read inside the transaction: a bid that landed (and maybe
   * extended the end) after the list was loaded is never ignored, and a concurrent buy-now or cancel wins cleanly.
   */
  private async closeOne(auctionId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const a = await this.lockForClose(tx, auctionId);
      if (!a || a.status !== 'ACTIVE' || a.endsAt >= new Date()) return null;
      const top = await this.top(tx, a.id);
      if (!top || (a.reservePrice != null && top.amount < a.reservePrice)) {
        return (await this.noSaleTx(tx, a, 'ACTIVE')) ? ({ kind: 'no_sale', a, reason: top ? 'reserve' : 'no_bids' } as const) : null;
      }
      const request = await this.awardTx(tx, a, top, 'Победа в аукционе');
      return { kind: 'sold', a, top, requestId: request.id } as const;
    });
    if (!outcome) return;
    if (outcome.kind === 'no_sale') return this.notifyNoSale(outcome.a, outcome.reason);
    await this.notifyAward(outcome.a, outcome.top, outcome.requestId, false);
    await this.listings.declinePendingRequests(outcome.a.listingId, 'Вещь ушла с аукциона');
  }

  private async closeEndedNow() {
    const ended = await this.prisma.auction.findMany({ where: { status: 'ACTIVE', endsAt: { lt: new Date() } }, select: { id: true }, orderBy: { endsAt: 'asc' }, take: 200 });
    for (const a of ended) {
      try {
        await this.closeOne(a.id);
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
        (b) => !b.isBuyNow && !triedIds.has(b.bidderId) && (a.reservePrice == null || b.amount >= a.reservePrice),
      );
      try {
        if (next) {
          const request = await this.prisma.$transaction(async (tx) => {
            await tx.auction.updateMany({ where: { id: a.id, status: 'SOLD' }, data: { requestId: null } });
            return this.awardTx(tx, a, next, 'Второе место в аукционе', true);
          });
          await this.notifyAward(a, next, request.id, true);
        } else if (await this.prisma.$transaction((tx) => this.noSaleTx(tx, a, 'SOLD'))) {
          await this.notifyNoSale(a, 'no_show');
          await this.listings.notifyWatchers(a.listingId, 'item_available', a.listing.title);
        }
      } catch (e) {
        this.logger.warn(`runner-up ${a.id}: ${(e as Error).message}`);
      }
    }
    if (ended.length || silent.length) this.logger.log(`closed ${ended.length} auctions, ${silent.length} silent winners`);
  }
}

const BidDto = z
  .object({
    amount: z.coerce.number().int('Целое число').min(1, 'Введите сумму').max(MAX_AMOUNT, 'Слишком большая сумма').optional(),
    maxAmount: z.coerce.number().int('Целое число').min(1, 'Введите лимит').max(MAX_AMOUNT, 'Слишком большой лимит').optional(),
  })
  .refine((d) => d.amount != null || d.maxAmount != null, { message: 'Введите сумму', path: ['amount'] });

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
    return this.auctions.bid(user.id, id, dto);
  }

  @Delete(':id/autobid')
  cancelAutoBid(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auctions.cancelAutoBid(user.id, id);
  }

  @Post(':id/buy-now')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  buyNow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auctions.buyNow(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auctions.cancel(user.id, id);
  }
}

