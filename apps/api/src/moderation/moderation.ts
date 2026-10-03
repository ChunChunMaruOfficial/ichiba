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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { Prisma, ReportStatus } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Reasons offered in the report modal (frame 20). */
export const REPORT_REASONS = {
  LISTING: ['Подделка или копия бренда', 'Запрещённый товар', 'Фото не соответствует вещи', 'Мошенничество', 'Оскорбительное содержание', 'Другое'],
  USER: ['Мошенничество', 'Оскорбления в чате', 'Не выходит на связь после сделки', 'Спам', 'Другое'],
};

const ReportDto = z.object({
  targetType: z.enum(['LISTING', 'USER']),
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
  canActivate(ctx: ExecutionContext) {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (user?.role !== 'ADMIN') throw new ForbiddenException({ message: 'Только для администраторов' });
    return true;
  }
}

const ResolveDto = z.object({
  action: z.enum(['block', 'unblock', 'dismiss', 'block_user']),
  reason: z.string().trim().max(300).nullish(),
});
const BlockDto = z.object({ reason: z.string().trim().min(3, 'Укажите причину').max(300) });

/** Internal admin section of the same app (frame 30 item 7). */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
  ) {}

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
  async reports(@Query('status') status: ReportStatus = 'OPEN') {
    const rows = await this.prisma.report.findMany({
      where: { status },
      include: { reporter: { select: { username: true } } },
      orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: 100,
    });
    const listingIds = rows.filter((r) => r.targetType !== 'USER').map((r) => r.targetId);
    const userIds = rows.filter((r) => r.targetType === 'USER').map((r) => r.targetId);
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
        reporter: r.reporter.username,
        reportsOnTarget: C.get(r.targetId) ?? 1,
        listing: L.get(r.targetId) ?? null,
        user: U.get(r.targetId) ?? null,
      })),
    };
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  async resolve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ResolveDto)) dto: z.infer<typeof ResolveDto>) {
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ message: 'Жалоба не найдена' });
    if (dto.action === 'block' && r.targetType !== 'USER') await this.blockListing(admin.id, r.targetId, dto.reason || r.reason);
    if (dto.action === 'unblock' && r.targetType !== 'USER') await this.unblockListing(admin.id, r.targetId, dto.reason);
    if (dto.action === 'block_user') {
      const userId = r.targetType === 'USER' ? r.targetId : (await this.prisma.listing.findUniqueOrThrow({ where: { id: r.targetId } })).sellerId;
      await this.blockUser(admin.id, userId, dto.reason || r.reason);
    }
    // Resolving one report closes all open reports on the same target.
    await this.prisma.report.updateMany({
      where: { targetId: r.targetId, status: 'OPEN' },
      data: { status: dto.action === 'dismiss' ? 'REJECTED' : 'RESOLVED', resolution: dto.reason || dto.action, resolvedAt: new Date() },
    });
    return { ok: true };
  }

  @Get('listings')
  async listingsList(@Query('status') status = 'BLOCKED', @Query('q') q?: string) {
    const where: Prisma.ListingWhereInput = {
      status: status as 'BLOCKED',
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { seller: { username: { contains: q.toLowerCase() } } }] } : {}),
    };
    const rows = await this.prisma.listing.findMany({ where, include: cardInclude, orderBy: { updatedAt: 'desc' }, take: 100 });
    return { items: rows.map((l) => ({ ...serializeCard(l), blockedReason: l.blockedReason })) };
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
    await this.prisma.user.update({ where: { id: userId }, data: { blockedAt: new Date() } });
    await this.prisma.listing.updateMany({ where: { sellerId: userId, status: 'PUBLISHED' }, data: { status: 'HIDDEN' } });
    await this.prisma.moderationAction.create({ data: { moderatorId: adminId, targetType: 'USER', targetId: userId, action: 'block', reason } });
  }
}
