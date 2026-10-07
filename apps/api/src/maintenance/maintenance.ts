import { Controller, Get, Headers, Injectable, Logger, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { AuctionsService } from '../auctions/auctions.js';
import { Public } from '../auth/auth.guard.js';
import { OffersService } from '../offers/offers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { RequestsService } from '../requests/requests.service.js';

/**
 * Scheduled rules (auction closing, 48 h deal/offer expiry, auto-complete). On a long-running host
 * @nestjs/schedule runs them; serverless hosts (Vercel) have no timers, so they run from
 * - GET /cron/tick, called by Vercel Cron or any external pinger with `Authorization: Bearer $CRON_SECRET`;
 * - and lazily on regular traffic, at most once a minute (CRON_LAZY, on by default on Vercel),
 *   so deals and auctions settle on time even on plans where Vercel Cron runs only daily.
 * Every rule updates rows conditionally, so overlapping runs are harmless.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('Maintenance');
  private lastRun = 0;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly auctions: AuctionsService,
    private readonly offers: OffersService,
    private readonly requests: RequestsService,
    private readonly redis: RedisService,
  ) {}

  async runAll() {
    const started = Date.now();
    const results = await Promise.allSettled([this.auctions.closeEnded(), this.offers.expire(), this.requests.sweep()]);
    for (const r of results) if (r.status === 'rejected') this.logger.warn(`rule failed: ${(r.reason as Error)?.message}`);
    return { ok: results.every((r) => r.status === 'fulfilled'), ms: Date.now() - started };
  }

  /** Runs the rules if nobody did within the last minute (per instance, and across instances via Redis). */
  async tickIfDue() {
    if (Date.now() - this.lastRun < 60_000) return;
    this.lastRun = Date.now();
    if (this.redis.client) {
      const got = await this.redis.client.set('ichiba:maintenance:lock', '1', 'EX', 55, 'NX').catch(() => 'OK');
      if (got !== 'OK') return;
    }
    this.running ??= this.runAll().finally(() => (this.running = null));
    await this.running;
  }
}

export const lazyMaintenanceEnabled = () => (process.env.CRON_LAZY ? process.env.CRON_LAZY === 'true' : !!process.env.VERCEL);
/** @nestjs/schedule timers only make sense on a long-running process. */
export const inProcessSchedulerEnabled = () => !process.env.VERCEL && process.env.CRON_MODE !== 'external';

@Injectable()
export class LazyMaintenanceMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Maintenance');
  constructor(private readonly maintenance: MaintenanceService) {}

  async use(_req: Request, _res: Response, next: NextFunction) {
    try {
      await this.maintenance.tickIfDue();
    } catch (e) {
      this.logger.warn(`lazy tick: ${(e as Error).message}`);
    }
    next();
  }
}

@Controller()
@Public()
@SkipThrottle()
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('cron/tick')
  tick(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) throw new UnauthorizedException({ message: 'Bad cron secret' });
    return this.maintenance.runAll();
  }

  /** Liveness + dependencies, for uptime monitors. */
  @Get('health')
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = await this.redis.ping().catch(() => false);
    return { ok: db && redis !== false, db, redis };
  }
}
