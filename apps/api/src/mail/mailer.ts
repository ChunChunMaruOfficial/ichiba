import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * SMTP delivery via Nodemailer. Two setups work (see docs/EMAIL.md):
 *  A) external SMTP with login (mail.hosting.reg.ru:465, SendGrid, Mailgun…): SMTP_HOST/PORT/SECURE/USER/PASS;
 *  B) local Postfix relay on the same server: SMTP_HOST=localhost, SMTP_PORT=25, no USER/PASS.
 * Email is enabled by SMTP_HOST alone — SMTP_USER is optional (Postfix has no auth).
 * Without SMTP_HOST (or with MAIL_PROVIDER=log) messages are printed to the API log instead.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

const isLocalHost = (h: string) => ['localhost', '127.0.0.1', '::1'].includes(h);

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;

  readonly fromAddress = process.env.SMTP_FROM || 'noreply@ichiba.by';
  readonly fromName = process.env.SMTP_FROM_NAME || 'ichiba';

  /** "smtp" when SMTP_HOST is set (unless MAIL_PROVIDER=log forces the log). */
  get mode(): 'smtp' | 'log' {
    if ((process.env.MAIL_PROVIDER || '').toLowerCase() === 'log') return 'log';
    return process.env.SMTP_HOST ? 'smtp' : 'log';
  }

  onModuleInit() {
    if (this.mode !== 'smtp') {
      this.logger.log('SMTP is not configured (SMTP_HOST empty) — emails are written to this log');
      return;
    }
    const host = process.env.SMTP_HOST!;
    const port = Number(process.env.SMTP_PORT) || 587;
    // 465 = implicit TLS; 587/25 = STARTTLS when the server offers it.
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
    // A local Postfix usually has a self-signed certificate; remote servers are verified unless told otherwise.
    const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED ? process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'true' : !isLocalHost(host);
    const user = process.env.SMTP_USER || '';
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: process.env.SMTP_PASS || '' } : undefined,
      tls: { rejectUnauthorized },
      // Postfix on localhost: plain connection is fine; never hang the request on a dead server.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      pool: true,
      maxConnections: 3,
    });
    this.transporter
      .verify()
      .then(() => this.logger.log(`SMTP ready: ${host}:${port} (secure=${secure}${user ? `, user=${user}` : ', no auth'})`))
      .catch((e: Error) => this.logger.error(`SMTP check failed for ${host}:${port}: ${e.message}. Emails will be retried from the outbox.`));
  }

  /** Sends one message; throws on SMTP errors so the caller (outbox) can retry. */
  async send(mail: OutgoingMail) {
    if (this.mode !== 'smtp' || !this.transporter) {
      this.logger.log(`[email → ${mail.to}] ${mail.subject}\n${mail.text}`);
      return { messageId: 'log' };
    }
    const info = await this.transporter.sendMail({
      from: { name: this.fromName, address: this.fromAddress },
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
    });
    return { messageId: info.messageId as string };
  }
}
