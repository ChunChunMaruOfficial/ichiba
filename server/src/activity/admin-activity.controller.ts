import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AdminGuard } from '../moderation/moderation.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The admin «Журнал» (activity.ts writes it). A file of its own: services import activity.ts, and the guard's module imports them. */
const PAGE = 50;

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminActivityController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The log, newest first: by section (brands / resale), by kind of action, by seller nickname, by period (`from`,
   * `to` as YYYY-MM-DD, inclusive) and by one item. `summary` counts what the same filters select on every page.
   */
  @Get('activity')
  async list(
    @Query('page') page = '1',
    @Query('market') market = 'all',
    @Query('action') action = '',
    @Query('q') q = '',
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('listing') listingId = '',
  ) {
    const term = q.trim().toLowerCase().replace(/^@/, '');
    const sellers = term ? await this.prisma.user.findMany({ where: { username: { contains: term } }, select: { id: true }, take: 200 }) : null;
    const day = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+03:00`) : null);
    const since = day(from);
    const until = day(to);
    if (until) until.setDate(until.getDate() + 1);
    const where: Prisma.SellerActivityWhereInput = {
      ...(market === 'brands' ? { market: 'CATALOG' } : market === 'resale' ? { market: 'RESALE' } : {}),
      ...(action ? { action: action === 'deal' ? { startsWith: 'deal_' } : action } : {}),
      ...(sellers ? { userId: { in: sellers.map((s) => s.id) } } : {}),
      ...(since || until ? { at: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
      ...(/^[0-9a-f-]{36}$/i.test(listingId) ? { listingId } : {}),
    };
    const skip = (Math.max(1, Number(page) || 1) - 1) * PAGE;
    const [total, rows, byAction, actors] = await Promise.all([
      this.prisma.sellerActivity.count({ where }),
      this.prisma.sellerActivity.findMany({ where, orderBy: { at: 'desc' }, skip, take: PAGE }),
      this.prisma.sellerActivity.groupBy({ by: ['action'], where, _count: true }),
      this.prisma.sellerActivity.findMany({ where, distinct: ['userId'], select: { userId: true } }),
    ]);
    const n = (a: string) => byAction.find((x) => x.action === a)?._count ?? 0;
    const summary = {
      sellers: actors.length,
      created: n('listing_created'),
      published: n('listing_published'),
      sold: n('listing_sold'),
      deals: byAction.filter((x) => x.action.startsWith('deal_')).reduce((s, x) => s + x._count, 0),
    };
    const [users, listings] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, username: true, brandVerifiedAt: true, brandName: true } }),
      this.prisma.listing.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.listingId ? [r.listingId] : [])))] } }, select: { id: true, title: true, status: true } }),
    ]);
    const user = new Map(users.map((u) => [u.id, u]));
    const listing = new Map(listings.map((l) => [l.id, l]));
    return {
      total,
      pageSize: PAGE,
      summary,
      items: rows.map((r) => {
        const u = user.get(r.userId);
        const l = r.listingId ? listing.get(r.listingId) : undefined;
        return {
          id: r.id,
          at: r.at,
          action: r.action,
          detail: r.detail,
          market: r.market === 'CATALOG' ? 'brands' : r.market === 'RESALE' ? 'resale' : null,
          seller: u ? { username: u.username, brand: u.brandVerifiedAt ? (u.brandName ?? true) : null } : null,
          listing: l ? { id: l.id, title: l.title, status: l.status } : null,
        };
      }),
    };
  }
}
