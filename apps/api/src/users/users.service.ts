import { Body, Controller, Injectable, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { CITIES } from '../catalog/catalog.js';
import { ZodPipe } from '../common/zod.js';
import { ChatService } from '../chat/chat.js';
import type { Prisma } from '../generated/prisma/client.js';
import { BundleTiersDto } from '../listings/bundle.js';
import { BodyMeasurementsDto, SizesDto } from '../listings/fit.js';
import { emailPrefsOf } from '../mail/mail.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  /** Session payload: profile + header counters (frame 05: 🔔 unread, wardrobe badge for pending sales). */
  async me(userId: string) {
    const now = new Date();
    const [user, unreadNotifications, pendingRequests, pendingOffers, cartCount, unreadMessages] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          emailVerifiedAt: true,
          phone: true,
          city: true,
          bio: true,
          sizes: true,
          bodyMeasurements: true,
          bundleDiscounts: true,
          emailPrefs: true,
          role: true,
          onboardedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.buyRequest.count({ where: { sellerId: userId, status: 'PENDING_SELLER' } }),
      // Offers waiting for my answer: incoming as a seller, counter-offers as a buyer.
      this.prisma.offer.count({
        where: { status: 'PENDING', expiresAt: { gt: now }, OR: [{ sellerId: userId, from: 'BUYER' }, { buyerId: userId, from: 'SELLER' }] },
      }),
      this.prisma.cartItem.count({ where: { userId, listing: { status: { in: ['PUBLISHED', 'RESERVED'] } } } }),
      this.chat.unreadCount(userId),
    ]);
    const { emailVerifiedAt, emailPrefs, ...profile } = user;
    return {
      ...profile,
      emailVerified: !!emailVerifiedAt,
      emailPrefs: emailPrefsOf(emailPrefs),
      bundleDiscounts: profile.bundleDiscounts ?? [],
      unreadNotifications,
      pendingSales: pendingRequests,
      pendingOffers,
      cartCount,
      unreadMessages,
    };
  }
}

const UpdateMeDto = z.object({
  city: z.enum(CITIES as [string, ...string[]]).nullish(),
  bio: z.string().trim().max(160, 'До 160 символов').nullish(),
  phone: z.string().trim().max(30).nullish(),
  sizes: SizesDto.nullish(),
  bodyMeasurements: BodyMeasurementsDto.nullish(),
  bundleDiscounts: BundleTiersDto.optional(),
  emailPrefs: z.object({ deals: z.boolean() }).optional(),
  onboarded: z.boolean().optional(),
});

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(UpdateMeDto)) dto: z.infer<typeof UpdateMeDto>) {
    const { onboarded, sizes, bodyMeasurements, bundleDiscounts, emailPrefs, ...rest } = dto;
    const json = (v: unknown) => (v ?? undefined) as Prisma.InputJsonValue | undefined;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...rest,
        ...(sizes !== undefined ? { sizes: json(sizes) } : {}),
        ...(bodyMeasurements !== undefined ? { bodyMeasurements: json(bodyMeasurements) } : {}),
        ...(bundleDiscounts !== undefined ? { bundleDiscounts: [...bundleDiscounts].sort((a, b) => a.minItems - b.minItems) } : {}),
        ...(emailPrefs !== undefined ? { emailPrefs } : {}),
        ...(onboarded ? { onboardedAt: new Date() } : {}),
      },
    });
    return this.users.me(user.id);
  }
}
