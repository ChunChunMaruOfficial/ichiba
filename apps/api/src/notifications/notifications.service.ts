import { Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { EventsService } from '../events/events.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type NotificationType =
  | 'request_new'
  | 'request_accepted'
  | 'request_declined'
  | 'request_cancelled'
  | 'request_expired'
  | 'deal_handed_over'
  | 'deal_in_transit'
  | 'deal_completed'
  | 'price_drop'
  | 'item_reserved'
  | 'item_sold'
  | 'item_available'
  | 'offer_new'
  | 'offer_countered'
  | 'offer_accepted'
  | 'offer_declined'
  | 'offer_expired'
  | 'follow_new_item'
  | 'listing_blocked'
  | 'listing_unblocked'
  | 'auction_bid'
  | 'auction_outbid'
  | 'auction_won'
  | 'auction_runner_up'
  | 'auction_sold'
  | 'auction_no_sale';

/** In-app notifications, pushed live over SSE (frame 15). Email delivery plugs in here later. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async notify(userId: string, type: NotificationType, payload: Prisma.InputJsonValue) {
    const n = await this.prisma.notification.create({ data: { userId, type, payload } });
    this.events.emit(userId, { type: 'notification', data: n });
    return n;
  }

  async notifyMany(userIds: string[], type: NotificationType, payload: Prisma.InputJsonValue) {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    await this.prisma.notification.createMany({ data: unique.map((userId) => ({ userId, type, payload })) });
    for (const userId of unique) this.events.emit(userId, { type: 'notification', data: { type, payload } });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('limit') limit = '20', @Query('before') before?: string, @Query('unread') unread?: string) {
    const take = Math.min(Number(limit) || 20, 100);
    const items = await this.prisma.notification.findMany({
      where: { userId: user.id, createdAt: before ? { lt: new Date(before) } : undefined, readAt: unread === '1' ? null : undefined },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });
    return { items: items.slice(0, take), hasMore: items.length > take };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}

@Module({ providers: [NotificationsService], controllers: [NotificationsController], exports: [NotificationsService] })
export class NotificationsModule {}
