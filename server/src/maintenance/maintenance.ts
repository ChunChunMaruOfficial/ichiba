import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Injectable, Logger, NestMiddleware, Res, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { ListingModerator } from '../ai/moderation.js';
import { AuctionsService } from '../auctions/auctions.js';
import { Public } from '../auth/auth.guard.js';
import { background } from '../common/background.js';
import { ListingsService } from '../listings/listings.service.js';
import { EmailOutbox } from '../mail/mail.module.js';
import { MediaService } from '../media/media.service.js';
import { OffersService } from '../offers/offers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PrivacyService } from '../privacy/privacy.js';
import { RedisService } from '../redis/redis.js';
import { RequestsService } from '../requests/requests.service.js';
import { ReviewsService } from '../reviews/reviews.js';
import { SeoService } from '../seo/seo.service.js';

const MINUTE = 60_000;

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
  private readonly lastJob = new Map<string, number>();

  constructor(
    private readonly auctions: AuctionsService,
    private readonly offers: OffersService,
    private readonly requests: RequestsService,
    private readonly listings: ListingsService,
    private readonly outbox: EmailOutbox,
    private readonly moderator: ListingModerator,
    private readonly reviews: ReviewsService,
    private readonly media: MediaService,
    private readonly privacy: PrivacyService,
    private readonly redis: RedisService,
    private readonly seo: SeoService,
  ) {}

  /** Same jobs and cadence as the @Cron timers: [name, every ms, job]. */
  private jobs(): Array<[string, number, () => Promise<unknown>]> {
    return [
      ['auctions', 0, () => this.auctions.closeEnded()],
      ['scheduled-listings', 0, () => this.listings.publishScheduled()],
      ['offers', 0, () => this.offers.expire()],
      ['requests', 0, () => this.requests.sweep()],
      ['email-outbox', 0, () => this.outbox.flush()],
      ['ai-recheck', 10 * MINUTE, () => this.moderator.recheckUnchecked()],
      ['seo', 0, () => this.seo.refresh()],
      ['review-reminders', 60 * MINUTE, () => this.reviews.remind()],
      ['photo-cleanup', 24 * 60 * MINUTE, () => this.media.purgeOrphans()],
      ['privacy-retention', 24 * 60 * MINUTE, () => this.privacy.retention()],
    ];
  }

  /** Whether a job with this period is due; the mark lives in Redis when there is one, so instances share it. */
  private async due(name: string, every: number) {
    if (!every) return true;
    if (this.redis.client) {
      const got = await this.redis.client.set(`ichiba:job:${name}`, '1', 'PX', every - 5000, 'NX').catch(() => 'OK');
      return got === 'OK';
    }
    if (Date.now() - (this.lastJob.get(name) ?? 0) < every - 5000) return false;
    this.lastJob.set(name, Date.now());
    return true;
  }

  async runAll() {
    const started = Date.now();
    const ran: string[] = [];
    const failed: string[] = [];
    for (const [name, every, job] of this.jobs()) {
      if (!(await this.due(name, every))) continue;
      try {
        await job();
        ran.push(name);
      } catch (e) {
        failed.push(name);
        this.logger.warn(`${name} failed: ${(e as Error).message}`);
      }
    }
    return { ok: !failed.length, ran, failed, ms: Date.now() - started };
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

  use(_req: Request, _res: Response, next: NextFunction) {
    // Never delays the visitor's request: runs alongside it (waitUntil keeps it alive on Vercel).
    background(this.maintenance.tickIfDue().catch((e) => this.logger.warn(`lazy tick: ${(e as Error).message}`)));
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
    const given = Buffer.from(auth ?? '');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException({ message: 'Bad cron secret' });
    return this.maintenance.runAll();
  }

  /**
   * Liveness + dependencies, for uptime monitors and the platform healthcheck: 503 without the database (a deploy
   * that can't reach Postgres must not go live); Redis is optional, so its absence only shows in the body.
   */
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const within = <T>(work: Promise<T>, ms: number) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);
    const db = await within(this.prisma.$queryRaw`SELECT 1`, 3_000).then(() => true).catch(() => false);
    const redis = await within(this.redis.ping(), 2_000).catch(() => false);
    if (!db) res.status(503);
    return { ok: db && redis !== false, db, redis };
  }
}
