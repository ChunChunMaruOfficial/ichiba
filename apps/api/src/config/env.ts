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

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is not set (Supabase: Project → Connect → Session pooler)');
  if (!env.JWT_SECRET) errors.push('JWT_SECRET is not set — copy apps/api/.env.example to .env');
  // Sessions are signed with this secret: a short or default one makes them forgeable.
  else if (prod && (env.JWT_SECRET.length < 32 || env.JWT_SECRET.startsWith('change-me'))) errors.push('JWT_SECRET must be a random string of at least 32 characters in production');

  const cloudinary = !!env.CLOUDINARY_CLOUD_NAME;
  if (cloudinary) {
    for (const k of ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) if (!env[k]) errors.push(`${k} is required with CLOUDINARY_CLOUD_NAME`);
  }
  if (env.MEDIA_DRIVER === 's3') {
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'MEDIA_PUBLIC_URL']) if (!env[k]) errors.push(`${k} is required with MEDIA_DRIVER=s3`);
  } else if (env.VERCEL && !cloudinary) {
    errors.push('Vercel has no persistent disk: set CLOUDINARY_* (or MEDIA_DRIVER=s3 with S3_*) for photos');
  }

  if (prod) {
    if (!env.WEB_ORIGIN) errors.push('WEB_ORIGIN is not set (URL of the web app, e.g. https://ichiba.vercel.app)');
    if (!env.SMTP_HOST) logger.warn('SMTP_HOST is empty: verification codes and emails go to the log only — see docs/EMAIL.md');
    if (env.VERCEL && !env.CRON_SECRET) logger.warn('CRON_SECRET is not set: /cron/tick is disabled (jobs still run on traffic)');
    if (env.VERCEL && !env.PUSHER_APP_ID && env.REALTIME_DRIVER !== 'none') logger.warn('No PUSHER_* keys: Vercel cannot hold WebSockets, chat falls back to polling');
    if (!env.ADMIN_EMAILS) logger.warn('ADMIN_EMAILS is empty: nobody can become an admin on a fresh database');
  }

  if (errors.length) throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
}
