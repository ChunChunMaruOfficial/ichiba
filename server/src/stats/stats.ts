import { Controller, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { median, nicePrice } from '../ai/ensemble/aggregate.js';
import type { Listing, Prisma } from '../generated/prisma/client.js';
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

  /**
   * Price against similar items on the platform (same brand when there are enough, else the same category):
   * a tip only when it is clearly off. Plain database median, no AI call, so the card stays fast.
   */
  private async marketTip(l: Listing): Promise<string | null> {
    if (!l.price || !l.category || l.saleType !== 'FIXED') return null;
    const base: Prisma.ListingWhereInput = { id: { not: l.id }, category: l.category, status: { in: ['PUBLISHED', 'RESERVED', 'SOLD'] }, price: { not: null } };
    const prices = async (where: Prisma.ListingWhereInput) =>
      (await this.prisma.listing.findMany({ where, select: { price: true }, orderBy: { publishedAt: 'desc' }, take: 200 })).map((r) => r.price!);
    let comparable = l.brand ? await prices({ ...base, brand: { equals: l.brand, mode: 'insensitive' } }) : [];
    if (comparable.length < 5) comparable = await prices(l.subcategory ? { ...base, subcategory: l.subcategory } : base);
    const mid = comparable.length >= 5 ? median(comparable) : null;
    if (!mid) return null;
    if (l.price > mid * 1.25) return `Цена выше рынка: похожие вещи обычно стоят около ${nicePrice(mid)} BYN — так вещь продастся быстрее`;
    if (l.price < mid * 0.7) return `Цена заметно ниже рынка (обычно около ${nicePrice(mid)} BYN) — можно поднять`;
    return null;
  }

  /** What the seller can still fill in or improve on the item itself; shown on the item's own card. */
  private contentTips(l: Listing, photos: number, hasVideo: boolean): string[] {
    const tips: string[] = [];
    if (photos < 3) tips.push('Добавьте ещё фото: общий вид, бирку и детали — по одному фото вещь сложно оценить');
    if (l.defectsPresent && !l.defectsDescription?.trim()) tips.push('Опишите дефекты — честное описание снимает вопросы и споры');
    if ((l.description ?? '').trim().length < 40) tips.push('Расскажите о вещи подробнее: посадка, ткань, сколько носили, почему продаёте');
    if (!l.brand) tips.push('Укажите бренд — по нему ищут чаще всего');
    if (!l.color || !l.material) tips.push(`Заполните ${!l.color && !l.material ? 'цвет и материал' : !l.color ? 'цвет' : 'материал'} — по ним фильтруют поиск`);
    if (!l.originalPrice && l.saleType === 'FIXED') tips.push('Укажите цену новой вещи — покажем, сколько покупатель экономит');
    if (!l.deliveryOptions.includes('DELIVERY')) tips.push('Добавьте доставку — тогда вещь смогут купить и из других городов');
    if (!l.acceptsOffers && l.saleType === 'FIXED') tips.push('Включите «Предложить цену» — торг привлекает больше покупателей');
    if (!hasVideo) tips.push('Снимите короткое видео — посадку на видео видно лучше, чем на фото');
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
      // The newest 500: a shop with thousands of items would otherwise load them all, cards and stats included.
      take: 500,
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
    const [{ total, byDay }, photos, video, market] = await Promise.all([
      this.sums([listingId], from, to),
      this.prisma.photo.count({ where: { listingId } }),
      this.prisma.video.count({ where: { listingId } }),
      l.status === 'PUBLISHED' ? this.marketTip(l) : null,
    ]);
    const next = nextBumpAt(l);
    // Activity tips first, then the price, then what is missing on the item; a short list, most useful on top.
    const tips = l.status === 'PUBLISHED' ? [...new Set([...this.tipsFor(l, total, 30), ...(market ? [market] : []), ...this.contentTips(l, photos, video > 0)])].slice(0, 5) : [];
    return {
      allTime: { views: l.viewsCount, favorites: l.favoritesCount },
      last30: total,
      series: Array.from({ length: 30 }, (_, i) => {
        const day = new Date(from.getTime() + i * DAY_MS);
        return { day: day.toISOString().slice(0, 10), views: byDay.get(day.getTime())?.views ?? 0 };
      }),
      bump: next ? { nextAt: next, available: next.getTime() <= Date.now(), lastAt: l.lastBumpAt, count: l.bumpsCount } : null,
      tips,
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
