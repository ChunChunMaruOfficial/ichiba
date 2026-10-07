import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CodeMailer } from '../mail/mail.module.js';
import { codeSms, SmsError, SmsService } from './sms.js';

/**
 * Delivers 6-digit codes: email over SMTP (docs/EMAIL.md), phone over the SMS gateway (auth/sms.ts).
 * Without configured transports codes are written to the API log.
 */
@Injectable()
export class CodeSenderService {
  private readonly logger = new Logger('Codes');

  constructor(
    private readonly mail: CodeMailer,
    private readonly sms: SmsService,
  ) {}

  async send(target: string, code: string, purpose: string) {
    if (!target.includes('@')) {
      try {
        await this.sms.send(target, codeSms(code));
      } catch (e) {
        if (e instanceof SmsError) throw e.userMessage.includes('+375') || e.userMessage.includes('номер') ? new BadRequestException({ message: e.userMessage, fields: { login: e.userMessage } }) : new ServiceUnavailableException({ message: e.userMessage });
        throw e;
      }
      return;
    }
    if (this.mail.enabled) {
      try {
        await this.mail.send(target, code, purpose);
        return;
      } catch (e) {
        this.logger.error(`code email to ${target} failed: ${(e as Error).message}`);
        throw new ServiceUnavailableException({ message: 'Не получилось отправить письмо с кодом. Попробуйте ещё раз через минуту' });
      }
    }
    this.logger.log(`[${purpose}] code for ${target}: ${code}`);
  }
}
