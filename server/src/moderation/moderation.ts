import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ADMIN_COOKIE, AuthUser, CurrentUser, forgetSessionStatus } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { Prisma, ReportStatus } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { ListingsService, marketOf } from '../listings/listings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Reasons offered in the report modal (frame 20). */
const REPORT_REASONS = {
  LISTING: ['Подделка или копия бренда', 'Запрещённый товар', 'Фото не соответствует вещи', 'Мошенничество', 'Оскорбительное содержание', 'Другое'],
  USER: ['Мошенничество', 'Оскорбления в чате', 'Не выходит на связь после сделки', 'Спам', 'Другое'],
  REVIEW: ['Оскорбления', 'Ложная информация', 'Отзыв не о сделке', 'Спам', 'Другое'],
};

const ReportDto = z.object({
  targetType: z.enum(['LISTING', 'USER', 'REVIEW']),
  targetId: z.string().min(1),
  reason: z.string().min(1, 'Выберите причину').max(100),
  comment: z.string().trim().max(1000).nullish(),
});

@Controller()
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('reports/reasons')
  reasons() {
    return REPORT_REASONS;
  }

  @Post('reports')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  async report(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ReportDto)) dto: z.infer<typeof ReportDto>) {
    if (dto.targetType === 'USER') {
      const u = await this.prisma.user.findFirst({ where: { OR: [{ id: dto.targetId }, { username: dto.targetId.toLowerCase() }] }, select: { id: true } });
      if (!u) throw new NotFoundException({ message: 'Пользователь не найден' });
      if (u.id === user.id) throw new BadRequestException({ message: 'Нельзя пожаловаться на себя' });
      dto.targetId = u.id;
    } else if (dto.targetType === 'REVIEW') {
      const r = await this.prisma.review.findUnique({ where: { id: dto.targetId }, select: { sellerId: true, authorId: true } });
      if (!r) throw new NotFoundException({ message: 'Отзыв не найден' });
      if (r.authorId === user.id) throw new BadRequestException({ message: 'Это ваш отзыв' });
    } else if (!(await this.prisma.listing.findUnique({ where: { id: dto.targetId }, select: { id: true } }))) {
      throw new NotFoundException({ message: 'Такой вещи нет' });
    }
    const duplicate = await this.prisma.report.findFirst({ where: { reporterId: user.id, targetType: dto.targetType, targetId: dto.targetId, status: 'OPEN' } });
    if (!duplicate) await this.prisma.report.create({ data: { reporterId: user.id, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason, comment: dto.comment ?? null } });
    return { ok: true };
  }

  /** "Обжаловать" for a blocked listing goes to the same moderation queue. */
  @Post('listings/:id/appeal')
  async appeal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ comment: z.string().trim().min(5, 'Опишите, почему блокировка ошибочна').max(1000) }))) dto: { comment: string }) {
    const l = await this.prisma.listing.findUnique({ where: { id } });
    if (!l || l.sellerId !== user.id) throw new NotFoundException({ message: 'Такой вещи нет' });
    if (l.status !== 'BLOCKED') throw new BadRequestException({ message: 'Вещь не заблокирована' });
    const open = await this.prisma.report.findFirst({ where: { targetType: 'APPEAL', targetId: id, status: 'OPEN' } });
    if (open) throw new BadRequestException({ message: 'Обжалование уже на рассмотрении' });
    await this.prisma.report.create({ data: { reporterId: user.id, targetType: 'APPEAL', targetId: id, reason: 'Обжалование блокировки', comment: dto.comment } });
    return { ok: true };
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ADMIN role plus a valid admin session (password entered at /admin) for the same user. The role is read from the
   * database on every admin request, not from the session token: an admin whose role was taken away (or who was
   * blocked or deleted) loses the admin area at once, while the token they hold still says ADMIN.
   */
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser; cookies?: Record<string, string> }>();
    if (!req.user) throw new ForbiddenException({ message: 'Только для администраторов' });
    const account = await this.prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, blockedAt: true, deletedAt: true } });
    if (account?.role !== 'ADMIN' || account.blockedAt || account.deletedAt) throw new ForbiddenException({ message: 'Только для администраторов' });
    const token = req.cookies?.[ADMIN_COOKIE];
    const payload = token ? await this.jwt.verifyAsync<{ sub: string; purpose: string }>(token).catch(() => null) : null;
    if (payload?.purpose !== 'admin' || payload.sub !== req.user.id) throw new UnauthorizedException({ message: 'Войдите в админку', code: 'ADMIN_LOGIN' });
    return true;
  }
}

const ResolveDto = z.object({
  action: z.enum(['block', 'unblock', 'dismiss', 'block_user']),
  reason: z.string().trim().max(300).nullish(),
});
const BlockDto = z.object({ reason: z.string().trim().min(3, 'Укажите причину').max(300) });
const MarketDto = z.object({ market: z.enum(['brands', 'resale']), reason: z.string().trim().max(300).nullish() });

/** Internal admin section of the same app (frame 30 item 7). */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
  ) {}

  /** The admin layout asks this to decide between the panel and the sign-in form. */
  @Get('session')
  session() {
    return { ok: true };
  }

  @Get('stats')
  async stats() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [users, newUsers, listingsByStatus, dealsByStatus, completedWeek, gmvWeek, openReports, publishedWeek] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.listing.groupBy({ by: ['status'], _count: true }),
      this.prisma.buyRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.buyRequest.count({ where: { status: 'COMPLETED', completedAt: { gte: weekAgo } } }),
      this.prisma.buyRequest.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: weekAgo } }, _sum: { priceTotal: true } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.listing.count({ where: { publishedAt: { gte: weekAgo } } }),
    ]);
    return {
      // North-star metric from frame 01: completed transactions per week.
      completedWeek,
      gmvWeek: gmvWeek._sum.priceTotal ?? 0,
      users,
      newUsers,
      publishedWeek,
      openReports,
      listingsByStatus: Object.fromEntries(listingsByStatus.map((r) => [r.status, r._count])),
      dealsByStatus: Object.fromEntries(dealsByStatus.map((r) => [r.status, r._count])),
    };
  }

  @Get('reports')
  async reports(@Query('status') raw = 'OPEN') {
    const status: ReportStatus = (['OPEN', 'RESOLVED', 'REJECTED'] as const).find((s) => s === raw) ?? 'OPEN';
    const rows = await this.prisma.report.findMany({
      where: { status },
      include: { reporter: { select: { username: true } } },
      orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: 100,
    });
    const listingIds = rows.filter((r) => r.targetType === 'LISTING' || r.targetType === 'APPEAL').map((r) => r.targetId);
    const userIds = rows.filter((r) => r.targetType === 'USER').map((r) => r.targetId);
    const reviewIds = rows.filter((r) => r.targetType === 'REVIEW').map((r) => r.targetId);
    const reviews = await this.prisma.review.findMany({ where: { id: { in: reviewIds } }, include: { author: { select: { username: true } }, seller: { select: { username: true } } } });
    const R = new Map(reviews.map((r) => [r.id, { id: r.id, rating: r.rating, text: r.text, reply: r.reply, hidden: r.hidden, author: r.author.username, seller: r.seller.username }]));
    const [listings, users, counts] = await Promise.all([
      this.prisma.listing.findMany({ where: { id: { in: listingIds } }, include: cardInclude }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, blockedAt: true, createdAt: true } }),
      this.prisma.report.groupBy({ by: ['targetId'], where: { targetId: { in: [...listingIds, ...userIds] } }, _count: true }),
    ]);
    const L = new Map(listings.map((l) => [l.id, { ...serializeCard(l), blockedReason: l.blockedReason }]));
    const U = new Map(users.map((u) => [u.id, u]));
    const C = new Map(counts.map((c) => [c.targetId, c._count]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        comment: r.comment,
        status: r.status,
        resolution: r.resolution,
        createdAt: r.createdAt,
        reporter: r.reporter?.username ?? null,
        source: r.source,
        details: r.details,
        reportsOnTarget: C.get(r.targetId) ?? 1,
        listing: L.get(r.targetId) ?? null,
        user: U.get(r.targetId) ?? null,
        review: R.get(r.targetId) ?? null,
      })),
    };
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  async resolve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ResolveDto)) dto: z.infer<typeof ResolveDto>) {
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ message: 'Жалоба не найдена' });
    if (r.targetType === 'REVIEW') {
      // Reviews are hidden, never deleted: the rating is recalculated without them.
      if (dto.action === 'block' || dto.action === 'unblock') {
        await this.prisma.review.update({ where: { id: r.targetId }, data: { hidden: dto.action === 'block' } });
        await this.prisma.moderationAction.create({ data: { moderatorId: admin.id, targetType: 'REVIEW', targetId: r.targetId, action: dto.action === 'block' ? 'hide' : 'unhide', reason: dto.reason ?? null } });
      }
    } else {
      if (dto.action === 'block' && r.targetType !== 'USER') await this.blockListing(admin.id, r.targetId, dto.reason || r.reason);
      if (dto.action === 'unblock' && r.targetType !== 'USER') await this.unblockListing(admin.id, r.targetId, dto.reason);
    }
    if (dto.action === 'block_user') {
      const userId =
        r.targetType === 'USER'
          ? r.targetId
          : r.targetType === 'REVIEW'
            ? (await this.prisma.review.findUniqueOrThrow({ where: { id: r.targetId } })).authorId
            : (await this.prisma.listing.findUniqueOrThrow({ where: { id: r.targetId } })).sellerId;
      if (userId === admin.id) throw new ForbiddenException({ message: 'Нельзя заблокировать себя' });
      await this.blockUser(admin.id, userId, dto.reason || r.reason);
    }
    // Resolving one report closes all open reports of the same kind on the same target (a seller's appeal about a
    // listing is a separate matter from complaints about it).
    await this.prisma.report.updateMany({
      where: { targetType: r.targetType, targetId: r.targetId, status: 'OPEN' },
      data: { status: dto.action === 'dismiss' ? 'REJECTED' : 'RESOLVED', resolution: dto.reason || dto.action, resolvedAt: new Date() },
    });
    return { ok: true };
  }

  @Get('listings')
  async listingsList(@Query('status') raw = 'BLOCKED', @Query('q') q?: string) {
    // Unknown values would reach Prisma as an invalid enum and turn into a 500.
    const status = (['BLOCKED', 'PUBLISHED', 'HIDDEN', 'RESERVED', 'SOLD', 'DRAFT'] as const).find((s) => s === raw) ?? 'BLOCKED';
    const where: Prisma.ListingWhereInput = {
      status,
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { seller: { username: { contains: q.toLowerCase() } } }] } : {}),
    };
    const rows = await this.prisma.listing.findMany({ where, include: cardInclude, orderBy: { updatedAt: 'desc' }, take: 100 });
    return { items: rows.map((l) => ({ ...serializeCard(l), blockedReason: l.blockedReason, market: marketOf(l), marketByAdmin: l.marketByAdmin })) };
  }

  /**
   * Moves one item between the main catalogue and «Вторичка», by an admin's decision under the platform rules:
   * a reseller's new original item into the catalogue, a brand's worn item out of it. Logged like any moderation.
   */
  @Post('listings/:id/market')
  @HttpCode(200)
  async setMarket(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(MarketDto)) dto: z.infer<typeof MarketDto>) {
    const l = await this.prisma.listing.findUnique({ where: { id }, select: { status: true, market: true, marketByAdmin: true } });
    if (!l || l.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    const market = dto.market === 'brands' ? 'CATALOG' : 'RESALE';
    if (l.market !== market || !l.marketByAdmin) {
      // Marked as the admin's choice: a later change of the seller's status or the item's condition won't move it.
      await this.prisma.listing.update({ where: { id }, data: { market, marketByAdmin: true } });
      await this.prisma.moderationAction.create({ data: { moderatorId: admin.id, targetType: 'LISTING', targetId: id, action: `market_${dto.market}`, reason: dto.reason ?? null } });
    }
    return { ok: true, market: dto.market };
  }

  @Post('listings/:id/block')
  @HttpCode(200)
  async block(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(BlockDto)) dto: z.infer<typeof BlockDto>) {
    await this.blockListing(admin.id, id, dto.reason);
    return { ok: true };
  }

  @Post('listings/:id/unblock')
  @HttpCode(200)
  async unblock(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.unblockListing(admin.id, id, null);
    return { ok: true };
  }

  @Get('moderation-log')
  async log() {
    return { items: await this.prisma.moderationAction.findMany({ orderBy: { at: 'desc' }, take: 100 }) };
  }

  private async blockListing(adminId: string, id: string, reason: string) {
    const l = await this.prisma.listing.findUnique({ where: { id } });
    if (!l) throw new NotFoundException({ message: 'Такой вещи нет' });
    if (l.status === 'RESERVED') throw new BadRequestException({ message: 'Идёт сделка — сначала разберите её' });
    await this.prisma.listing.update({ where: { id }, data: { status: 'BLOCKED', blockedReason: reason } });
    await this.listings.withdrawFromSale([id]);
    await this.listings.declinePendingRequests(id, 'Объявление снято модератором');
    await this.prisma.moderationAction.create({ data: { moderatorId: adminId, targetType: 'LISTING', targetId: id, action: 'block', reason } });
    await this.notifications.notify(l.sellerId, 'listing_blocked', { listingId: id, title: l.title, reason });
  }

  private async unblockListing(adminId: string, id: string, reason: string | null | undefined) {
    const l = await this.prisma.listing.findUnique({ where: { id } });
    if (!l || l.status !== 'BLOCKED') throw new BadRequestException({ message: 'Вещь не заблокирована' });
    await this.prisma.listing.update({ where: { id }, data: { status: 'PUBLISHED', blockedReason: null } });
    await this.prisma.moderationAction.create({ data: { moderatorId: adminId, targetType: 'LISTING', targetId: id, action: 'unblock', reason: reason ?? null } });
    await this.notifications.notify(l.sellerId, 'listing_unblocked', { listingId: id, title: l.title });
  }

  /** Blocked users can't sign in; their published items are hidden. */
  private async blockUser(adminId: string, userId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { blockedAt: new Date(), sessionVersion: { increment: 1 } } });
    forgetSessionStatus(userId);
    await this.listings.hideForBlock(userId);
    await this.prisma.moderationAction.create({ data: { moderatorId: adminId, targetType: 'USER', targetId: userId, action: 'block', reason } });
  }
}
