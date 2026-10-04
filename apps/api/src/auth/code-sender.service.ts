import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CodeMailer } from '../mail/mail.module.js';

/**
 * Delivers 6-digit codes. Email goes through SMTP when SMTP_HOST is set (see docs/EMAIL.md), otherwise the
 * code is printed to the API log. SMS stays on the log provider until an SMS gateway is connected.
 */
@Injectable()
export class CodeSenderService {
  private readonly logger = new Logger('Codes');

  constructor(private readonly mail: CodeMailer) {}

  async send(target: string, code: string, purpose: string) {
    const isEmail = target.includes('@');
    if (isEmail && this.mail.enabled) {
      try {
        await this.mail.send(target, code, purpose);
        return;
      } catch (e) {
        this.logger.error(`code email to ${target} failed: ${(e as Error).message}`);
        throw new ServiceUnavailableException({ message: 'Не получилось отправить письмо с кодом. Попробуйте ещё раз через минуту' });
      }
    }
    const provider = (isEmail ? 'log' : process.env.SMS_PROVIDER) || 'log';
    if (provider === 'log') {
      this.logger.log(`[${purpose}] code for ${target}: ${code}`);
      return;
    }
    throw new ServiceUnavailableException({ message: `Провайдер ${provider} не подключён` });
  }
}
