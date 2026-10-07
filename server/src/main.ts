import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { checkEnv } from './config/env.js';
import { attachWebSockets, EventsService } from './events/events.js';
import { MEDIA_DIR } from './media/storage.js';

async function bootstrap() {
  checkEnv();
  const production = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind a proxy (nginx, Railway/Vercel edge, the Next.js rewrite): take the client IP from X-Forwarded-For,
  // otherwise rate limits see one IP for everyone. Railway and Vercel always sit behind their edge proxy.
  const trustProxy = process.env.TRUST_PROXY || (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL ? 'true' : '');
  if (trustProxy) app.set('trust proxy', trustProxy === 'true' ? true : Number(trustProxy) || trustProxy);
  // Security headers; photos are loaded by the site from another origin, hence cross-origin resource policy.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: production }));
  app.use(cookieParser());
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  if ((process.env.MEDIA_DRIVER ?? 'local') === 'local') {
    app.useStaticAssets(MEDIA_DIR, { prefix: '/media/', maxAge: '365d', immutable: true });
  }
  app.enableShutdownHooks();

  const events = app.get(EventsService);
  if (events.driver === 'ws') attachWebSockets(app.getHttpServer(), events, app.get(JwtService));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
