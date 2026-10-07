import { Controller, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import type { Listing } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Seller statistics (feature 11): daily per-listing counters (views, ♡, cart adds, chats, offers, requests),
 * period totals with the previous period for comparison, a funnel, per-listing table and practical tips.
 * Days are counted in Minsk time (UTC+3, no DST).
 */

export type StatField = 'views' | 'favorites' | 'carts' | 'chats' | 'offers' | 'requests';
const FIELDS: StatField[] = ['views', 'favorites', 'carts', 'chats', 'offers', 'requests'];
const DAY_MS = 24 * 3600 * 1000;
const MINSK_OFFSET_MS = 3 * 3600 * 1000;

const BUMP_COOLDOWN_MS = 72 * 3600 * 1000;
const FIRST_BUMP_AFTER_MS = 24 * 3600 * 1000;

/** Calendar day (Minsk) as a UTC-midnight Date, which is how Postgres DATE values come back. */
function minskDay(at = Date.now()) {
  const d = new Date(at + MINSK_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** When the listing may be bumped next (null = not on sale). */
export function nextBumpAt(l: Pick<Listing, 'status' | 'lastBumpAt' | 'publishedAt'>): Date | null {
  if (l.status !== 'PUBLISHED' || !l.publishedAt) return null;
  return l.lastBumpAt ? new Date(l.lastBumpAt.getTime() + BUMP_COOLDOWN_MS) : new Date(l.publishedAt.getTime() + FIRST_BUMP_AFTER_MS);
}

type Totals = Record<StatField, number>;
const zero = (): Totals => ({ views: 0, favorites: 0, carts: 0, chats: 0, offers: 0, requests: 0 });

@Injectable()
export class StatsService {
  private readonly logger = new Logger('Stats');

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget counter increment; statistics must never break the user's action. */
  track(listingId: string, field: StatField) {
    const day = minskDay();
    const run = () =>
      this.prisma.listingStat.upsert({
        where: { listingId_day: { listingId, day } },
        create: { listingId, day, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
    // Two concurrent first hits of the day race on create: the loser retries as an update.
    void run()
      .catch(() => run())
      .catch((e) => this.logger.warn(`track ${field} ${listingId}: ${(e as Error).message}`));
  }

  private async sums(listingIds: string[], from: Date, to: Date) {
    if (!listingIds.length) return { total: zero(), byListing: new Map<string, Totals>(), byDay: new Map<number, Totals>() };
    const rows = await this.prisma.listingStat.findMany({ where: { listingId: { in: listingIds }, day: { gte: from, lt: to } } });
    const total = zero();
    const byListing = new Map<string, Totals>();
    const byDay = new Map<number, Totals>();
    for (const r of rows) {
      const l = byListing.get(r.listingId) ?? zero();
      const d = byDay.get(r.day.getTime()) ?? zero();
      for (const f of FIELDS) {
        total[f] += r[f];
        l[f] += r[f];
        d[f] += r[f];
      }
      byListing.set(r.listingId, l);
      byDay.set(r.day.getTime(), d);
    }
    return { total, byListing, byDay };
  }

  private tipsFor(l: Listing, period: Totals, days: number): string[] {
    const tips: string[] = [];
    const daysOnSale = l.publishedAt ? (Date.now() - l.publishedAt.getTime()) / DAY_MS : 0;
    if (l.status !== 'PUBLISHED') return tips;
    if (daysOnSale > 7 && period.views < days) tips.push('Мало просмотров — поднимите вещь в ленте');
    if (period.views >= 30 && period.favorites === 0) tips.push('Много просмотров, но нет ♡ — проверьте обложку и цену');
    if (period.favorites >= 3 && period.offers + period.requests === 0)
      tips.push(l.acceptsOffers ? 'Вещь сохраняют, но не покупают — снизьте цену: все, кто добавил в ♡, получат уведомление' : 'Вещь сохраняют, но не покупают — включите «Предложить цену»');
    if (!l.measurements && ['outerwear', 'knitwear', 'tshirts', 'shirts', 'dresses', 'trousers', 'jeans', 'shorts', 'skirts', 'suits', 'shoes'].includes(l.category ?? '')) tips.push('Добавьте замеры — покупатели увидят, подойдёт ли размер');
    return tips;
  }

  async overview(sellerId: string, days: 7 | 30) {
    const today = minskDay();
    const to = new Date(today.getTime() + DAY_MS);
    const from = new Date(to.getTime() - days * DAY_MS);
    const prevFrom = new Date(from.getTime() - days * DAY_MS);

    const listings = await this.prisma.listing.findMany({
      where: { sellerId, status: { in: ['PUBLISHED', 'RESERVED', 'HIDDEN', 'SOLD'] } },
      include: cardInclude,
      orderBy: { publishedAt: 'desc' },
    });
    const ids = listings.map((l) => l.id);
    const [current, previous, salesNow, salesPrev] = await Promise.all([
      this.sums(ids, from, to),
      this.sums(ids, prevFrom, from),
      this.prisma.buyRequest.aggregate({ where: { sellerId, status: 'COMPLETED', completedAt: { gte: from, lt: to } }, _count: true, _sum: { priceTotal: true } }),
      this.prisma.buyRequest.aggregate({ where: { sellerId, status: 'COMPLETED', completedAt: { gte: prevFrom, lt: from } }, _count: true, _sum: { priceTotal: true } }),
    ]);

    const series = Array.from({ length: days }, (_, i) => {
      const day = new Date(from.getTime() + i * DAY_MS);
      const t = current.byDay.get(day.getTime()) ?? zero();
      return { day: day.toISOString().slice(0, 10), views: t.views, favorites: t.favorites, contacts: t.chats + t.offers + t.requests };
    });

    const rows = listings
      .filter((l) => l.status !== 'SOLD' || current.byListing.has(l.id))
      .map((l) => {
        const period = current.byListing.get(l.id) ?? zero();
        const next = nextBumpAt(l);
        return {
          listing: serializeCard(l),
          period,
          allTime: { views: l.viewsCount, favorites: l.favoritesCount },
          bump: next ? { nextAt: next, available: next.getTime() <= Date.now() } : null,
          tips: this.tipsFor(l, period, days),
        };
      })
      .sort((a, b) => b.period.views - a.period.views || b.allTime.views - a.allTime.views);

    const contacts = current.total.chats + current.total.offers + current.total.requests;
    return {
      days,
      totals: { ...current.total, contacts, sales: salesNow._count, revenue: salesNow._sum.priceTotal ?? 0 },
      previous: { ...previous.total, contacts: previous.total.chats + previous.total.offers + previous.total.requests, sales: salesPrev._count, revenue: salesPrev._sum.priceTotal ?? 0 },
      funnel: [
        { key: 'views', label: 'Просмотры', value: current.total.views },
        { key: 'favorites', label: 'Добавили в ♡', value: current.total.favorites },
        { key: 'contacts', label: 'Написали или предложили цену', value: contacts },
        { key: 'requests', label: 'Запросы на покупку', value: current.total.requests },
        { key: 'sales', label: 'Продажи', value: salesNow._count },
      ],
      series,
      listings: rows,
      tips: rows.flatMap((r) => r.tips.map((t) => ({ listingId: r.listing.id, title: r.listing.title, text: t }))).slice(0, 6),
    };
  }

  async listing(sellerId: string, listingId: string) {
    const l = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!l || l.sellerId !== sellerId || l.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
    const to = new Date(minskDay().getTime() + DAY_MS);
    const from = new Date(to.getTime() - 30 * DAY_MS);
    const { total, byDay } = await this.sums([listingId], from, to);
    const next = nextBumpAt(l);
    return {
      allTime: { views: l.viewsCount, favorites: l.favoritesCount },
      last30: total,
      series: Array.from({ length: 30 }, (_, i) => {
        const day = new Date(from.getTime() + i * DAY_MS);
        return { day: day.toISOString().slice(0, 10), views: byDay.get(day.getTime())?.views ?? 0 };
      }),
      bump: next ? { nextAt: next, available: next.getTime() <= Date.now(), lastAt: l.lastBumpAt, count: l.bumpsCount } : null,
      tips: this.tipsFor(l, total, 30),
    };
  }
}

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.stats.overview(user.id, days === '30' ? 30 : 7);
  }

  @Get('listings/:id')
  listing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.stats.listing(user.id, id);
  }
}
