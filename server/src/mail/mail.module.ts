import { Controller, Get, Global, HttpCode, Injectable, Module, Post, Query, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailerService } from './mailer.js';
import { appUrl, codeEmail, esc } from './templates.js';

export interface EmailPrefs {
  deals: boolean;
}
export const emailPrefsOf = (raw: unknown): EmailPrefs => ({ deals: (raw as Partial<EmailPrefs> | null)?.deals !== false });

/** Verification codes go out synchronously: the user is waiting on the screen. */
@Injectable()
export class CodeMailer {
  constructor(private readonly mailer: MailerService) {}

  get enabled() {
    return this.mailer.mode !== 'log';
  }

  async send(to: string, code: string, purpose: string) {
    const mail = codeEmail(code, purpose);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.mailer.send({ to, ...mail });
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw lastError;
  }
}

const page = (title: string, text: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#eeefec;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1e2433">
<div style="max-width:480px;margin:12vh auto;padding:28px;background:#fff;border-radius:20px">
<p style="margin:0 0 12px;font-weight:700">ichiba</p><h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1><p style="margin:0 0 20px;line-height:1.5">${esc(text)}</p>
<a href="${esc(appUrl())}/settings" style="color:#1e2433">Настройки уведомлений</a></div></body></html>`;

@Controller('email')
class EmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async unsubscribe(token: string | undefined) {
    try {
      const p = this.jwt.verify<{ sub: string; purpose: string }>(token ?? '');
      if (p.purpose !== 'unsubscribe') return false;
      const u = await this.prisma.user.findUnique({ where: { id: p.sub }, select: { emailPrefs: true } });
      if (!u) return false;
      await this.prisma.user.update({ where: { id: p.sub }, data: { emailPrefs: { ...emailPrefsOf(u.emailPrefs), deals: false } } });
      return true;
    } catch {
      return false;
    }
  }

  /** Link from the email footer. */
  @Public()
  @Get('unsubscribe')
  async unsubscribePage(@Query('token') token: string, @Res() res: Response) {
    const ok = await this.unsubscribe(token);
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(ok ? page('Вы отписались', 'Письма о сделках больше не придут. Уведомления на сайте остаются. Включить письма снова можно в настройках.') : page('Ссылка недействительна', 'Не получилось отписаться по этой ссылке. Отключите письма в настройках профиля.'));
  }

  /** One-click unsubscribe from the mail client (RFC 8058). */
  @Public()
  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribeOneClick(@Query('token') token: string) {
    return { ok: await this.unsubscribe(token) };
  }
}

@Global()
@Module({
  providers: [MailerService, CodeMailer],
  controllers: [EmailController],
  exports: [MailerService, CodeMailer],
})
export class MailModule {}
