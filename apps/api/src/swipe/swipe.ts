import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatsService } from '../stats/stats.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';

const DAY = 24 * 3600 * 1000;

const SwipeDto = z.object({
  listingId: z.uuid(),
  direction: z.enum(['right', 'left']),
  context: z.enum(['onboarding', 'swipe_mode']).default('swipe_mode'),
});

/**
 * Tinder-style swipe (decision D2): right = ♡, left = "не моё" (hides similar for 7 days).
 * Used by onboarding (20 cards) and by the "Свайп" mode on Home.
 */
@Controller('swipe')
export class SwipeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly stats: StatsService,
  ) {}

  /**
   * Open to guests: they get popular items mixed across categories (no account needed to browse).
   * `skip` carries ids a guest already swiped left, kept in their browser.
   */
  @Public()
  @Get('deck')
  async deck(@Query('limit') limitRaw = '20', @Query('context') context = 'swipe_mode', @Query('skip') skipRaw = '', @CurrentUser() user?: AuthUser) {
    const limit = Math.min(Number(limitRaw) || 20, 40);
    const skip = skipRaw.split(',').filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 300);
    let exclude = skip;
    if (user) {
      const [swiped, favs] = await Promise.all([
        this.prisma.signal.findMany({
          where: { userId: user.id, type: { in: ['swipe_left', 'swipe_right'] }, createdAt: { gt: new Date(Date.now() - 7 * DAY) } },
          select: { listingId: true },
        }),
        this.prisma.favorite.findMany({ where: { userId: user.id }, select: { listingId: true } }),
      ]);
      exclude = [...new Set([...skip, ...swiped.map((s) => s.listingId!), ...favs.map((f) => f.listingId)].filter(Boolean))];
    }
    const pool = await this.prisma.listing.findMany({
      where: { status: 'PUBLISHED', sellerId: user ? { not: user.id } : undefined, id: { notIn: exclude } },
      select: { id: true, sellerId: true, category: true, brand: true, color: true, sizeValue: true, price: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 500,
    });

    let ids: string[];
    if (user && context !== 'onboarding' && (await this.recs.hasProfile(user.id))) {
      ids = (await this.recs.rankForUser(user.id, pool)).slice(0, limit);
    } else {
      // Guests and cold start: most popular first, round-robin across categories so the deck feels varied.
      const pop = await this.recs.popularity(pool.map((p) => p.id));
      const sorted = [...pool].sort((a, b) => (pop.get(b.id) ?? 0) - (pop.get(a.id) ?? 0));
      const byCategory = new Map<string, string[]>();
      for (const p of sorted) byCategory.set(p.category ?? '', [...(byCategory.get(p.category ?? '') ?? []), p.id]);
      const queues = [...byCategory.values()];
      ids = [];
      while (ids.length < limit && queues.some((q) => q.length)) for (const q of queues) if (q.length && ids.length < limit) ids.push(q.shift()!);
    }
    const rows = await this.prisma.listing.findMany({ where: { id: { in: ids } }, include: cardInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const favs = user ? new Set<string>() : undefined;
    return { items: ids.map((id) => byId.get(id)).filter((r) => r !== undefined).map((r) => serializeCard(r, favs)) };
  }

  @Post()
  @HttpCode(200)
  async swipe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SwipeDto)) dto: z.infer<typeof SwipeDto>) {
    if (dto.direction === 'right') {
      const existing = await this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId: dto.listingId } } });
      if (!existing) {
        await this.prisma.$transaction([
          this.prisma.favorite.create({ data: { userId: user.id, listingId: dto.listingId, source: 'swipe' } }),
          this.prisma.listing.update({ where: { id: dto.listingId }, data: { favoritesCount: { increment: 1 } } }),
        ]);
        this.stats.track(dto.listingId, 'favorites');
      }
      await this.recs.record(user.id, 'swipe_right', dto.listingId);
    } else {
      await this.recs.record(user.id, 'swipe_left', dto.listingId);
    }
    return { ok: true };
  }

  /** ↶ undoes the latest swipe (and the ♡ it created). */
  @Delete('last')
  async undo(@CurrentUser() user: AuthUser) {
    const last = await this.prisma.signal.findFirst({ where: { userId: user.id, type: { in: ['swipe_left', 'swipe_right'] } }, orderBy: { createdAt: 'desc' } });
    if (!last?.listingId) return { listingId: null };
    await this.prisma.signal.delete({ where: { id: last.id } });
    if (last.type === 'swipe_right') {
      const { count } = await this.prisma.favorite.deleteMany({ where: { userId: user.id, listingId: last.listingId, source: 'swipe' } });
      if (count) await this.prisma.listing.update({ where: { id: last.listingId }, data: { favoritesCount: { decrement: 1 } } });
    }
    return { listingId: last.listingId };
  }
}
