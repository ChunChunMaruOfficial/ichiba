import { Logger } from '@nestjs/common';

/**
 * Fails fast on a misconfigured production deploy instead of breaking at the first request.
 * Optional integrations only warn: the app works without them, with the feature hidden.
 */
export function checkEnv() {
  const logger = new Logger('Env');
  const env = process.env;
  const prod = env.NODE_ENV === 'production';
  const errors: string[] = [];

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is not set (PostgreSQL connection string)');
  if (!env.JWT_SECRET) errors.push('JWT_SECRET is not set');
  else if (prod && (env.JWT_SECRET.length < 32 || env.JWT_SECRET.startsWith('change-me'))) errors.push('JWT_SECRET must be a random string of 32+ characters');

  const media = env.MEDIA_DRIVER ?? 'local';
  if (media === 's3') {
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'MEDIA_PUBLIC_URL']) if (!env[k]) errors.push(`${k} is required with MEDIA_DRIVER=s3`);
  } else if (env.VERCEL) {
    errors.push('Vercel has no persistent disk: set MEDIA_DRIVER=s3 and the S3_* variables');
  }

  if (prod) {
    if (!env.WEB_ORIGIN) errors.push('WEB_ORIGIN is not set (URL of the web app, e.g. https://ichiba.vercel.app)');
    if ((env.MAIL_PROVIDER ?? 'log') === 'log') logger.warn('MAIL_PROVIDER=log: email codes go to the log only — set MAIL_PROVIDER=resend or smtp');
    if ((env.SMS_PROVIDER ?? 'log') === 'log') logger.warn('SMS_PROVIDER=log: phone sign-up codes go to the log only — set SMS_PROVIDER=twilio or keep sign-up by email');
    if (env.VERCEL && !env.CRON_SECRET) logger.warn('CRON_SECRET is not set: /cron/tick is disabled (rules still run lazily on traffic)');
    if (env.VERCEL && !env.PUSHER_APP_ID && env.REALTIME_DRIVER !== 'none') logger.warn('No PUSHER_* keys: Vercel cannot hold WebSockets, chat falls back to polling');
  }
  if (!env.ANTHROPIC_API_KEY) logger.log('ANTHROPIC_API_KEY is empty: AI listing assistant is off');

  if (errors.length) throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
}
