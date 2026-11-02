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

  /** The log, newest first: by section (brands / resale), by kind of action and by seller nickname. */
  @Get('activity')
  async list(@Query('page') page = '1', @Query('market') market = 'all', @Query('action') action = '', @Query('q') q = '') {
    const term = q.trim().toLowerCase().replace(/^@/, '');
    const sellers = term ? await this.prisma.user.findMany({ where: { username: { contains: term } }, select: { id: true }, take: 200 }) : null;
    const where: Prisma.SellerActivityWhereInput = {
      ...(market === 'brands' ? { market: 'CATALOG' } : market === 'resale' ? { market: 'RESALE' } : {}),
      ...(action ? { action: action === 'deal' ? { startsWith: 'deal_' } : action } : {}),
      ...(sellers ? { userId: { in: sellers.map((s) => s.id) } } : {}),
    };
    const skip = (Math.max(1, Number(page) || 1) - 1) * PAGE;
    const [total, rows] = await Promise.all([this.prisma.sellerActivity.count({ where }), this.prisma.sellerActivity.findMany({ where, orderBy: { at: 'desc' }, skip, take: PAGE })]);
    const [users, listings] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, username: true, brandVerifiedAt: true, brandName: true } }),
      this.prisma.listing.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.listingId ? [r.listingId] : [])))] } }, select: { id: true, title: true, status: true } }),
    ]);
    const user = new Map(users.map((u) => [u.id, u]));
    const listing = new Map(listings.map((l) => [l.id, l]));
    return {
      total,
      pageSize: PAGE,
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
