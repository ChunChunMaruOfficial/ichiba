import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.js';
import { AdminGuard } from '../moderation/moderation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BATCHES } from './hand-batches.js';

/**
 * The admin «Импорты»: every outside source the site lists from, in one place — the mirrored Telegram channels
 * (tg/), the brand web shops (shops/) and the hand batches (hand-batches.ts) — with when each last ran, what it
 * made of its posts or products, and what of it is on sale now. A channel or a shop can be paused here (the sync
 * skips a disabled source) and resumed.
 */
const LIVE = ['PUBLISHED', 'RESERVED'] as const;
const Enabled = z.object({ enabled: z.boolean() });

@Controller('admin/imports')
@UseGuards(AdminGuard)
export class AdminImportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview() {
    const [tg, shops, hand] = await Promise.all([this.telegram(), this.webShops(), this.handBatches()]);
    return { tg, shops, hand };
  }

  @Patch('tg/:channel')
  async toggleTg(@Param('channel') channel: string, @Body(new ZodPipe(Enabled)) dto: z.infer<typeof Enabled>) {
    await this.prisma.tgSource.update({ where: { channel }, data: { enabled: dto.enabled } });
    return { ok: true };
  }

  @Patch('shops/:key')
  async toggleShop(@Param('key') key: string, @Body(new ZodPipe(Enabled)) dto: z.infer<typeof Enabled>) {
    await this.prisma.shopSource.update({ where: { key }, data: { enabled: dto.enabled } });
    return { ok: true };
  }

  /** On sale now, and everything ever listed, per seller. */
  private async sellerCounts(userIds: string[]) {
    const rows = await this.prisma.listing.groupBy({ by: ['sellerId', 'status'], where: { sellerId: { in: userIds } }, _count: true });
    const out = new Map<string, { live: number; all: number }>();
    for (const r of rows) {
      const c = out.get(r.sellerId) ?? { live: 0, all: 0 };
      if ((LIVE as readonly string[]).includes(r.status)) c.live += r._count;
      if (r.status !== 'DELETED') c.all += r._count;
      out.set(r.sellerId, c);
    }
    return out;
  }

  private async telegram() {
    const sources = await this.prisma.tgSource.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, channel: true, enabled: true, lastSyncAt: true, userId: true, user: { select: { username: true } } } });
    const [posts, counts] = await Promise.all([
      this.prisma.tgPost.groupBy({ by: ['sourceId', 'status'], _count: true }),
      this.sellerCounts(sources.map((s) => s.userId)),
    ]);
    return sources.map((s) => ({
      channel: s.channel,
      username: s.user.username,
      enabled: s.enabled,
      lastSyncAt: s.lastSyncAt,
      posts: Object.fromEntries(posts.filter((p) => p.sourceId === s.id).map((p) => [p.status.toLowerCase(), p._count])) as Record<string, number>,
      ...(counts.get(s.userId) ?? { live: 0, all: 0 }),
    }));
  }

  private async webShops() {
    const sources = await this.prisma.shopSource.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, key: true, enabled: true, lastSyncAt: true, userId: true, user: { select: { username: true } } } });
    const [products, counts] = await Promise.all([
      this.prisma.shopProduct.groupBy({ by: ['sourceId', 'status'], _count: true }),
      this.sellerCounts(sources.map((s) => s.userId)),
    ]);
    return sources.map((s) => ({
      key: s.key,
      username: s.user.username,
      enabled: s.enabled,
      lastSyncAt: s.lastSyncAt,
      products: Object.fromEntries(products.filter((p) => p.sourceId === s.id).map((p) => [p.status.toLowerCase(), p._count])) as Record<string, number>,
      ...(counts.get(s.userId) ?? { live: 0, all: 0 }),
    }));
  }

  /** Each batch against the database: which of its items the seller has (any status but deleted) and which never got listed. */
  private async handBatches() {
    const users = await this.prisma.user.findMany({ where: { username: { in: BATCHES.map((b) => b.username) } }, select: { id: true, username: true, createdAt: true, passwordHash: true, avatarId: true } });
    const byNick = new Map(users.map((u) => [u.username, u]));
    const counts = await this.sellerCounts(users.map((u) => u.id));
    const listed = await this.prisma.listing.findMany({
      where: { sellerId: { in: users.map((u) => u.id) }, status: { not: 'DELETED' } },
      select: { sellerId: true, title: true, status: true },
    });
    const titles = new Map<string, Map<string, string>>();
    for (const l of listed) titles.set(l.sellerId, (titles.get(l.sellerId) ?? new Map()).set(l.title, l.status));
    return BATCHES.map((b) => {
      const u = byNick.get(b.username);
      const have = u ? (titles.get(u.id) ?? new Map<string, string>()) : new Map<string, string>();
      const missing = b.items.map((i) => i.input.title!).filter((t) => !have.has(t));
      return {
        username: b.username,
        account: u ? { createdAt: u.createdAt, hasPassword: !!u.passwordHash, hasAvatar: !!u.avatarId, own: !!b.account } : null,
        brand: b.account?.brandName ?? null,
        items: b.items.length,
        listed: b.items.length - missing.length,
        missing,
        ...(u ? (counts.get(u.id) ?? { live: 0, all: 0 }) : { live: 0, all: 0 }),
      };
    });
  }
}
