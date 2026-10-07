import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

const SUBJECT: Record<string, string> = {
  VERIFY: 'Код подтверждения ichiba',
  RESET: 'Сброс пароля ichiba',
  LOGIN: 'Код для входа в ichiba',
};

/**
 * Delivers 6-digit codes.
 * Email — MAIL_PROVIDER: `resend` (RESEND_API_KEY), `smtp` (SMTP_URL or SMTP_HOST/PORT/USER/PASS), `log` (dev: API log).
 * SMS — SMS_PROVIDER: `twilio` (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM), `log`.
 * MAIL_FROM is the sender, e.g. `ichiba <no-reply@your-domain.com>`.
 */
@Injectable()
export class CodeSenderService {
  private readonly logger = new Logger('Codes');
  private smtp: Transporter | null = null;

  async send(target: string, code: string, purpose: string) {
    const isEmail = target.includes('@');
    const provider = (isEmail ? process.env.MAIL_PROVIDER : process.env.SMS_PROVIDER) || 'log';
    try {
      if (provider === 'log') {
        this.logger.log(`[${purpose}] code for ${target}: ${code}`);
        return;
      }
      if (isEmail && provider === 'resend') return await this.resend(target, code, purpose);
      if (isEmail && provider === 'smtp') return await this.sendSmtp(target, code, purpose);
      if (!isEmail && provider === 'twilio') return await this.twilio(target, code);
    } catch (e) {
      this.logger.error(`${provider} failed for ${purpose}: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ message: isEmail ? 'Не удалось отправить письмо. Повторите через минуту' : 'Не удалось отправить SMS. Повторите через минуту' });
    }
    throw new ServiceUnavailableException({ message: isEmail ? 'Отправка писем не настроена' : 'Вход по телефону пока недоступен — используйте email' });
  }

  private text(code: string, purpose: string) {
    const what = purpose === 'RESET' ? 'сброса пароля' : 'подтверждения';
    return {
      subject: `${code} — ${SUBJECT[purpose] ?? SUBJECT.VERIFY}`,
      text: `Ваш код ${what}: ${code}\n\nКод действует 10 минут. Если вы не запрашивали код, просто проигнорируйте это письмо.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>Ваш код ${what}:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
<p style="color:#666">Код действует 10 минут. Если вы не запрашивали код, просто проигнорируйте это письмо.</p></div>`,
    };
  }

  private from() {
    const from = process.env.MAIL_FROM;
    if (!from) throw new Error('MAIL_FROM is not set');
    return from;
  }

  private async resend(to: string, code: string, purpose: string) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from(), to: [to], ...this.text(code, purpose) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  private async sendSmtp(to: string, code: string, purpose: string) {
    this.smtp ??= process.env.SMTP_URL
      ? nodemailer.createTransport(process.env.SMTP_URL)
      : nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: Number(process.env.SMTP_PORT ?? 587) === 465,
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
    await this.smtp.sendMail({ from: this.from(), to, ...this.text(code, purpose) });
  }

  private async twilio(to: string, code: string) {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
    if (!sid || !token || !from) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: `ichiba: ваш код ${code}. Никому его не сообщайте.` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
