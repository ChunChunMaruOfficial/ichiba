import { Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { RequestStatus } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { AdminGuard } from '../moderation/moderation.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACTIVE_REQUEST } from './requests.service.js';

/**
 * Disputes (a deal in DISPUTED): an admin hears both sides outside the platform and records the decision here.
 *
 * - complete: the deal is closed as done, as if the buyer had confirmed receipt — one-of-a-kind items become SOLD;
 * - cancel: the deal is cancelled; a reserved item goes back on sale only when nothing else holds it and it never
 *   left the seller (handed over or sent before the dispute, it is hidden instead until the seller has it back);
 * - keep: the dispute stays open, the admin's note goes into the deal's history.
 *
 * Ichiba moves no money (buyers pay sellers directly), so a decision here moves no money either: any refund is
 * between the two sides, and the screen says so. Every decision is a guarded status change — a repeated or
 * concurrent request finds the deal no longer DISPUTED and changes nothing — and is kept in the deal's events and
 * the moderation log.
 */

const ACTIONS = ['complete', 'cancel', 'keep'] as const;
type DisputeAction = (typeof ACTIONS)[number];
const ResolveDto = z.object({ action: z.enum(ACTIONS), reason: z.string().trim().min(3, 'Опишите решение — его увидят обе стороны').max(1000) });

const disputeInclude = {
  items: { include: { listing: { include: cardInclude } } },
  buyer: { select: { id: true, username: true } },
  seller: { select: { id: true, username: true } },
  events: { orderBy: { at: 'asc' as const } },
};

/** «Несколько размеров»: never reserved or sold as a whole by a deal (requests.service.ts). */
const multiSize = (l: { sizes: string[] }) => l.sizes.length > 1;

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(status: 'open' | 'resolved') {
    const where = status === 'open' ? { status: 'DISPUTED' as const } : { status: { not: 'DISPUTED' as const }, events: { some: { status: 'DISPUTED' as const } } };
    const rows = await this.prisma.buyRequest.findMany({ where, include: disputeInclude, orderBy: { updatedAt: status === 'open' ? 'asc' : 'desc' }, take: 100 });
    const decisions = await this.prisma.moderationAction.findMany({ where: { targetType: 'REQUEST', targetId: { in: rows.map((r) => r.id) } }, orderBy: { at: 'asc' } });
    return {
      items: rows.map((r) => {
        // Opened by one of the two sides; an admin's «keep open» note is a DISPUTED event too, and is not the complaint.
        const opened = [...r.events].reverse().find((e) => e.status === 'DISPUTED' && (e.byUserId === r.buyerId || e.byUserId === r.sellerId));
        return {
          id: r.id,
          number: r.number,
          status: r.status,
          priceTotal: r.priceTotal,
          deliveryMethod: r.deliveryMethod,
          trackingNumber: r.trackingNumber,
          createdAt: r.createdAt,
          buyer: r.buyer,
          seller: r.seller,
          items: r.items.map((i) => ({ ...serializeCard(i.listing), ...(i.size ? { size: i.size } : {}), dealPrice: i.price })),
          dispute: opened ? { at: opened.at, reason: opened.reason, by: opened.byUserId === r.buyerId ? ('buyer' as const) : ('seller' as const) } : null,
          decisions: decisions.filter((d) => d.targetId === r.id).map((d) => ({ action: d.action.replace(/^dispute_/, ''), reason: d.reason, at: d.at })),
        };
      }),
    };
  }

  async resolve(adminId: string, id: string, action: DisputeAction, reason: string) {
    const r = await this.prisma.buyRequest.findUnique({
      where: { id },
      include: { seller: { select: { username: true } }, events: { select: { status: true } }, items: { include: { listing: { select: { id: true, title: true, sizes: true } } } } },
    });
    if (!r) throw new NotFoundException({ message: 'Сделка не найдена' });
    if (r.status !== 'DISPUTED') throw new ConflictException({ message: 'Спор уже решён — обновите страницу', status: r.status });
    const single = r.items.filter((i) => !multiSize(i.listing)).map((i) => i.listingId);
    const title = r.items[0]?.listing.title ?? '';
    const note = `Решение по спору: ${reason}`;
    let released: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const to: RequestStatus = action === 'complete' ? 'COMPLETED' : action === 'cancel' ? 'CANCELLED' : 'DISPUTED';
      if (action !== 'keep') {
        // Guarded on DISPUTED: a repeated or concurrent decision changes nothing the second time.
        const { count } = await tx.buyRequest.updateMany({
          where: { id, status: 'DISPUTED' },
          data: action === 'complete' ? { status: to, completedAt: new Date(), reason: note } : { status: to, reason: note, cancelledById: adminId, expiresAt: null },
        });
        if (!count) throw new ConflictException({ message: 'Спор уже решён — обновите страницу' });
      }
      await tx.buyRequestEvent.create({ data: { requestId: id, status: to, byUserId: adminId, reason: note } });
      await tx.moderationAction.create({ data: { moderatorId: adminId, targetType: 'REQUEST', targetId: id, action: `dispute_${action}`, reason } });

      if (action === 'complete') {
        await tx.listing.updateMany({ where: { id: { in: single }, status: 'RESERVED' }, data: { status: 'SOLD', soldAt: new Date() } });
        await tx.cartItem.deleteMany({ where: { OR: [{ listingId: { in: single } }, { listingId: { in: r.items.map((i) => i.listingId) }, userId: r.buyerId }] } });
      }
      if (action === 'cancel') {
        // Back on sale only an item this deal still reserves and no other live deal holds (one-of-a-kind items only;
        // a «Несколько размеров» listing was never taken off sale). A blocked, sold or deleted item stays as it is.
        const busy = await tx.buyRequestItem.findMany({
          where: { listingId: { in: single }, requestId: { not: id }, request: { status: { in: ACTIVE_REQUEST } } },
          select: { listingId: true },
        });
        const free = single.filter((l) => !busy.some((b) => b.listingId === l));
        const back = await tx.listing.findMany({ where: { id: { in: free }, status: 'RESERVED' }, select: { id: true } });
        // Handed over or sent before the dispute: the item is with the buyer, so it isn't put up for sale again —
        // it is hidden, and the seller shows it once it is back with them.
        const shipped = r.events.some((e) => e.status === 'HANDED_OVER' || e.status === 'IN_TRANSIT');
        await tx.listing.updateMany({ where: { id: { in: back.map((l) => l.id) }, status: 'RESERVED' }, data: { status: shipped ? 'HIDDEN' : 'PUBLISHED', saleType: 'FIXED' } });
        released = shipped ? [] : back.map((l) => l.id);
      }
    });

    if (action !== 'keep') {
      await this.notifications.notifyMany([r.buyerId, r.sellerId], 'dispute_resolved', { requestId: id, title, outcome: action, reason });
      for (const listingId of released) await this.listings.notifyWatchers(listingId, 'item_available', r.items.find((i) => i.listingId === listingId)?.listing.title ?? title);
      if (action === 'complete') await this.notifications.notify(r.buyerId, 'review_request', { requestId: id, listingId: r.items[0]?.listingId, title, seller: r.seller.username });
    }
    return { ok: true, status: action === 'complete' ? 'COMPLETED' : action === 'cancel' ? 'CANCELLED' : 'DISPUTED', released };
  }
}

@Controller('admin/disputes')
@UseGuards(AdminGuard)
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Query('status') status = 'open') {
    return this.disputes.list(status === 'resolved' ? 'resolved' : 'open');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ResolveDto)) dto: z.infer<typeof ResolveDto>) {
    return this.disputes.resolve(admin.id, id, dto.action, dto.reason);
  }
}
