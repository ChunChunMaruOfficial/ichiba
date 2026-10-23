import { BadRequestException, Body, Controller, Delete, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { AuthService, EMAIL_RE } from '../auth/auth.service.js';
import { ZodPipe } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const EmailDto = z.object({ email: z.string().trim().toLowerCase().max(254).regex(EMAIL_RE, 'Проверьте адрес почты') });
const ConfirmDto = EmailDto.extend({ code: z.string().trim().regex(/^\d{6}$/, 'Код из 6 цифр') });

/**
 * Settings → «Почта для уведомлений»: a seller or brand binds one address, proven by a code sent there, and gets
 * the notifications that matter by email (mail.module NotifyEmails). The sign-in address, already confirmed, is
 * bound in one tap. Binding another address replaces the old one; the email footer's «Отписаться» unbinds it.
 */
@Controller('users/me/notify-email')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class NotifyEmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  private async seller(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, notifyEmail: true, brandVerifiedAt: true, catalogApprovedAt: true, _count: { select: { listings: true } } },
    });
    if (!u.brandVerifiedAt && !u.catalogApprovedAt && !u._count.listings) throw new ForbiddenException({ message: 'Письма об уведомлениях — для продавцов и брендов: сначала выставьте вещь' });
    return u;
  }

  /** Sends a code to the address, or binds the confirmed sign-in address right away. */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  async start(@CurrentUser() user: AuthUser, @Body(new ZodPipe(EmailDto)) { email }: z.infer<typeof EmailDto>) {
    const u = await this.seller(user.id);
    if (u.notifyEmail === email) throw new BadRequestException({ message: 'Эта почта уже привязана', fields: { email: 'Уже привязана' } });
    if (u.email === email && u.emailVerifiedAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { notifyEmail: email } });
      return { bound: true, me: await this.users.me(user.id) };
    }
    await this.auth.issueCode(email, 'NOTIFY', { userId: user.id });
    return { bound: false, target: email, resendIn: 60 };
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ConfirmDto)) { email, code }: z.infer<typeof ConfirmDto>) {
    await this.seller(user.id);
    // Only a code this account asked for: someone else's request for the same address doesn't count.
    await this.auth.consumeCode(email, 'NOTIFY', code, { payload: { path: ['userId'], equals: user.id } });
    await this.prisma.user.update({ where: { id: user.id }, data: { notifyEmail: email } });
    return { bound: true, me: await this.users.me(user.id) };
  }

  @Delete()
  async unbind(@CurrentUser() user: AuthUser) {
    await this.prisma.user.update({ where: { id: user.id }, data: { notifyEmail: null } });
    return { me: await this.users.me(user.id) };
  }
}
