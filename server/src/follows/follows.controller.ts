import { BadRequestException, Controller, Delete, NotFoundException, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { visibleProfile } from '../users/visibility.js';

@Controller('follows')
export class FollowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
  ) {}

  /** Following a hidden or deleted account isn't possible; unfollowing it is (the button may still be on a stale page). */
  private async seller(username: string, mustBeVisible = true) {
    if (mustBeVisible) return visibleProfile(this.prisma, username);
    const seller = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!seller) throw new NotFoundException({ message: 'Такого гардероба нет' });
    return seller;
  }

  @Post(':username')
  async follow(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    const seller = await this.seller(username);
    if (seller.id === user.id) throw new BadRequestException({ message: 'Нельзя подписаться на себя' });
    const existing = await this.prisma.follow.findUnique({ where: { followerId_sellerId: { followerId: user.id, sellerId: seller.id } } });
    if (!existing) {
      await this.prisma.follow.create({ data: { followerId: user.id, sellerId: seller.id } });
      await this.recs.record(user.id, 'follow');
    }
    return { isFollowing: true };
  }

  @Delete(':username')
  async unfollow(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    const seller = await this.seller(username, false);
    await this.prisma.follow.deleteMany({ where: { followerId: user.id, sellerId: seller.id } });
    return { isFollowing: false };
  }
}
