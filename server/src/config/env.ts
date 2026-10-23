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

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is not set (Railway: ${{Postgres.DATABASE_URL}})');
  if (!env.JWT_SECRET) errors.push('JWT_SECRET is not set — add a long random string to server/.env');
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
  } else if (env.RAILWAY_ENVIRONMENT && !cloudinary && !env.RAILWAY_VOLUME_MOUNT_PATH) {
    // A Railway container's disk is wiped on every deploy: local media needs a volume (MEDIA_DIR inside it).
    errors.push('Railway disk is not persistent: set CLOUDINARY_* or attach a volume and point MEDIA_DIR into it');
  }

  // Bcrypt hashes of imported shop accounts, JSON by nick: a typo would silently leave those accounts without a password.
  for (const k of ['HAND_PASSWORD_HASHES', 'TG_PASSWORD_HASHES', 'SHOP_PASSWORD_HASHES']) {
    if (!env[k]) continue;
    try {
      const map = JSON.parse(env[k]!) as unknown;
      if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some((v) => typeof v !== 'string' || !v.startsWith('$2'))) throw new Error('not a map of bcrypt hashes');
    } catch (e) {
      errors.push(`${k} must be JSON like {"nick":"$2b$10$…"}: ${(e as Error).message}`);
    }
  }

  if (prod) {
    if (!env.WEB_ORIGIN) errors.push('WEB_ORIGIN is not set (URL of the web app, e.g. https://ichiba.up.railway.app)');
    if (!env.SMTP_HOST && !env.GMAIL_REFRESH_TOKEN) logger.warn('No GMAIL_* or SMTP_HOST: verification codes and emails go to the log only — see docs/EMAIL.md');
    if (env.VERCEL && !env.CRON_SECRET) logger.warn('CRON_SECRET is not set: /cron/tick is disabled (jobs still run on traffic)');
    if (env.VERCEL && !env.PUSHER_APP_ID && env.REALTIME_DRIVER !== 'none') logger.warn('No PUSHER_* keys: Vercel cannot hold WebSockets, chat falls back to polling');
    if (!env.ADMIN_EMAILS) logger.warn('ADMIN_EMAILS is empty: nobody can become an admin on a fresh database');
  }

  if (errors.length) throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
}
