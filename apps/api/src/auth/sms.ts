import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * SMS delivery for one-time codes.
 *
 * Provider: SMSC.ru (SMS_PROVIDER=smsc) — delivers to Belarusian operators (A1, МТС, life:), simple HTTPS API,
 * pay-as-you-go, alpha sender names. Without credentials (SMS_PROVIDER=log) the text goes to the API log.
 *
 * Fraud protection: SMS go only to allowed country codes (SMS_ALLOWED_PREFIXES, default Belarus), so nobody
 * can burn the balance by requesting codes to premium-rate numbers abroad ("SMS pumping").
 */

export class SmsError extends Error {
  constructor(
    message: string,
    /** Safe to show to the user. */
    readonly userMessage: string,
  ) {
    super(message);
  }
}

const allowedPrefixes = () =>
  (process.env.SMS_ALLOWED_PREFIXES ?? '+375')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

const phoneAllowed = (phone: string) => allowedPrefixes().some((p) => phone.startsWith(p));

/** Text of the code SMS. The last line lets Android/Chrome offer the code automatically (WebOTP). */
export function codeSms(code: string) {
  const host = (() => {
    try {
      return new URL(process.env.APP_URL || process.env.WEB_ORIGIN || '').host;
    } catch {
      return '';
    }
  })();
  const lines = [`Код ichiba: ${code}`, 'Никому его не сообщайте.'];
  // WebOTP needs a real domain; it is skipped on localhost.
  if (host && !host.startsWith('localhost')) lines.push('', `@${host} #${code}`);
  return lines.join('\n');
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger('SMS');

  get provider(): 'smsc' | 'log' {
    const p = (process.env.SMS_PROVIDER || 'log').toLowerCase();
    return p === 'smsc' && process.env.SMSC_LOGIN && process.env.SMSC_PASSWORD ? 'smsc' : 'log';
  }

  onModuleInit() {
    if (this.provider === 'log') this.logger.log('SMS provider is "log": codes are written to this log (set SMS_PROVIDER=smsc and SMSC_* to send real SMS)');
    else this.logger.log(`SMS via SMSC.ru, sender "${process.env.SMSC_SENDER || 'default'}", allowed: ${allowedPrefixes().join(', ')}`);
  }

  async send(phone: string, text: string) {
    if (!phoneAllowed(phone)) throw new SmsError(`blocked prefix ${phone}`, 'SMS отправляем только на белорусские номера (+375). Войдите по почте или через Google');
    if (this.provider === 'log') {
      this.logger.log(`[sms → ${phone}] ${text.replace(/\n/g, ' | ')}`);
      return;
    }
    const params = new URLSearchParams({
      login: process.env.SMSC_LOGIN!,
      psw: process.env.SMSC_PASSWORD!,
      phones: phone,
      mes: text,
      fmt: '3', // JSON response
      charset: 'utf-8',
      ...(process.env.SMSC_SENDER ? { sender: process.env.SMSC_SENDER } : {}),
    });
    let res: Response;
    try {
      // POST keeps the password out of proxy/access logs.
      res = await fetch(process.env.SMSC_URL || 'https://smsc.ru/sys/send.php', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new SmsError(`network: ${(e as Error).message}`, 'Не получилось отправить SMS. Повторите через минуту');
    }
    const body = (await res.json().catch(() => null)) as { id?: number; cnt?: number; error?: string; error_code?: number } | null;
    if (!res.ok || !body || body.error) {
      const code = body?.error_code;
      this.logger.error(`SMSC error ${code ?? res.status}: ${body?.error ?? 'bad response'}`);
      // 7 = bad phone format, 8 = can't deliver to this number; everything else is our problem (balance, auth…).
      throw new SmsError(`smsc ${code}: ${body?.error}`, code === 7 || code === 8 ? 'На этот номер нельзя отправить SMS. Проверьте номер' : 'Не получилось отправить SMS. Повторите через минуту или войдите по почте');
    }
    this.logger.log(`sms ${body.id} → ${phone.slice(0, 7)}***`);
  }
}
