import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * SMTP delivery via Nodemailer. Two setups work (see docs/EMAIL.md):
 *  A) external SMTP with login (mail.hosting.reg.ru:465, SendGrid, Mailgun…): SMTP_HOST/PORT/SECURE/USER/PASS;
 *  B) local Postfix relay on the same server: SMTP_HOST=localhost, SMTP_PORT=25, no USER/PASS.
 * Email is enabled by SMTP_HOST alone — SMTP_USER is optional (Postfix has no auth).
 *  C) Brevo HTTP API (BREVO_API_KEY): for hosts that block outbound SMTP (Railway Free/Hobby). The sender
 *     (SMTP_FROM) must be a verified sender in Brevo; a plain Gmail address works, no own domain needed.
 * Without SMTP_HOST / BREVO_API_KEY (or with MAIL_PROVIDER=log) messages are printed to the API log instead.
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

  /** "brevo" with BREVO_API_KEY, else "smtp" when SMTP_HOST is set; MAIL_PROVIDER=log forces the log. */
  get mode(): 'brevo' | 'smtp' | 'log' {
    if ((process.env.MAIL_PROVIDER || '').toLowerCase() === 'log') return 'log';
    if (process.env.BREVO_API_KEY) return 'brevo';
    return process.env.SMTP_HOST ? 'smtp' : 'log';
  }

  onModuleInit() {
    if (this.mode === 'brevo') {
      this.logger.log(`Email via Brevo API, from ${this.fromAddress}`);
      return;
    }
    if (this.mode !== 'smtp') {
      this.logger.log('Email is not configured (no BREVO_API_KEY or SMTP_HOST) — emails are written to this log');
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

  /** Sends one message; throws on delivery errors so the caller (outbox) can retry. */
  async send(mail: OutgoingMail) {
    if (this.mode === 'brevo') return this.sendBrevo(mail);
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

  private async sendBrevo(mail: OutgoingMail) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: this.fromName, email: this.fromAddress },
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        headers: mail.headers,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { messageId?: string };
    return { messageId: body.messageId ?? 'brevo' };
  }
}
