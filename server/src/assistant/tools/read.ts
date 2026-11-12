import { z } from 'zod';
import { nextBumpAt } from '../../stats/stats.js';
import { topicById, TOPICS } from '../knowledge.js';
import { findMyListings, ListingFilter } from '../my-listings.js';
import type { Tool } from '../types.js';

/** Look-ups: change nothing, and what they return goes back to the model for its next step. */
const ListArgs = z.object({ filter: ListingFilter }).strict();

export const myListings: Tool<z.infer<typeof ListArgs>> = {
  name: 'my_listings',
  about: 'Посмотреть свои вещи по фильтру: названия, цены, просмотры, id. Нужен, когда человек спрашивает о своих вещах или когда нужен id конкретной вещи.',
  args: ListArgs,
  kind: 'read',
  async run(ctx, { filter }) {
    const { items, total } = await findMyListings(ctx.prisma, ctx.userId, { ...filter, limit: Math.min(filter.limit ?? 30, 30) });
    const now = Date.now();
    return {
      report: '',
      data: {
        total,
        shown: items.length,
        items: items.map((l) => ({
          id: l.id,
          title: l.title,
          price: l.price,
          status: l.status,
          category: l.category,
          views: l.viewsCount,
          likes: l.favoritesCount,
          daysOnSale: l.publishedAt ? Math.floor((now - l.publishedAt.getTime()) / 86_400_000) : null,
          canBumpNow: (nextBumpAt(l)?.getTime() ?? Infinity) <= now,
          auction: l.saleType === 'AUCTION',
        })),
      },
    };
  },
};

const StatsArgs = z.object({ days: z.union([z.literal(7), z.literal(30)]).optional() }).strict();

export const shopStats: Tool<z.infer<typeof StatsArgs>> = {
  name: 'shop_stats',
  about: 'Статистика продавца за 7 или 30 дней: просмотры, лайки, запросы, продажи, выручка и сравнение с прошлым периодом.',
  args: StatsArgs,
  kind: 'read',
  async run(ctx, { days }) {
    const o = (await ctx.stats.overview(ctx.userId, days ?? 7)) as unknown as Record<string, unknown>;
    // The per-day series and the per-item rows are for charts; the totals are what a person asks about.
    const { series: _s, listings: _l, ...totals } = o;
    return { report: '', data: totals, links: ['stats'] };
  },
};

const NoArgs = z.object({}).strict();

export const pending: Tool<z.infer<typeof NoArgs>> = {
  name: 'pending',
  about: 'Что ждёт ответа: заявки на покупку и предложения цены (с id для answer_request / answer_offer), сделки, ждущие передачи.',
  args: NoArgs,
  kind: 'read',
  async run(ctx) {
    const now = new Date();
    const deals = await ctx.prisma.buyRequest.findMany({
      where: { sellerId: ctx.userId, status: { in: ['PENDING_SELLER', 'WAITING_HANDOVER'] } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, number: true, status: true, priceTotal: true, deliveryMethod: true, expiresAt: true, buyer: { select: { username: true } }, items: { select: { listing: { select: { title: true } } } } },
    });
    const offers = await ctx.prisma.offer.findMany({
      where: { status: 'PENDING', expiresAt: { gt: now }, OR: [{ sellerId: ctx.userId, from: 'BUYER' }, { buyerId: ctx.userId, from: 'SELLER' }] },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, amount: true, round: true, expiresAt: true, sellerId: true, buyer: { select: { username: true } }, listing: { select: { title: true, price: true } } },
    });
    return {
      report: '',
      data: {
        requests: deals.map((d) => ({
          id: d.id,
          number: d.number,
          waitsFor: d.status === 'PENDING_SELLER' ? 'ответа продавца' : 'передачи вещи',
          buyer: d.buyer.username,
          total: d.priceTotal,
          delivery: d.deliveryMethod,
          items: d.items.map((i) => i.listing.title),
          expiresAt: d.expiresAt,
        })),
        offers: offers.map((o) => ({ id: o.id, iAm: o.sellerId === ctx.userId ? 'продавец' : 'покупатель', buyer: o.buyer.username, item: o.listing.title, price: o.listing.price, offered: o.amount, round: o.round, expiresAt: o.expiresAt })),
      },
      links: ['sales_action'],
    };
  },
};

const HelpArgs = z.object({ topic: z.enum(TOPICS.map((t) => t.id) as [string, ...string[]]) }).strict();

export const help: Tool<z.infer<typeof HelpArgs>> = {
  name: 'help',
  about: 'Раздел справки о площадке целиком (если краткого содержания в подсказке не хватило).',
  args: HelpArgs,
  kind: 'read',
  async run(_ctx, { topic }) {
    const t = topicById(topic)!;
    return { report: '', data: { title: t.title, text: t.text }, links: t.links };
  },
};
