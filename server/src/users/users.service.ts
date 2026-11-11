import {
  ConflictException, BadRequestException, Body, Controller, Injectable, Patch } from '@nestjs/common';
import { z } from 'zod';
import { findContacts } from '../ai/text-rules.js';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { USERNAME_RE } from '../auth/auth.service.js';
import { CITIES } from '../catalog/catalog.js';
import { ZodPipe } from '../common/zod.js';
import { ChatService } from '../chat/chat.js';
import { Prisma } from '../generated/prisma/client.js';
import { BundleTiersDto } from '../listings/bundle.js';
import { BodyMeasurementsDto, SizesDto } from '../listings/fit.js';
import { emailPrefsOf } from '../mail/mail.module.js';
import { NOTIFY_GROUPS } from '../mail/templates.js';
import { photoUrls } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { botEnabled } from '../telegram/bot-api.js';
import { tgPrefsOf } from '../telegram/texts.js';
import { recordActivity } from '../activity/activity.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  /** Session payload: profile + header counters (frame 05: 🔔 unread, wardrobe badge for pending sales). */
  async me(userId: string) {
    const now = new Date();
    const [user, unreadNotifications, pendingRequests, pendingOffers, cartCount, unreadMessages, listings] = await Promise.all([
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
          uiPrefs: true,
          notifyEmail: true,
          tgChatId: true,
          tgUsername: true,
          tgLinkedAt: true,
          tgPrefs: true,
          tgSessionVersion: true,
          sessionVersion: true,
          role: true,
          onboardedAt: true,
          createdAt: true,
          brandVerifiedAt: true,
          avatar: { select: { key: true, provider: true } },
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
      this.prisma.listing.count({ where: { sellerId: userId, status: { not: 'DELETED' } } }),
    ]);
    const { emailVerifiedAt, emailPrefs, avatar, brandVerifiedAt, tgChatId, tgUsername, tgLinkedAt, tgPrefs, tgSessionVersion, sessionVersion, ...profile } = user;
    // A link made before a password reset (or a block) is void: the bot ignores it, so the page shows it unlinked.
    const tgLinked = !!tgChatId && tgSessionVersion === sessionVersion;
    return {
      ...profile,
      avatar: avatar ? photoUrls(avatar) : null,
      emailVerified: !!emailVerifiedAt,
      emailPrefs: emailPrefsOf(emailPrefs),
      bundleDiscounts: profile.bundleDiscounts ?? [],
      unreadNotifications,
      pendingSales: pendingRequests,
      pendingOffers,
      cartCount,
      unreadMessages,
      /** Has listed anything (drafts included): seller tools in the menu only make sense then. */
      isSeller: listings > 0,
      /** Brand status: the sell form offers the seals («Бренд», «Новинка»…) only then. */
      isBrand: !!brandVerifiedAt,
      /** Notifications in Telegram (settings · Telegram): whether the bot is configured and this account linked. */
      telegram: { available: botEnabled(), linked: tgLinked, username: tgLinked ? tgUsername : null, linkedAt: tgLinked ? tgLinkedAt : null, prefs: tgPrefsOf(tgPrefs) },
    };
  }
}

const UpdateMeDto = z.object({
  /** The nickname, changed on the wardrobe page itself; the old /u/… address stops working. */
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, 'Латиница, цифры и _, от 3 до 24 символов').optional(),
  city: z.enum(CITIES as [string, ...string[]]).nullish(),
  bio: z
    .string()
    .trim()
    .max(160, 'До 160 символов')
    // The profile is not a way around the deal: buyers write in the chat here, and contacts open up once a deal is on.
    .refine((v) => !findContacts(v).length, 'Контакты и ссылки в профиле запрещены — покупатели напишут вам в чат ichiba')
    .nullish(),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((v) => v.replace(/[\s()-]/g, ''))
    .refine((v) => !v || /^\+?\d{7,15}$/.test(v), 'Введите номер в формате +375 29 123-45-67')
    .nullish(),
  sizes: SizesDto.nullish(),
  bodyMeasurements: BodyMeasurementsDto.nullish(),
  bundleDiscounts: BundleTiersDto.optional(),
  emailPrefs: z.object({ deals: z.boolean().optional(), notifyOff: z.array(z.enum(NOTIFY_GROUPS)).max(NOTIFY_GROUPS.length).optional() }).strict().optional(),
  /** A part of the look settings (client lib/prefs.ts): merged into what is stored. */
  uiPrefs: z.object({ cardStyle: z.enum(['minimal', 'detailed']).optional(), theme: z.enum(['system', 'light', 'dark']).optional() }).strict().optional(),
  onboarded: z.boolean().optional(),
  /** One of the user's own uploaded photos (?for=avatar), or null to remove it. */
  avatarId: z.uuid().nullish(),
});

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(UpdateMeDto)) dto: z.infer<typeof UpdateMeDto>) {
    const { onboarded, sizes, bodyMeasurements, bundleDiscounts, emailPrefs, avatarId, uiPrefs, ...rest } = dto;
    const storedPrefs = uiPrefs !== undefined ? ((await this.prisma.user.findUnique({ where: { id: user.id }, select: { uiPrefs: true } }))?.uiPrefs as object | null) ?? {} : undefined;
    // A part of the mail settings (one switch) is merged into what is stored, as the look settings are.
    const storedMail = emailPrefs !== undefined ? emailPrefsOf((await this.prisma.user.findUnique({ where: { id: user.id }, select: { emailPrefs: true } }))?.emailPrefs) : undefined;
    if (avatarId) {
      const photo = await this.prisma.photo.findUnique({ where: { id: avatarId }, select: { ownerId: true, listingId: true, messageId: true } });
      if (!photo || photo.ownerId !== user.id || photo.listingId || photo.messageId) throw new BadRequestException({ message: 'Это фото нельзя поставить на аватар' });
    }
    const json = (v: unknown) => (v ?? undefined) as Prisma.InputJsonValue | undefined;
    // A phone that moves is a phone nobody has confirmed yet.
    const phoneChange = rest.phone !== undefined ? { phone: rest.phone || null, phoneVerifiedAt: null } : {};
    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...rest,
          ...phoneChange,
          ...(sizes !== undefined ? { sizes: json(sizes) } : {}),
          ...(bodyMeasurements !== undefined ? { bodyMeasurements: json(bodyMeasurements) } : {}),
          ...(bundleDiscounts !== undefined ? { bundleDiscounts: [...bundleDiscounts].sort((a, b) => a.minItems - b.minItems) } : {}),
          ...(emailPrefs !== undefined ? { emailPrefs: { ...storedMail, ...emailPrefs } } : {}),
          ...(uiPrefs !== undefined ? { uiPrefs: { ...storedPrefs, ...uiPrefs } } : {}),
          ...(onboarded ? { onboardedAt: new Date() } : {}),
          ...(avatarId !== undefined ? { avatarId } : {}),
        },
      });
    } catch (e) {
      // The number or the nickname belongs to another account (unique columns): say so instead of a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
        if (target.includes('username')) throw new ConflictException({ message: '@' + rest.username + ' занят', fields: { username: 'Ник занят' } });
        throw new ConflictException({ message: 'Этот номер уже привязан к другому аккаунту', fields: { phone: 'Номер занят' } });
      }
      throw e;
    }
    // A look setting is not a profile edit for the admin log.
    const edited = Object.keys(dto).filter((k) => k !== 'uiPrefs');
    if (edited.length) recordActivity(this.prisma, user.id, 'profile_edited', { detail: edited.join(', ') });
    return this.users.me(user.id);
  }
}
