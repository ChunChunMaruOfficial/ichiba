import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { sessionOk } from './auth/auth.guard.js';
import { AlertLogger } from './common/alerts.js';
import { UploadTooLargeFilter } from './common/http-errors.js';
import { checkEnv } from './config/env.js';
import { attachWebSockets, EventsService } from './events/events.js';
import { MEDIA_DIR } from './media/storage.js';
import { PrismaService } from './prisma/prisma.service.js';

async function bootstrap() {
  checkEnv();
  const production = process.env.NODE_ENV === 'production';
  const logger = new Logger('Bootstrap');
  // A failed promise nobody awaited, or an error thrown outside any request, must not end the process silently:
  // Railway restarts it only a few times before giving up.
  process.on('unhandledRejection', (e) => logger.error(`unhandled rejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
  process.on('uncaughtException', (e) => {
    logger.error(`uncaught exception: ${e.stack ?? e.message}`);
    setTimeout(() => process.exit(1), 500).unref();
  });
  // Logs are held until the alert logger is in place, so an error while modules start reaches Telegram too.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const alerts = new AlertLogger();
  app.useLogger(alerts);
  // Behind a proxy (nginx, Railway/Vercel edge, the Next.js rewrite): take the client IP from X-Forwarded-For,
  // otherwise rate limits see one IP for everyone. Measured on Railway: the edge rewrites the header to
  // "<visitor>, <edge node>" (whatever the client sent is dropped) and the Next.js rewrite passes it on without
  // adding a hop, so two trusted hops put req.ip on the visitor on both paths; TRUST_PROXY overrides for other hosts.
  // `true` (every hop) would let a request name its own address and walk past every rate limit on a plain proxy.
  const trustProxy = process.env.TRUST_PROXY || (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL ? '2' : '');
  if (trustProxy) app.set('trust proxy', trustProxy === 'true' ? true : Number(trustProxy) || trustProxy);
  // Security headers; photos are loaded by the site from another origin, hence cross-origin resource policy.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: production }));
  // Answers carry the visitor's own data (profile, deals, chats): no browser or proxy keeps them.
  // Photos under /media/ are left to the static handler, which only sets its year-long cache on a bare response.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/media/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cookieParser());
  app.useGlobalFilters(new UploadTooLargeFilter());
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  if ((process.env.MEDIA_DRIVER ?? 'local') === 'local') {
    app.useStaticAssets(MEDIA_DIR, { prefix: '/media/', maxAge: '365d', immutable: true });
  }
  const events = app.get(EventsService);
  const prisma = app.get(PrismaService);
  alerts.useChats(async () =>
    (await prisma.user.findMany({ where: { role: 'ADMIN', tgChatId: { not: null }, blockedAt: null }, select: { tgChatId: true } })).map((u) => u.tgChatId!),
  );
  if (events.driver === 'ws') attachWebSockets(app.getHttpServer(), events, app.get(JwtService), (userId, sv) => sessionOk(prisma, userId, sv));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  logger.log(`API on http://localhost:${port}`);

  // Redeploy (SIGTERM): stop taking connections, let requests in flight finish, then close modules (Prisma last),
  // instead of Nest's default order, which disconnects the database while requests are still running.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.log(`${signal}: draining`);
    const server = app.getHttpServer() as import('http').Server;
    const timer = setTimeout(() => process.exit(0), 15_000).unref();
    server.close(() => {
      clearTimeout(timer);
      app.close().finally(() => process.exit(0));
    });
    server.closeIdleConnections?.();
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => shutdown(signal));
}
bootstrap();
