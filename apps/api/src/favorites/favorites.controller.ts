import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
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
      where: { userId: user.id, listing: available === '1' ? { status: 'PUBLISHED' } : undefined },
      include: { listing: { include: cardInclude } },
      orderBy: { createdAt: 'desc' },
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
    const existing = await this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId } } });
    if (!existing) {
      await this.prisma.$transaction([
        this.prisma.favorite.create({ data: { userId: user.id, listingId, source: dto.source } }),
        this.prisma.listing.update({ where: { id: listingId }, data: { favoritesCount: { increment: 1 } } }),
      ]);
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
