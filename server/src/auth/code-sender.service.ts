import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CodeMailer } from '../mail/mail.module.js';

/**
 * Delivers 6-digit codes by email (docs/EMAIL.md). Without a configured transport codes are written
 * to the API log in development and refused in production.
 */
@Injectable()
export class CodeSenderService {
  private readonly logger = new Logger('Codes');

  constructor(private readonly mail: CodeMailer) {}

  async send(target: string, code: string, purpose: string) {
    if (this.mail.enabled) {
      try {
        await this.mail.send(target, code, purpose);
        this.logger.log(`[${purpose}] code email sent to ${target.replace(/^(.{2}).*@/, '$1***@')}`);
        return;
      } catch (e) {
        this.logger.error(`code email to ${target} failed: ${(e as Error).message}`);
        throw new ServiceUnavailableException({ message: 'Не получилось отправить письмо с кодом. Попробуйте ещё раз через минуту' });
      }
    }
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(`code email to ${target} not sent: email is not configured (docs/EMAIL.md)`);
      throw new ServiceUnavailableException({ message: 'Отправка писем временно недоступна. Попробуйте позже' });
    }
    this.logger.log(`[${purpose}] code for ${target}: ${code}`);
  }
}
