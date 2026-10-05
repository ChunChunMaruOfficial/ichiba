import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { MEDIA_DIR } from './media/storage.js';

async function bootstrap() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set — copy apps/api/.env.example to .env');
  const production = process.env.NODE_ENV === 'production';
  // Sessions are signed with this secret: a short or default one makes them forgeable.
  if (production && (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('change-me'))) {
    throw new Error('JWT_SECRET must be a random string of at least 32 characters in production');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind nginx: take the client IP from X-Forwarded-For, otherwise rate limits see one IP for everyone.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  // Security headers; photos are loaded by the site from another origin, hence cross-origin resource policy.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: production }));
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  if (process.env.MEDIA_DRIVER !== 's3') {
    app.useStaticAssets(MEDIA_DIR, { prefix: '/media/', maxAge: '365d', immutable: true });
  }
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
