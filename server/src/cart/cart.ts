import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ZodPipe } from '../common/zod.js';
import { applyDiscount, BundleTier, discountFor, nextTier, tiersOf } from '../listings/bundle.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { StatsService } from '../stats/stats.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';

const DELIVERY_ORDER = ['IN_PERSON', 'DELIVERY'] as const;
/** «Несколько размеров»: the size goes into the cart with the item. */
const AddDto = z.object({ size: z.string().trim().min(1).max(20).optional() });
const PreviewDto = z.object({ items: z.array(z.object({ listingId: z.uuid(), size: z.string().trim().max(20).nullish() })).max(50) });
const CART_INCLUDE = { ...cardInclude, seller: { select: { id: true, username: true, city: true, bundleDiscounts: true, brandVerifiedAt: true } } } satisfies Prisma.ListingInclude;

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
    const rows = await this.prisma.cartItem.findMany({ where: { userId: user.id }, include: { listing: { include: CART_INCLUDE } }, orderBy: { addedAt: 'desc' } });
    return this.groups(rows);
  }

  /**
   * A guest's cart lives in their browser; this shows it like a signed-in cart (grouped by seller, with bundle
   * discounts). After sign-in the browser moves the items into the account.
   */
  @Public()
  @Post('preview')
  @HttpCode(200)
  async preview(@Body(new ZodPipe(PreviewDto)) dto: z.infer<typeof PreviewDto>) {
    const listings = await this.prisma.listing.findMany({ where: { id: { in: dto.items.map((i) => i.listingId) } }, include: CART_INCLUDE });
    const byId = new Map(listings.map((l) => [l.id, l]));
    return this.groups(dto.items.flatMap((i) => (byId.has(i.listingId) ? [{ listing: byId.get(i.listingId)!, size: i.size ?? null }] : [])));
  }

  private groups(rows: Array<{ listing: Prisma.ListingGetPayload<{ include: typeof CART_INCLUDE }>; size: string | null }>) {
    const groups = new Map<string, { seller: { id: string; username: string; city: string | null }; tiers: BundleTier[]; items: ReturnType<typeof serializeCard>[]; deliveryOptions: string[] }>();
    for (const r of rows) {
      const l = r.listing;
      // Never shown by id: a deleted item, someone's draft, or one a moderator blocked (its page hides it too).
      if (l.status === 'DELETED' || l.status === 'DRAFT' || l.status === 'BLOCKED') continue;
      const { bundleDiscounts, brandVerifiedAt: _brand, ...seller } = l.seller;
      const g = groups.get(l.sellerId) ?? { seller, tiers: tiersOf(bundleDiscounts), items: [], deliveryOptions: [...DELIVERY_ORDER] };
      // The size picked on a listing with several sizes replaces its «S · M · L».
      g.items.push({ ...serializeCard(l), ...(r.size ? { size: r.size } : {}) });
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
  async add(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string, @Body(new ZodPipe(AddDto)) dto: z.infer<typeof AddDto>) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    if (listing.sellerId === user.id) throw new BadRequestException({ message: 'Это ваша вещь' });
    if (listing.status !== 'PUBLISHED') throw new BadRequestException({ message: 'Вещь недоступна для покупки' });
    if (listing.saleType === 'AUCTION') throw new BadRequestException({ message: 'Это аукцион — сделайте ставку', code: 'AUCTION' });
    if (listing.priceNegotiable) throw new BadRequestException({ message: 'Цена договорная — предложите свою цену или напишите продавцу', code: 'NEGOTIABLE' });
    const multi = listing.sizes.length > 1;
    if (multi && (!dto.size || !listing.sizes.includes(dto.size))) throw new BadRequestException({ message: 'Выберите размер', code: 'SIZE' });
    const size = multi ? dto.size : null;
    await this.prisma.cartItem.upsert({ where: { userId_listingId: { userId: user.id, listingId } }, create: { userId: user.id, listingId, size }, update: { size } });
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
