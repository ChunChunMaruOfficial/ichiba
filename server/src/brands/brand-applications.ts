import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { AdminGuard } from '../moderation/moderation.js';
import { reclassifySeller } from '../listings/market.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * «Статус бренда»: a seller applies from Settings with the brand's details and contacts; an admin reviews the
 * application in the admin panel. An approved brand gets the «Бренд» seal on its items and profile.
 *
 * The same flow admits a seller who is not a brand (a reseller of original items) to the main catalogue
 * (kind CATALOG): the admin checks the seller and their stock; after approval their new items with tags are listed
 * in the catalogue, worn ones stay on «Вторичка».
 */
const KINDS = ['BRAND', 'CATALOG'] as const;
type Kind = (typeof KINDS)[number];

const LEGAL_FORMS = ['IP', 'LLC', 'SELF_EMPLOYED', 'PERSON'] as const;
const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const ApplicationDto = z
  .object({
    kind: z.enum(KINDS).default('BRAND'),
    brandName: z.string().trim().min(2, 'Укажите название бренда').max(60),
    legalForm: z.enum(LEGAL_FORMS),
    legalName: opt(120),
    unp: z
      .string()
      .trim()
      .regex(/^\d{9}$/, 'УНП — 9 цифр')
      .nullish()
      .or(z.literal('').transform(() => null)),
    contactName: z.string().trim().min(2, 'Как к вам обращаться').max(80),
    email: z.email('Проверьте почту').nullish().or(z.literal('').transform(() => null)),
    phone: opt(30),
    telegram: opt(40),
    links: z.array(z.string().trim().max(200)).max(5).default([]).transform((l) => l.filter(Boolean)),
    description: z.string().trim().min(20, 'Расскажите о бренде хотя бы в паре предложений').max(2000),
  })
  .refine((d) => d.email || d.phone || d.telegram, { message: 'Оставьте хотя бы один контакт', path: ['email'] })
  .refine((d) => !['IP', 'LLC'].includes(d.legalForm) || d.unp, { message: 'Для ИП и организации нужен УНП', path: ['unp'] });

@Injectable()
export class BrandApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async mine(userId: string) {
    const [user, last] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { brandVerifiedAt: true, brandName: true, catalogApprovedAt: true } }),
      this.prisma.brandApplication.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      brand: user.brandVerifiedAt ? { name: user.brandName, since: user.brandVerifiedAt } : null,
      /** Admitted to the main catalogue without being a brand. */
      catalog: user.catalogApprovedAt ? { since: user.catalogApprovedAt } : null,
      application: last,
    };
  }

  async apply(userId: string, dto: z.infer<typeof ApplicationDto>) {
    const { brand, catalog, application } = await this.mine(userId);
    if (brand) throw new ConflictException({ message: 'У вас уже есть статус бренда' });
    if (dto.kind === 'CATALOG' && catalog) throw new ConflictException({ message: 'Вы уже размещаетесь в основном каталоге' });
    if (application?.status === 'PENDING') throw new ConflictException({ message: 'Заявка уже на рассмотрении' });
    return this.prisma.brandApplication.create({ data: { userId, ...dto } });
  }

  list(status: string) {
    return this.prisma.brandApplication.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, username: true, email: true, createdAt: true, brandVerifiedAt: true, catalogApprovedAt: true, _count: { select: { listings: { where: { status: 'PUBLISHED' } } } } } } },
    });
  }

  /**
   * Approve or decline. The answer is final: an application already reviewed can't be reviewed again (a new one is
   * filed instead).
   */
  async review(adminId: string, id: string, approve: boolean, note: string | null, opts: { brandName?: string | null } = {}) {
    const a = await this.prisma.brandApplication.findUnique({ where: { id } });
    if (!a) throw new NotFoundException({ message: 'Заявка не найдена' });
    if (a.status !== 'PENDING') throw new ConflictException({ message: 'Заявка уже рассмотрена' });
    if (!approve && !note) throw new BadRequestException({ message: 'Напишите причину отказа — её увидит пользователь', fields: { note: 'Причина отказа' } });
    const kind = a.kind as Kind;
    const name = opts.brandName?.trim() || a.brandName;
    await this.prisma.$transaction(async (tx) => {
      // Guarded: two admins answering at once can't both apply their answer.
      const { count } = await tx.brandApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', adminNote: note, reviewedAt: new Date() } });
      if (!count) throw new ConflictException({ message: 'Заявка уже рассмотрена' });
      if (approve) {
        const user = await tx.user.update({
          where: { id: a.userId },
          data: kind === 'BRAND' ? { brandVerifiedAt: new Date(), brandName: name } : { catalogApprovedAt: new Date() },
          select: { brandVerifiedAt: true, catalogApprovedAt: true },
        });
        // The seller's items follow the rules again; items an admin placed by hand stay where they are.
        await reclassifySeller(tx, a.userId, user);
      }
      await tx.moderationAction.create({
        data: { moderatorId: adminId, targetType: 'USER', targetId: a.userId, action: `${kind === 'BRAND' ? 'brand' : 'catalog'}_${approve ? 'approve' : 'reject'}`, reason: note },
      });
    });
    const type = kind === 'BRAND' ? (approve ? 'brand_approved' : 'brand_rejected') : approve ? 'catalog_approved' : 'catalog_rejected';
    await this.notifications.notify(a.userId, type, { brand: name, note });
    return { ok: true };
  }

  /** Takes a status away (e.g. granted by mistake); the seller's automatically placed items follow the rules again. */
  async revoke(adminId: string, userId: string, note: string | null, kind: Kind = 'BRAND') {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: kind === 'BRAND' ? { brandVerifiedAt: null } : { catalogApprovedAt: null },
        select: { brandVerifiedAt: true, catalogApprovedAt: true },
      });
      await reclassifySeller(tx, userId, user);
      await tx.moderationAction.create({ data: { moderatorId: adminId, targetType: 'USER', targetId: userId, action: kind === 'BRAND' ? 'brand_revoke' : 'catalog_revoke', reason: note } });
    });
    return { ok: true };
  }
}

@Controller('brand-application')
export class BrandApplicationsController {
  constructor(private readonly brands: BrandApplicationsService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.brands.mine(user.id);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  apply(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ApplicationDto)) dto: z.infer<typeof ApplicationDto>) {
    return this.brands.apply(user.id, dto);
  }
}

const ReviewDto = z.object({
  note: z.string().trim().max(1000).nullish().transform((v) => v || null),
  brandName: z.string().trim().max(60).nullish(),
  kind: z.enum(KINDS).optional(),
});

@Controller('admin/brand-applications')
@UseGuards(AdminGuard)
export class AdminBrandApplicationsController {
  constructor(private readonly brands: BrandApplicationsService) {}

  @Get()
  async list(@Query('status') status = 'PENDING') {
    return { items: await this.brands.list(status) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewDto)) dto: z.infer<typeof ReviewDto>) {
    return this.brands.review(admin.id, id, true, dto.note, { brandName: dto.brandName });
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewDto)) dto: z.infer<typeof ReviewDto>) {
    return this.brands.review(admin.id, id, false, dto.note);
  }

  @Post('users/:userId/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() admin: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(ReviewDto)) dto: z.infer<typeof ReviewDto>) {
    return this.brands.revoke(admin.id, userId, dto.note, dto.kind ?? 'BRAND');
  }
}
