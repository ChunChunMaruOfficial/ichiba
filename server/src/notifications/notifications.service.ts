import { Controller, Get, HttpCode, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { background } from '../common/background.js';
import { EventsService } from '../events/events.js';
import { DealEmails } from '../mail/mail.module.js';
import { photoUrls } from '../media/media.service.js';
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
  | 'auction_no_sale'
  | 'auction_bought_out'
  | 'review_new'
  | 'review_reply'
  | 'review_request'
  | 'listing_scheduled_published'
  | 'listing_schedule_failed'
  | 'offer_likers'
  | 'offer_auto_accepted';

/** In-app notifications, pushed live over SSE (frame 15); deal events are also emailed (DealEmails). */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly emails: DealEmails,
  ) {}

  private email(userIds: string[], type: NotificationType, payload: Prisma.InputJsonValue) {
    // Never block or fail the action because of email.
    background(this.emails.maybeSend(userIds, type, payload as Record<string, unknown>).catch((e) => this.logger.warn(`email for ${type} failed: ${(e as Error).message}`)));
  }

  async notify(userId: string, type: NotificationType, payload: Prisma.InputJsonValue) {
    const n = await this.prisma.notification.create({ data: { userId, type, payload } });
    await this.events.emit(userId, { type: 'notification', data: n });
    this.email([userId], type, payload);
    return n;
  }

  async notifyMany(userIds: string[], type: NotificationType, payload: Prisma.InputJsonValue) {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const rows = await this.prisma.notification.createManyAndReturn({ data: unique.map((userId) => ({ userId, type, payload })) });
    await Promise.all(rows.map((n) => this.events.emit(n.userId, { type: 'notification', data: n })));
    this.email(unique, type, payload);
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }
}

@Controller('notifications')
class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('limit') limit = '20', @Query('before') before?: string, @Query('unread') unread?: string) {
    const take = Math.min(Number(limit) || 20, 100);
    const items = await this.prisma.notification.findMany({
      where: { userId: user.id, createdAt: before ? { lt: new Date(before) } : undefined, readAt: unread === '1' ? null : undefined },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });
    const page = items.slice(0, take);
    return { items: await this.withCovers(page), hasMore: items.length > take };
  }

  /** The item's photo next to each notification: from payload.listingId, or the first item of payload.requestId. */
  private async withCovers<T extends { payload: Prisma.JsonValue }>(items: T[]) {
    const field = (n: T, k: string) => {
      const v = n.payload && typeof n.payload === 'object' && !Array.isArray(n.payload) ? (n.payload as Record<string, unknown>)[k] : undefined;
      return typeof v === 'string' ? v : undefined;
    };
    const requestIds = [...new Set(items.map((n) => (field(n, 'listingId') ? undefined : field(n, 'requestId'))).filter((x): x is string => !!x))];
    const requestItems = requestIds.length ? await this.prisma.buyRequestItem.findMany({ where: { requestId: { in: requestIds } }, select: { requestId: true, listingId: true } }) : [];
    const listingOfRequest = new Map<string, string>();
    for (const r of requestItems) if (!listingOfRequest.has(r.requestId)) listingOfRequest.set(r.requestId, r.listingId);
    const listingOf = (n: T) => field(n, 'listingId') ?? listingOfRequest.get(field(n, 'requestId') ?? '');
    const listingIds = [...new Set(items.map(listingOf).filter((x): x is string => !!x))];
    const photos = listingIds.length
      ? await this.prisma.photo.findMany({ where: { listingId: { in: listingIds } }, orderBy: { order: 'asc' }, select: { listingId: true, key: true, provider: true } })
      : [];
    const cover = new Map<string, string>();
    for (const ph of photos) if (ph.listingId && !cover.has(ph.listingId)) cover.set(ph.listingId, photoUrls(ph).s);
    return items.map((n) => ({ ...n, cover: cover.get(listingOf(n) ?? '') ?? null }));
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
