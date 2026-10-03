import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { MEDIA_DIR } from './media/storage.js';

async function bootstrap() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set — copy apps/api/.env.example to .env');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
