import { Controller, Get, Injectable, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { withJobLock } from '../common/job-lock.js';
import type { Listing, Prisma } from '../generated/prisma/client.js';
import { appUrl } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { buildSeo, contentHash, Seo, SeoAi, SeoListing } from './seo.js';
import { SeoWriter } from './seo-writer.js';

/** What the job keeps in Listing.seo. */
interface SeoState {
  /** When the job last looked at the listing; a later `updatedAt` means something changed. */
  at: string;
  ai?: SeoAi | null;
  /** Fingerprint of the public page last sent to IndexNow ('gone' once it stopped being public). */
  page?: string;
  /** The AI pass failed (no provider answered): try again after this. */
  retryAt?: string;
}

/** A sold item's page stays in search this long (people look for it, and the page offers similar ones), then goes. */
export const SOLD_INDEXED_DAYS = 60;

/** The search snippet of a listing row (cards, the item page, the sitemap). */
export function seoOf(l: Listing, auctionPrice: number | null = null): Seo {
  return buildSeo(seoListing(l, auctionPrice));
}

function seoListing(l: Listing, auctionPrice: number | null = null): SeoListing {
  return {
    ...l,
    auctionPrice,
    ai: ((l.seo as SeoState | null)?.ai ?? null) as SeoAi | null,
  };
}

/** /item/<id>-<slug>: the address search engines are given. */
export const itemPath = (l: Listing) => `${l.id}-${seoOf(l).slug}`;

const RUN_MS = 45_000;
const BATCH = 8;
const RETRY_MS = 30 * 60_000;
const PUBLIC = ['PUBLISHED', 'RESERVED', 'SOLD'];

/**
 * Keeps the search snippets of listings fresh and tells search engines about changes:
 * - a listing whose title, description or attributes changed goes through the AI pass (seo-writer.ts) once;
 * - when its public page changes (a new item, a new price, sold, taken down), its address is sent to IndexNow, which
 *   Yandex and Bing (and the other members) read within minutes; Google learns from the sitemap's lastmod.
 * The job runs every minute and only looks at listings changed since it last saw them.
 */
@Injectable()
export class SeoService {
  private readonly logger = new Logger('SEO');
  private readonly indexNow = new IndexNow();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly writer: SeoWriter,
  ) {}

  get indexNowKey() {
    return this.indexNow.key;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async refresh() {
    await withJobLock(this.redis, 'seo.refresh', 2 * 60_000, () => this.refreshNow());
  }

  async refreshNow() {
    const deadline = Date.now() + RUN_MS;
    const urls: string[] = [];
    let written = 0;
    while (Date.now() < deadline) {
      // Changed since the job last looked (never seen, edited, sold, hidden), or an AI pass due for another try.
      const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Listing"
        WHERE "status" <> 'DRAFT'
          AND ("seo" IS NULL OR ("seo"->>'at')::timestamptz < "updatedAt" OR ("seo"->>'retryAt')::timestamptz < now())
          AND ("status" IN ('PUBLISHED', 'RESERVED', 'SOLD') OR "seo"->>'page' IS NOT NULL)
        ORDER BY "updatedAt" DESC
        LIMIT ${BATCH}`;
      if (!ids.length) break;
      for (const { id } of ids) {
        const url = await this.refreshOne(id).catch((e) => {
          this.logger.warn(`${id}: ${(e as Error).message}`);
          return null;
        });
        written++;
        if (url) urls.push(url);
        if (Date.now() > deadline) break;
      }
    }
    if (urls.length) await this.indexNow.submit(urls).catch((e) => this.logger.warn(`IndexNow: ${(e as Error).message}`));
    if (written) this.logger.log(`${written} snippets checked${urls.length ? `, ${urls.length} sent to IndexNow` : ''}`);
  }

  /** Brings one listing's snippet up to date; returns its address when the public page changed. */
  private async refreshOne(id: string): Promise<string | null> {
    const l = await this.prisma.listing.findUnique({
      where: { id },
      include: { auctions: { where: { status: 'ACTIVE' }, take: 1, select: { startPrice: true, bids: { orderBy: { amount: 'desc' }, take: 1, select: { amount: true } } } } },
    });
    if (!l) return null;
    const prev = (l.seo as SeoState | null) ?? null;
    const state: SeoState = { at: new Date().toISOString(), ai: prev?.ai ?? null, page: prev?.page };
    const isPublic = PUBLIC.includes(l.status) && !l.hiddenByAdmin;

    // The AI pass: only for what's on sale (a sold page keeps what it had), only when the text changed.
    const hash = contentHash(l);
    if (isPublic && l.status !== 'SOLD' && prev?.ai?.hash !== hash && this.writer.configured) {
      const ai = this.writer.available ? await this.writer.write(seoListing(l)) : null;
      if (ai) state.ai = ai;
      else state.retryAt = new Date(Date.now() + RETRY_MS).toISOString();
    }

    const row = { ...l, seo: state as unknown as Prisma.JsonValue };
    const auction = l.auctions[0];
    const seo = seoOf(row, auction ? (auction.bids[0]?.amount ?? auction.startPrice) : null);
    const page = isPublic ? fingerprint([l.status, seo.title, seo.description, seo.slug]) : 'gone';
    let url: string | null = null;
    if (page !== prev?.page && !(page === 'gone' && !prev?.page)) {
      url = `${appUrl()}/item/${l.id}-${seo.slug}`;
      state.page = page;
    }
    // Raw SQL: the snippet's own bookkeeping must not move `updatedAt` (the sitemap's lastmod, and this job's trigger).
    await this.prisma.$executeRaw`UPDATE "Listing" SET "seo" = ${JSON.stringify(state)}::jsonb WHERE "id" = ${id}`;
    return url;
  }
}

const fingerprint = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

/**
 * IndexNow (indexnow.org): one POST tells Yandex, Bing, Seznam, Naver and Yep that pages changed. The key proves the site
 * is ours: it is served at /indexnow.txt (the web app asks the API for it). INDEXNOW_KEY sets it; by default it is
 * derived from JWT_SECRET, so it stays the same across deploys without one more variable. Off outside production.
 */
class IndexNow {
  private readonly logger = new Logger('IndexNow');
  readonly key = process.env.INDEXNOW_KEY || createHash('sha256').update(`indexnow:${process.env.JWT_SECRET ?? 'dev'}`).digest('hex').slice(0, 32);

  private get enabled() {
    const site = appUrl();
    return process.env.INDEXNOW !== 'off' && site.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(site);
  }

  async submit(urls: string[]) {
    if (!this.enabled) return;
    const site = new URL(appUrl());
    const body = JSON.stringify({ host: site.host, key: this.key, keyLocation: `${site.origin}/indexnow.txt`, urlList: [...new Set(urls)].slice(0, 10_000) });
    // The shared endpoint passes the URLs on to every member; Yandex's own is asked too, as its help suggests.
    const results = await Promise.allSettled(
      ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow'].map(async (endpoint) => {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body, signal: AbortSignal.timeout(10_000) });
        if (!res.ok && res.status !== 202) throw new Error(`${endpoint}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }),
    );
    for (const r of results) if (r.status === 'rejected') this.logger.warn((r.reason as Error).message);
  }
}

@Controller('seo')
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  /** The IndexNow key, served by the web app at /indexnow.txt: search engines fetch it to check a submission is ours. */
  @Public()
  @SkipThrottle()
  @Get('indexnow-key')
  indexNowKey() {
    return { key: this.seo.indexNowKey };
  }
}
