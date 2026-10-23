import { Body, ConflictException, Controller, Delete, ForbiddenException, HttpCode, Injectable, Logger, Res } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { AUTH_COOKIE, AuthUser, CurrentUser, forgetSessionStatus } from '../auth/auth.guard.js';
import { withJobLock } from '../common/job-lock.js';
import { ZodPipe } from '../common/zod.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { ACTIVE_REQUEST } from '../requests/requests.service.js';

const DAY = 24 * 3600 * 1000;

/**
 * Personal data lifecycle (privacy policy, sections "Сроки хранения" and "Ваши права").
 * - Account deletion by the owner: personal data is wiped; deals, messages and reviews stay for the other
 *   party but no longer point to a person (nickname replaced, contacts removed).
 * - Retention: technical records are deleted automatically once they are no longer needed.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger('Privacy');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** The nick as it is now: an admin may have renamed the account since its 30-day session token was issued. */
  async usernameOf(userId: string) {
    return (await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } })).username;
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.deletedAt) return;
    const [deals, leading, auctionsWithBids] = await Promise.all([
      this.prisma.buyRequest.count({ where: { status: { in: ACTIVE_REQUEST }, OR: [{ buyerId: userId }, { sellerId: userId }] } }),
      this.prisma.auction.count({ where: { status: 'ACTIVE', bids: { some: { bidderId: userId } } } }),
      this.prisma.auction.count({ where: { status: 'ACTIVE', listing: { sellerId: userId }, bids: { some: {} } } }),
    ]);
    if (deals) throw new ConflictException({ message: 'Сначала завершите или отмените активные сделки', code: 'ACTIVE_DEALS' });
    if (auctionsWithBids) throw new ConflictException({ message: 'У вас идёт аукцион со ставками — дождитесь его окончания', code: 'ACTIVE_AUCTION' });
    if (leading) throw new ConflictException({ message: 'Вы участвуете в аукционе — дождитесь его окончания', code: 'ACTIVE_BIDS' });

    const listingIds = (await this.prisma.listing.findMany({ where: { sellerId: userId, status: { not: 'DELETED' } }, select: { id: true } })).map((l) => l.id);
    await this.prisma.$transaction([
      this.prisma.auction.updateMany({ where: { listingId: { in: listingIds }, status: 'ACTIVE' }, data: { status: 'CANCELLED' } }),
      this.prisma.listing.updateMany({ where: { id: { in: listingIds }, status: { not: 'SOLD' } }, data: { status: 'DELETED' } }),
      this.prisma.offer.updateMany({ where: { status: 'PENDING', OR: [{ buyerId: userId }, { sellerId: userId }] }, data: { status: 'CANCELLED' } }),
      this.prisma.autoBid.deleteMany({ where: { bidderId: userId } }),
      this.prisma.favorite.deleteMany({ where: { userId } }),
      this.prisma.follow.deleteMany({ where: { OR: [{ followerId: userId }, { sellerId: userId }] } }),
      this.prisma.cartItem.deleteMany({ where: { userId } }),
      this.prisma.collection.deleteMany({ where: { userId } }),
      this.prisma.signal.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.emailOutbox.deleteMany({ where: { userId } }),
      // Photos and videos outside listings (drafts, chat) are detached; the nightly media cleanup deletes the files.
      this.prisma.photo.updateMany({ where: { ownerId: userId, listingId: null }, data: { messageId: null } }),
      this.prisma.video.updateMany({ where: { ownerId: userId, listingId: null }, data: { messageId: null } }),
      this.prisma.verificationCode.deleteMany({ where: { target: { in: [user.email, user.phone].filter((x): x is string => !!x) } } }),
      // A shared location is personal data: the message stays for the other side, the point does not.
      this.prisma.message.updateMany({ where: { senderId: userId, kind: 'LOCATION' }, data: { lat: null, lng: null, accuracy: null } }),
      // Contacts left in past deals are personal data too.
      this.prisma.buyRequest.updateMany({ where: { buyerId: userId }, data: { contactPhone: null, deliveryPoint: null, buyerComment: null } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          username: `deleted_${randomBytes(4).toString('hex')}`,
          email: null,
          phone: null,
          passwordHash: null,
          googleSub: null,
          appleSub: null,
          telegramId: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          city: null,
          bio: null,
          avatarId: null,
          sizes: Prisma.DbNull,
          bodyMeasurements: Prisma.DbNull,
          bundleDiscounts: Prisma.DbNull,
          emailPrefs: Prisma.DbNull,
          deletedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      }),
    ]);
    forgetSessionStatus(userId);
    this.logger.log(`account ${userId} deleted by its owner`);
  }

  /**
   * Daily at 04:00: technical data is kept only as long as the policy says. Each table is cleared on its own, in
   * batches, so a big backlog never holds one long transaction (and its locks) over every table at once.
   */
  @Cron('0 4 * * *')
  retention() {
    return withJobLock(this.redis, 'privacy.retention', 3600_000, async () => {
      const ago = (days: number) => new Date(Date.now() - days * DAY);
      const batch = async (name: string, del: () => Promise<{ count: number }>) => {
        let total = 0;
        for (let i = 0; i < 200; i++) {
          const { count } = await del();
          total += count;
          if (count < 5000) break;
        }
        return `${name} ${total}`;
      };
      const r = [
        await batch('codes', () => this.prisma.verificationCode.deleteMany({ where: { createdAt: { lt: ago(1) } }, limit: 5000 })),
        await batch('emails', () => this.prisma.emailOutbox.deleteMany({ where: { status: { in: ['SENT', 'FAILED'] }, createdAt: { lt: ago(30) } }, limit: 5000 })),
        await batch('ai runs', () => this.prisma.aiRun.deleteMany({ where: { createdAt: { lt: ago(90) } }, limit: 5000 })),
        await batch('notifications', () => this.prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: ago(180) } }, limit: 5000 })),
        await batch('signals', () => this.prisma.signal.deleteMany({ where: { createdAt: { lt: ago(365) } }, limit: 5000 })),
      ];
      this.logger.log(`retention: ${r.join(', ')}`);
    });
  }
}

const DeleteDto = z.object({ confirm: z.string().trim().min(1, 'Введите ник для подтверждения') });

@Controller('users')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** "Удалить аккаунт" in settings. The nickname is typed as confirmation. */
  @Delete('me')
  @HttpCode(200)
  async deleteMe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(DeleteDto)) dto: z.infer<typeof DeleteDto>, @Res({ passthrough: true }) res: Response) {
    const current = await this.privacy.usernameOf(user.id);
    if (dto.confirm.replace(/^@/, '').toLowerCase() !== current.toLowerCase()) throw new ForbiddenException({ message: 'Ник не совпадает', fields: { confirm: 'Ник не совпадает' } });
    await this.privacy.deleteAccount(user.id);
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }
}
