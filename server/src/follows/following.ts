import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { cardInclude } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Following / social layer (frame 16): new items from wardrobes I follow, and follower lists. */
@Controller()
export class FollowingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  @Get('following/feed')
  async feed(@CurrentUser() user: AuthUser, @Query('offset') offsetRaw = '0', @Query('limit') limitRaw = '24') {
    const offset = Number(offsetRaw) || 0;
    const limit = Math.min(Number(limitRaw) || 24, 48);
    const follows = await this.prisma.follow.findMany({ where: { followerId: user.id }, select: { sellerId: true } });
    const where = { sellerId: { in: follows.map((f) => f.sellerId) }, status: { in: ['PUBLISHED', 'RESERVED'] as ('PUBLISHED' | 'RESERVED')[] } };
    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({ where, include: cardInclude, orderBy: { publishedAt: 'desc' }, skip: offset, take: limit }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: await this.listings.cards(rows, user.id), total, following: follows.length };
  }

  @Get('following')
  async following(@CurrentUser() user: AuthUser) {
    const follows = await this.prisma.follow.findMany({ where: { followerId: user.id }, orderBy: { createdAt: 'desc' } });
    return { items: await Promise.all(follows.map((f) => this.sellerWithCollage(f.sellerId, user.id))) };
  }

  @Public()
  @Get('users/:username/followers')
  followers(@Param('username') username: string, @CurrentUser() viewer?: AuthUser) {
    return this.lists(username, 'followers', viewer);
  }

  @Public()
  @Get('users/:username/following')
  followingOf(@Param('username') username: string, @CurrentUser() viewer?: AuthUser) {
    return this.lists(username, 'following', viewer);
  }

  private async lists(username: string, list: 'followers' | 'following', viewer?: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!u) throw new NotFoundException({ message: 'Такого гардероба нет' });
    const rows =
      list === 'followers'
        ? (await this.prisma.follow.findMany({ where: { sellerId: u.id }, orderBy: { createdAt: 'desc' }, take: 200 })).map((f) => f.followerId)
        : (await this.prisma.follow.findMany({ where: { followerId: u.id }, orderBy: { createdAt: 'desc' }, take: 200 })).map((f) => f.sellerId);
    return { items: await Promise.all(rows.map((id) => this.sellerWithCollage(id, viewer?.id))) };
  }

  private async sellerWithCollage(sellerId: string, viewerId?: string) {
    const [summary, items] = await Promise.all([
      this.listings.sellerSummary(sellerId, viewerId),
      this.listings.collage(sellerId),
    ]);
    return { ...summary, collage: items };
  }
}
