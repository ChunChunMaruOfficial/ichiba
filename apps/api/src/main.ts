import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { checkEnv } from './config/env.js';
import { attachWebSockets, EventsService } from './events/events.js';
import { MEDIA_DIR } from './media/storage.js';

async function bootstrap() {
  checkEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Vercel / the Next.js rewrite / a load balancer: client IP comes from X-Forwarded-For (rate limits).
  app.set('trust proxy', true);
  app.disable('x-powered-by');
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
  Logger.log(`API on :${port}`, 'Bootstrap');
}
bootstrap();
