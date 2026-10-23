import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { findContacts, hasProfanity } from '../ai/text-rules.js';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { withJobLock } from '../common/job-lock.js';
import { ZodPipe } from '../common/zod.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';

/**
 * Reviews (feature 3; decision: buyer → seller only). One review per completed deal within 30 days, editable
 * for 14 days; visible right away; the seller may answer publicly once (and edit the answer).
 */

const REVIEW_WINDOW_MS = 30 * 24 * 3600 * 1000;
const EDIT_WINDOW_MS = 14 * 24 * 3600 * 1000;
const REMIND_AFTER_MS = 3 * 24 * 3600 * 1000;

const REVIEW_TAGS = {
  as_described: { label: 'Как в описании', positive: true },
  fast: { label: 'Быстро передал', positive: true },
  polite: { label: 'Вежливый продавец', positive: true },
  packaging: { label: 'Хорошая упаковка', positive: true },
  bad_description: { label: 'Не как в описании', positive: false },
  late: { label: 'Долго передавал', positive: false },
  rude: { label: 'Невежливый', positive: false },
} as const;
type Tag = keyof typeof REVIEW_TAGS;
const TAG_KEYS = Object.keys(REVIEW_TAGS) as [Tag, ...Tag[]];

const ReviewDto = z.object({
  rating: z.number().int().min(1, 'Поставьте оценку').max(5),
  tags: z.array(z.enum(TAG_KEYS)).max(4).default([]),
  text: z.string().trim().max(1000, 'До 1000 символов').nullish(),
});
const ReplyDto = z.object({ text: z.string().trim().min(2, 'Напишите ответ').max(1000, 'До 1000 символов') });

/** Same text rules as listings: no profanity, no contacts or links. */
function checkText(text: string | null | undefined, field = 'text') {
  if (!text) return;
  if (hasProfanity(text)) throw new BadRequestException({ message: 'Уберите нецензурные слова', fields: { [field]: 'Уберите нецензурные слова' } });
  if (findContacts(text).length) throw new BadRequestException({ message: 'Контакты и ссылки в отзывах запрещены', fields: { [field]: 'Без контактов и ссылок' } });
}

const reviewInclude = {
  author: { select: { username: true } },
  listing: { select: { id: true, title: true, photos: { where: { isCover: true }, take: 1, select: { key: true } } } },
} satisfies Prisma.ReviewInclude;
type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger('Reviews');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  serialize(r: ReviewRow, viewerId?: string) {
    return {
      id: r.id,
      rating: r.rating,
      tags: r.tags.filter((t): t is Tag => t in REVIEW_TAGS).map((t) => ({ key: t, label: REVIEW_TAGS[t].label, positive: REVIEW_TAGS[t].positive })),
      text: r.text,
      reply: r.reply,
      repliedAt: r.repliedAt,
      createdAt: r.createdAt,
      // Changed after it was written. The seller's reply also bumps updatedAt, so an update within seconds of the
      // reply is the reply itself; an edit after the reply still shows (that is the one readers need to know about).
      edited: r.updatedAt.getTime() - r.createdAt.getTime() > 60_000 && (!r.repliedAt || r.updatedAt.getTime() - r.repliedAt.getTime() > 5_000),
      author: r.author.username,
      listing: r.listing ? { id: r.listing.id, title: r.listing.title } : null,
      mine: viewerId === r.authorId,
      canEdit: viewerId === r.authorId && Date.now() - r.createdAt.getTime() < EDIT_WINDOW_MS,
      canReply: viewerId === r.sellerId,
    };
  }

  async create(buyerId: string, requestId: string, dto: z.infer<typeof ReviewDto>) {
    const r = await this.prisma.buyRequest.findUnique({ where: { id: requestId }, include: { items: { take: 1, include: { listing: { select: { id: true, title: true } } } }, buyer: { select: { username: true } } } });
    if (!r) throw new NotFoundException({ message: 'Сделка не найдена' });
    if (r.buyerId !== buyerId) throw new ForbiddenException({ message: 'Отзыв оставляет покупатель' });
    if (r.status !== 'COMPLETED' || !r.completedAt) throw new ConflictException({ message: 'Отзыв можно оставить после завершения сделки' });
    if (Date.now() - r.completedAt.getTime() > REVIEW_WINDOW_MS) throw new ConflictException({ message: 'Отзыв можно оставить в течение 30 дней после сделки' });
    checkText(dto.text);
    const listing = r.items[0]?.listing;
    try {
      const review = await this.prisma.review.create({
        data: { requestId, listingId: listing?.id ?? null, authorId: buyerId, sellerId: r.sellerId, rating: dto.rating, tags: dto.tags, text: dto.text || null },
        include: reviewInclude,
      });
      await this.notifications.notify(r.sellerId, 'review_new', { reviewId: review.id, requestId, listingId: listing?.id, title: listing?.title, rating: dto.rating, buyer: r.buyer.username });
      return this.serialize(review, buyerId);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ message: 'Вы уже оставили отзыв об этой сделке' });
      throw e;
    }
  }

  async update(buyerId: string, id: string, dto: z.infer<typeof ReviewDto>) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review || review.authorId !== buyerId) throw new NotFoundException({ message: 'Отзыв не найден' });
    if (Date.now() - review.createdAt.getTime() > EDIT_WINDOW_MS) throw new ConflictException({ message: 'Отзыв можно изменить в течение 14 дней' });
    checkText(dto.text);
    const updated = await this.prisma.review.update({ where: { id }, data: { rating: dto.rating, tags: dto.tags, text: dto.text || null }, include: reviewInclude });
    return this.serialize(updated, buyerId);
  }

  async reply(sellerId: string, id: string, text: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review || review.sellerId !== sellerId) throw new NotFoundException({ message: 'Отзыв не найден' });
    checkText(text);
    const first = !review.reply;
    const updated = await this.prisma.review.update({ where: { id }, data: { reply: text, repliedAt: new Date() }, include: reviewInclude });
    if (first) {
      const seller = await this.prisma.user.findUniqueOrThrow({ where: { id: sellerId }, select: { username: true } });
      await this.notifications.notify(review.authorId, 'review_reply', { reviewId: id, seller: seller.username, title: updated.listing?.title });
    }
    return this.serialize(updated, sellerId);
  }

  /** Public reviews of a seller with a rating summary; newest first, cursor by createdAt. */
  async forSeller(username: string, viewerId: string | undefined, opts: { before?: Date; rating?: number }) {
    const seller = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!seller) throw new NotFoundException({ message: 'Такого гардероба нет' });
    const where: Prisma.ReviewWhereInput = { sellerId: seller.id, hidden: false };
    const [rows, groups] = await Promise.all([
      this.prisma.review.findMany({
        where: { ...where, rating: opts.rating, createdAt: opts.before ? { lt: opts.before } : undefined },
        include: reviewInclude,
        orderBy: { createdAt: 'desc' },
        take: 21,
      }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: true }),
    ]);
    const tagRows = await this.prisma.review.findMany({ where, select: { tags: true }, take: 500, orderBy: { createdAt: 'desc' } });
    const count = groups.reduce((s, g) => s + g._count, 0);
    const avg = count ? groups.reduce((s, g) => s + g.rating * g._count, 0) / count : 0;
    const tagCounts = new Map<string, number>();
    for (const t of tagRows.flatMap((r) => r.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    return {
      summary: {
        avg: Math.round(avg * 10) / 10,
        count,
        distribution: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: groups.find((g) => g.rating === stars)?._count ?? 0 })),
        topTags: [...tagCounts.entries()]
          .filter(([k]) => k in REVIEW_TAGS && REVIEW_TAGS[k as Tag].positive)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, n]) => ({ key: k, label: REVIEW_TAGS[k as Tag].label, count: n })),
      },
      items: rows.slice(0, 20).map((r) => this.serialize(r, viewerId)),
      hasMore: rows.length > 20,
    };
  }

  /** One reminder 3 days after completion if the buyer hasn't reviewed yet. */
  @Cron(CronExpression.EVERY_HOUR)
  remind() {
    return withJobLock(this.redis, 'reviews.remind', 3600_000, async () => {
      const due = await this.prisma.buyRequest.findMany({
        where: { status: 'COMPLETED', completedAt: { lt: new Date(Date.now() - REMIND_AFTER_MS), gt: new Date(Date.now() - REMIND_AFTER_MS - 24 * 3600 * 1000) }, review: null },
        select: { id: true, buyerId: true, seller: { select: { username: true } }, items: { take: 1, select: { listing: { select: { id: true, title: true } } } } },
        take: 200,
      });
      let sent = 0;
      for (const r of due) {
        const already = await this.prisma.notification.count({ where: { userId: r.buyerId, type: 'review_request', payload: { path: ['requestId'], equals: r.id } } });
        if (already >= 2) continue;
        await this.notifications.notify(r.buyerId, 'review_request', { requestId: r.id, listingId: r.items[0]?.listing.id, title: r.items[0]?.listing.title, seller: r.seller.username, reminder: true });
        sent++;
      }
      if (sent) this.logger.log(`review reminders: ${sent}`);
    });
  }
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('reviews/tags')
  @Public()
  tags() {
    return Object.entries(REVIEW_TAGS).map(([key, v]) => ({ key, ...v }));
  }

  @Public()
  @Get('users/:username/reviews')
  list(@CurrentUser() user: AuthUser | undefined, @Param('username') username: string, @Query('before') before?: string, @Query('rating') rating?: string) {
    const r = Number(rating);
    const cursor = before ? new Date(before) : undefined;
    if (cursor && Number.isNaN(cursor.getTime())) throw new BadRequestException({ message: 'Некорректная дата' });
    return this.reviews.forSeller(username, user?.id, { before: cursor, rating: Number.isInteger(r) && r >= 1 && r <= 5 ? r : undefined });
  }

  @Post('requests/:id/review')
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewDto)) dto: z.infer<typeof ReviewDto>) {
    return this.reviews.create(user.id, id, dto);
  }

  @Patch('reviews/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewDto)) dto: z.infer<typeof ReviewDto>) {
    return this.reviews.update(user.id, id, dto);
  }

  @Post('reviews/:id/reply')
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReplyDto)) dto: z.infer<typeof ReplyDto>) {
    return this.reviews.reply(user.id, id, dto.text);
  }
}
