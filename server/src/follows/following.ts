import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { Prisma } from '../generated/prisma/client.js';
import { tiersOf } from '../listings/bundle.js';
import { cardInclude } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { photoUrls } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { kindOf } from '../recommendations/recommendations.service.js';

/** People per page of a follower / following list. */
const PAGE = 30;
/** How many of a seller's latest items the collage picks from (as `ListingsService.collage`). */
const COLLAGE_POOL = 60;

/** `offset` / `limit` from the query string: never negative, never above `max`. */
const pageOf = (offsetRaw: string, limitRaw: string, fallback: number, max: number) => ({
  offset: Math.max(0, Math.floor(Number(offsetRaw)) || 0),
  limit: Math.min(Math.max(1, Math.floor(Number(limitRaw)) || fallback), max),
});

/** Following / social layer (frame 16): new items from wardrobes I follow, and follower lists. */
@Controller()
export class FollowingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  @Get('following/feed')
  async feed(@CurrentUser() user: AuthUser, @Query('offset') offsetRaw = '0', @Query('limit') limitRaw = '24') {
    const { offset, limit } = pageOf(offsetRaw, limitRaw, 24, 48);
    const follows = await this.prisma.follow.findMany({ where: { followerId: user.id }, select: { sellerId: true } });
    const where = { sellerId: { in: follows.map((f) => f.sellerId) }, status: { in: ['PUBLISHED', 'RESERVED'] as ('PUBLISHED' | 'RESERVED')[] } };
    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({ where, include: cardInclude, orderBy: { publishedAt: 'desc' }, skip: offset, take: limit }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: await this.listings.cards(rows, user.id), total, following: follows.length };
  }

  @Get('following')
  async following(@CurrentUser() user: AuthUser, @Query('offset') offsetRaw = '0') {
    const { offset } = pageOf(offsetRaw, '', PAGE, PAGE);
    const follows = await this.prisma.follow.findMany({ where: { followerId: user.id }, orderBy: { createdAt: 'desc' }, skip: offset, take: PAGE + 1, select: { sellerId: true } });
    return this.page(follows.map((f) => f.sellerId), offset, user.id, true);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('users/:username/followers')
  followers(@Param('username') username: string, @Query('offset') offsetRaw = '0', @CurrentUser() viewer?: AuthUser) {
    return this.lists(username, 'followers', offsetRaw, viewer);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('users/:username/following')
  followingOf(@Param('username') username: string, @Query('offset') offsetRaw = '0', @CurrentUser() viewer?: AuthUser) {
    return this.lists(username, 'following', offsetRaw, viewer);
  }

  private async lists(username: string, list: 'followers' | 'following', offsetRaw: string, viewer?: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!u) throw new NotFoundException({ message: 'Такого гардероба нет' });
    const { offset } = pageOf(offsetRaw, '', PAGE, PAGE);
    const ids =
      list === 'followers'
        ? (await this.prisma.follow.findMany({ where: { sellerId: u.id }, orderBy: { createdAt: 'desc' }, skip: offset, take: PAGE + 1, select: { followerId: true } })).map((f) => f.followerId)
        : (await this.prisma.follow.findMany({ where: { followerId: u.id }, orderBy: { createdAt: 'desc' }, skip: offset, take: PAGE + 1, select: { sellerId: true } })).map((f) => f.sellerId);
    // Public lists carry no collage: the modal shows names and counts only, and it is the costliest part.
    return this.page(ids, offset, viewer?.id, false);
  }

  /** One page of people (`ids` holds one extra row to tell whether there is a next page). */
  private async page(ids: string[], offset: number, viewerId: string | undefined, withCollage: boolean) {
    const hasMore = ids.length > PAGE;
    const pageIds = ids.slice(0, PAGE);
    const [summaries, collages] = await Promise.all([this.summaries(pageIds, viewerId), withCollage ? this.collages(pageIds) : null]);
    const items = pageIds.flatMap((id) => {
      const s = summaries.get(id);
      if (!s) return [];
      return [collages ? { ...s, collage: collages.get(id) ?? [] } : s];
    });
    return { items, hasMore, nextOffset: hasMore ? offset + PAGE : null };
  }

  /**
   * `ListingsService.sellerSummary` for many people at once: a fixed handful of grouped queries instead of 7–9 per
   * person, so a page of 30 costs about ten round trips whatever its size.
   */
  private async summaries(ids: string[], viewerId?: string) {
    const [users, listingCounts, followers, following, deals, ratings, viewerFollows] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, city: true, bio: true, createdAt: true, bundleDiscounts: true, brandVerifiedAt: true, brandName: true, avatar: { select: { key: true, provider: true } } },
      }),
      this.prisma.listing.groupBy({ by: ['sellerId', 'status'], where: { sellerId: { in: ids }, status: { in: ['PUBLISHED', 'RESERVED', 'SOLD'] } }, _count: { _all: true } }),
      this.prisma.follow.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.follow.groupBy({ by: ['followerId'], where: { followerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.buyRequest.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, status: 'COMPLETED' }, _count: { _all: true } }),
      this.prisma.review.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, hidden: false }, _avg: { rating: true }, _count: { _all: true } }),
      viewerId ? this.prisma.follow.findMany({ where: { followerId: viewerId, sellerId: { in: ids } }, select: { sellerId: true } }) : [],
    ]);
    const active = new Map<string, number>();
    const sold = new Map<string, number>();
    for (const r of listingCounts) {
      const m = r.status === 'SOLD' ? sold : active;
      m.set(r.sellerId, (m.get(r.sellerId) ?? 0) + r._count._all);
    }
    const followerCount = new Map(followers.map((r) => [r.sellerId, r._count._all]));
    const followingCount = new Map(following.map((r) => [r.followerId, r._count._all]));
    const dealCount = new Map(deals.map((r) => [r.sellerId, r._count._all]));
    const ratingOf = new Map(ratings.map((r) => [r.sellerId, r]));
    const followed = new Set(viewerFollows.map((f) => f.sellerId));
    return new Map(
      users.map((user) => {
        const { bundleDiscounts, avatar, brandVerifiedAt, brandName, ...profile } = user;
        const rating = ratingOf.get(user.id);
        return [
          user.id,
          {
            brand: brandVerifiedAt ? (brandName ?? user.username) : null,
            ...profile,
            avatar: avatar ? photoUrls(avatar) : null,
            activeCount: active.get(user.id) ?? 0,
            soldCount: sold.get(user.id) ?? 0,
            followers: followerCount.get(user.id) ?? 0,
            following: followingCount.get(user.id) ?? 0,
            completedDeals: dealCount.get(user.id) ?? 0,
            isFollowing: !!viewerId && viewerId !== user.id && followed.has(user.id),
            rating: rating?._count._all ? { avg: Math.round((rating._avg.rating ?? 0) * 10) / 10, count: rating._count._all } : null,
            bundleDiscounts: tiersOf(bundleDiscounts),
          },
        ] as const;
      }),
    );
  }

  /** `ListingsService.collage` for many sellers: one windowed query for the candidates, one for their cover photos. */
  private async collages(ids: string[]) {
    const out = new Map<string, ({ width: number; height: number; urls: ReturnType<typeof photoUrls> } | null)[]>();
    if (!ids.length) return out;
    const latest = await this.prisma.$queryRaw<Array<{ id: string; sellerId: string; category: string; subcategory: string | null }>>`
      SELECT id, "sellerId", category, subcategory FROM (
        SELECT id, "sellerId", category, subcategory, "publishedAt",
               ROW_NUMBER() OVER (PARTITION BY "sellerId" ORDER BY "publishedAt" DESC NULLS LAST) AS rn
        FROM "Listing" WHERE "sellerId" IN (${Prisma.join(ids)}) AND status = 'PUBLISHED'
      ) t WHERE rn <= ${COLLAGE_POOL} ORDER BY "sellerId", rn`;
    const bySeller = new Map<string, typeof latest>();
    for (const l of latest) bySeller.set(l.sellerId, [...(bySeller.get(l.sellerId) ?? []), l]);
    const picks = new Map<string, string[]>();
    for (const [sellerId, rows] of bySeller) {
      // Same choice as the single-seller collage: one item per kind first, then the latest ones to fill four.
      const picked: typeof rows = [];
      const kinds = new Set<string>();
      for (const l of rows) {
        if (picked.length === 4 || kinds.has(kindOf(l))) continue;
        kinds.add(kindOf(l));
        picked.push(l);
      }
      for (const l of rows) if (picked.length < 4 && !picked.includes(l)) picked.push(l);
      picks.set(sellerId, picked.map((l) => l.id));
    }
    const listingIds = [...picks.values()].flat();
    const photos = listingIds.length
      ? await this.prisma.photo.findMany({ where: { listingId: { in: listingIds } }, orderBy: [{ isCover: 'desc' }, { order: 'asc' }], select: { listingId: true, width: true, height: true, key: true, provider: true } })
      : [];
    const cover = new Map<string, (typeof photos)[number]>();
    for (const p of photos) if (p.listingId && !cover.has(p.listingId)) cover.set(p.listingId, p);
    for (const [sellerId, lids] of picks) {
      out.set(
        sellerId,
        lids.map((id) => {
          const p = cover.get(id);
          return p ? { width: p.width, height: p.height, urls: photoUrls(p) } : null;
        }),
      );
    }
    return out;
  }
}
