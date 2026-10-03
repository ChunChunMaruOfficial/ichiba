import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Delivers 6-digit codes by email or SMS. MVP ships with the `log` provider (code goes to the API log);
 * a real provider is plugged in here by setting MAIL_PROVIDER / SMS_PROVIDER.
 */
@Injectable()
export class CodeSenderService {
  private readonly logger = new Logger('Codes');

  async send(target: string, code: string, purpose: string) {
    const isEmail = target.includes('@');
    const provider = (isEmail ? process.env.MAIL_PROVIDER : process.env.SMS_PROVIDER) || 'log';
    if (provider === 'log') {
      this.logger.log(`[${purpose}] code for ${target}: ${code}`);
      return;
    }
    throw new ServiceUnavailableException({ message: `Провайдер ${provider} не подключён` });
  }
}
