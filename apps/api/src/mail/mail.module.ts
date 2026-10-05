import { Controller, Get, Global, HttpCode, Injectable, Logger, Module, Post, Query, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailerService } from './mailer.js';
import { appUrl, codeEmail, DEAL_EMAIL_TYPES, dealEmail, esc } from './templates.js';

/** Retry schedule after a failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h; then the message is FAILED. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];

export interface EmailPrefs {
  deals: boolean;
}
export const emailPrefsOf = (raw: unknown): EmailPrefs => ({ deals: (raw as Partial<EmailPrefs> | null)?.deals !== false });

/**
 * Outbox: notification emails are stored first and sent by a worker, so an SMTP outage delays mail
 * instead of losing it, and an HTTP request never waits for SMTP.
 */
@Injectable()
export class EmailOutbox {
  private readonly logger = new Logger('Mail');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly jwt: JwtService,
  ) {}

  async enqueue(mail: { to: string; subject: string; html: string; text: string; kind: string; userId?: string | null }) {
    const row = await this.prisma.emailOutbox.create({ data: { ...mail, userId: mail.userId ?? null } });
    // Try right away; the cron picks it up again if this attempt fails.
    void this.deliver(row.id).catch(() => undefined);
  }

  private async deliver(id: string) {
    // Claim the row so the cron and the immediate attempt never send it twice.
    const claimed = await this.prisma.emailOutbox.updateMany({ where: { id, status: 'PENDING', sendAfter: { lte: new Date() } }, data: { status: 'SENDING' } });
    if (!claimed.count) return;
    const m = await this.prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    try {
      const headers: Record<string, string> = {};
      if (m.userId && DEAL_EMAIL_TYPES.has(m.kind)) {
        // RFC 8058 one-click unsubscribe (Gmail / Яндекс show an "Отписаться" button).
        const url = unsubscribeUrl(unsubscribeToken(this.jwt, m.userId));
        headers['List-Unsubscribe'] = `<${url}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }
      await this.mailer.send({ to: m.to, subject: m.subject, html: m.html, text: m.text, headers });
      await this.prisma.emailOutbox.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    } catch (e) {
      const attempts = m.attempts + 1;
      const failed = attempts > BACKOFF_MS.length;
      await this.prisma.emailOutbox.update({
        where: { id },
        data: { status: failed ? 'FAILED' : 'PENDING', attempts, lastError: (e as Error).message.slice(0, 500), sendAfter: new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? 0)) },
      });
      this.logger.warn(`email ${id} to ${m.to} failed (attempt ${attempts}${failed ? ', giving up' : ''}): ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async flush() {
    if (this.running) return;
    this.running = true;
    try {
      // Rows stuck in SENDING (process restarted mid-send) go back to the queue after 5 minutes.
      await this.prisma.emailOutbox.updateMany({ where: { status: 'SENDING', createdAt: { lt: new Date(Date.now() - 5 * 60_000) }, sentAt: null }, data: { status: 'PENDING' } });
      const due = await this.prisma.emailOutbox.findMany({ where: { status: 'PENDING', sendAfter: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 50, select: { id: true } });
      for (const d of due) await this.deliver(d.id);
    } finally {
      this.running = false;
    }
  }
}

const unsubscribeToken = (jwt: JwtService, userId: string) => jwt.sign({ sub: userId, purpose: 'unsubscribe' }, { expiresIn: '3650d' });
const unsubscribeUrl = (token: string) => `${appUrl()}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;

/** Turns deal notifications into emails for users with a verified address who haven't opted out. */
@Injectable()
export class DealEmails {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutbox,
    private readonly jwt: JwtService,
  ) {}

  async maybeSend(userIds: string[], type: string, payload: Record<string, unknown>) {
    if (!DEAL_EMAIL_TYPES.has(type)) return;
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds }, email: { not: null }, emailVerifiedAt: { not: null }, blockedAt: null }, select: { id: true, email: true, emailPrefs: true } });
    for (const u of users) {
      if (!emailPrefsOf(u.emailPrefs).deals) continue;
      const mail = dealEmail(type, payload, unsubscribeUrl(unsubscribeToken(this.jwt, u.id)));
      if (mail) await this.outbox.enqueue({ to: u.email!, ...mail, kind: type, userId: u.id });
    }
  }
}

/** Verification codes go out synchronously: the user is waiting on the screen. */
@Injectable()
export class CodeMailer {
  constructor(private readonly mailer: MailerService) {}

  get enabled() {
    return this.mailer.mode === 'smtp';
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
  providers: [MailerService, EmailOutbox, DealEmails, CodeMailer],
  controllers: [EmailController],
  exports: [MailerService, EmailOutbox, DealEmails, CodeMailer],
})
export class MailModule {}
