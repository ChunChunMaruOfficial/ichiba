import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { StatsService } from '../stats/stats.js';

const SaveDto = z.object({ source: z.enum(['feed', 'swipe', 'product', 'wardrobe', 'search']).default('product') });

/** ♡ = save + watch (D3). The seller only ever sees the count (D4). */
@Controller('favorites')
export class FavoritesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly stats: StatsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('sort') sort = 'recent', @Query('available') available?: string) {
    const favs = await this.prisma.favorite.findMany({
      // A deleted or moderator-blocked item is gone for the buyer: its page shows nothing, so the list doesn't either.
      where: { userId: user.id, listing: available === '1' ? { status: 'PUBLISHED' } : { status: { notIn: ['DELETED', 'BLOCKED', 'DRAFT'] } } },
      include: { listing: { include: cardInclude } },
      orderBy: { createdAt: 'desc' },
      // The newest 200: the page shows no more, and sorting by price within them keeps the request cheap.
      take: 200,
    });
    let items = favs.map((f) => serializeCard(f.listing, new Set([f.listingId])));
    if (sort === 'cheap') items = items.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    if (sort === 'expensive') items = items.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    if (sort === 'available') items = [...items.filter((i) => i.status === 'PUBLISHED'), ...items.filter((i) => i.status !== 'PUBLISHED')];
    const reserved = items.filter((i) => i.status === 'RESERVED').length;
    const priceDropped = items.filter((i) => i.previousPrice && i.price && i.price < i.previousPrice).length;
    return { items, total: items.length, reserved, priceDropped };
  }

  @Post(':listingId')
  async save(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string, @Body(new ZodPipe(SaveDto)) dto: z.infer<typeof SaveDto>) {
    // Only listings others can see: no ♡ on drafts, hidden or deleted items (and no 500 on a wrong id).
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { status: true } });
    if (!listing || !['PUBLISHED', 'RESERVED', 'SOLD'].includes(listing.status)) throw new NotFoundException({ message: 'Такой вещи нет' });
    // skipDuplicates instead of check-then-create: a double tap neither fails on the unique key nor counts twice.
    const added = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.favorite.createMany({ data: [{ userId: user.id, listingId, source: dto.source }], skipDuplicates: true });
      if (count) await tx.listing.update({ where: { id: listingId }, data: { favoritesCount: { increment: count } } });
      return count;
    });
    if (added) {
      await this.recs.record(user.id, dto.source === 'swipe' ? 'swipe_right' : 'favorite', listingId);
      this.stats.track(listingId, 'favorites');
    }
    return { isFavorite: true };
  }

  @Delete(':listingId')
  async remove(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    const { count } = await this.prisma.favorite.deleteMany({ where: { userId: user.id, listingId } });
    if (count) await this.prisma.listing.update({ where: { id: listingId }, data: { favoritesCount: { decrement: 1 } } });
    return { isFavorite: false };
  }
}
