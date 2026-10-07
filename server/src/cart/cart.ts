import { BadRequestException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { applyDiscount, BundleTier, discountFor, nextTier, tiersOf } from '../listings/bundle.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { StatsService } from '../stats/stats.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';

const DELIVERY_ORDER = ['IN_PERSON', 'PICKUP', 'DELIVERY'] as const;

/**
 * Cart groups items by seller: one buy request per seller (frame 12). No quantities or coupons —
 * every item is unique.
 */
@Controller('cart')
export class CartController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly stats: StatsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.cartItem.findMany({
      where: { userId: user.id },
      include: { listing: { include: { ...cardInclude, seller: { select: { id: true, username: true, city: true, bundleDiscounts: true } } } } },
      orderBy: { addedAt: 'desc' },
    });
    const groups = new Map<string, { seller: { id: string; username: string; city: string | null }; tiers: BundleTier[]; items: ReturnType<typeof serializeCard>[]; deliveryOptions: string[] }>();
    for (const r of rows) {
      const l = r.listing;
      if (l.status === 'DELETED') continue;
      const { bundleDiscounts, ...seller } = l.seller;
      const g = groups.get(l.sellerId) ?? { seller, tiers: tiersOf(bundleDiscounts), items: [], deliveryOptions: [...DELIVERY_ORDER] };
      g.items.push(serializeCard(l));
      // Only methods every available item supports can be offered for the combined request.
      if (l.status === 'PUBLISHED') g.deliveryOptions = g.deliveryOptions.filter((m) => l.deliveryOptions.includes(m as (typeof DELIVERY_ORDER)[number]));
      groups.set(l.sellerId, g);
    }
    const result = [...groups.values()].map(({ tiers, ...g }) => {
      const available = g.items.filter((i) => i.status === 'PUBLISHED');
      // Bundle discount for buying several items of this seller in one request (decision: seller-defined tiers).
      const percent = discountFor(tiers, available.length);
      const priced = applyDiscount(available.map((i) => i.price ?? 0), percent);
      return {
        ...g,
        subtotal: priced.subtotal,
        discountPercent: percent,
        discount: priced.discount,
        total: priced.total,
        availableCount: available.length,
        bundleTiers: tiers,
        nextTier: nextTier(tiers, available.length),
      };
    });
    return { groups: result, count: rows.length };
  }

  @Post(':listingId')
  async add(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listing.sellerId === user.id) throw new BadRequestException({ message: 'Это ваша вещь' });
    if (listing.status !== 'PUBLISHED') throw new BadRequestException({ message: 'Вещь недоступна для покупки' });
    if (listing.saleType === 'AUCTION') throw new BadRequestException({ message: 'Это аукцион — сделайте ставку', code: 'AUCTION' });
    await this.prisma.cartItem.upsert({ where: { userId_listingId: { userId: user.id, listingId } }, create: { userId: user.id, listingId }, update: {} });
    await this.recs.record(user.id, 'cart', listingId);
    this.stats.track(listingId, 'carts');
    return { inCart: true, count: await this.prisma.cartItem.count({ where: { userId: user.id } }) };
  }

  @Delete(':listingId')
  async remove(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId: user.id, listingId } });
    return { inCart: false, count: await this.prisma.cartItem.count({ where: { userId: user.id } }) };
  }
}
