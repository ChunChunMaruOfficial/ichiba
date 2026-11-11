import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withJobLock } from '../../common/job-lock.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.js';
import { allowlisted, patchTgAdmin, logPrefsOf, ownerUsername, stateOf } from './access.js';
import { actionEmoji, actionLabel, groupOf, logLine, type LogRow } from './activity-labels.js';
import { AdminBotService } from './admin-bot.js';
import { btn, h, num } from './ui.js';

const CURSOR_KEY = 'ichiba:tgadm:logCursor';
/** Rows younger than this wait for the next minute: a write still in flight must not slip behind the cursor. */
const SETTLE_MS = 5000;
const MAX_LINES = 15;
const HOUR = 3600_000;

type Raw = { id: string; userId: string; action: string; listingId: string | null; market: string | null; detail: string | null; at: Date };

/**
 * Sends changes in the admin «Журнал» (SellerActivity) to admins in the admin bot: every minute what is new since
 * the last run — one message, not one per row — or one digest an hour, by each admin's 🔔 settings.
 */
@Injectable()
export class AdminLogNotifier {
  private readonly logger = new Logger('AdminLog');
  private memCursor: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly bot: AdminBotService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (!this.bot.enabled) return;
    await withJobLock(this.redis, 'tgadmin.log', 5 * 60_000, async () => {
      await this.bot.sweepExpired();
      await this.run();
    });
  }

  private async cursor(): Promise<Date | null> {
    if (this.redis.client) {
      try {
        const v = await this.redis.client.get(CURSOR_KEY);
        return v ? new Date(v) : null;
      } catch {
        // Redis down: this instance's memory.
      }
    }
    return this.memCursor;
  }
  private async setCursor(d: Date) {
    this.memCursor = d;
    await this.redis.client?.set(CURSOR_KEY, d.toISOString(), 'EX', 7 * 24 * 3600).catch(() => undefined);
  }

  async run(now = new Date()) {
    const until = new Date(now.getTime() - SETTLE_MS);
    const since = await this.cursor();
    // First run: start from now, the past is in the journal itself.
    if (!since) return this.setCursor(until);
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', tgChatId: { not: null }, blockedAt: null, deletedAt: null },
      select: { id: true, tgChatId: true, tgAdmin: true, tgUsername: true, sessionVersion: true, tgSessionVersion: true },
    });
    // Same gates as the panel: a link older than the last password reset / block is void, and only the owner's Telegram.
    const targets = admins
      .filter((a) => a.tgSessionVersion === a.sessionVersion && allowlisted(a.tgChatId!) && ownerUsername(a.tgUsername ?? undefined)).map((a) => ({ ...a, prefs: logPrefsOf(stateOf(a.tgAdmin)) }));

    let next = until;
    if (since < until && targets.some((t) => t.prefs.mode === 'instant')) {
      const rows = await this.rows(since, until);
      // A burst bigger than one batch (a hand import): the rest goes next minute.
      if (rows.length >= 500) next = new Date(rows[rows.length - 1].at);
      for (const t of targets.filter((x) => x.prefs.mode === 'instant')) {
        const mine = rows.filter((r) => !t.prefs.off.includes(groupOf(r.action)));
        if (mine.length) await this.send(t.tgChatId!, this.instant(mine));
      }
    }
    await this.setCursor(next);

    for (const t of targets.filter((x) => x.prefs.mode === 'hourly')) {
      const from = t.prefs.digestAt ? new Date(t.prefs.digestAt) : null;
      if (from && until.getTime() - from.getTime() < HOUR) continue;
      if (from) {
        const mine = (await this.rows(from, until, 2000)).filter((r) => !t.prefs.off.includes(groupOf(r.action)));
        if (mine.length) await this.send(t.tgChatId!, this.digest(mine, from));
      }
      await patchTgAdmin(this.prisma, t.id, 'log', { digestAt: until.toISOString() }, true);
    }
  }

  private async rows(since: Date, until: Date, take = 500): Promise<LogRow[]> {
    const raw: Raw[] = await this.prisma.sellerActivity.findMany({ where: { at: { gt: since, lte: until } }, orderBy: { at: 'asc' }, take });
    const [users, listings] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(raw.map((r) => r.userId))] } }, select: { id: true, username: true, brandVerifiedAt: true, brandName: true } }),
      this.prisma.listing.findMany({ where: { id: { in: [...new Set(raw.flatMap((r) => (r.listingId ? [r.listingId] : [])))] } }, select: { id: true, title: true } }),
    ]);
    const U = new Map(users.map((u) => [u.id, u]));
    const L = new Map(listings.map((l) => [l.id, l]));
    return raw.map((r) => {
      const u = U.get(r.userId);
      return {
        at: r.at,
        action: r.action,
        detail: r.detail,
        market: r.market === 'CATALOG' ? 'brands' : r.market === 'RESALE' ? 'resale' : null,
        seller: u ? { username: u.username, brand: u.brandVerifiedAt ? (u.brandName ?? true) : null } : null,
        listing: r.listingId && L.get(r.listingId) ? { id: r.listingId, title: L.get(r.listingId)!.title } : null,
      };
    });
  }

  /** Newest last, as they happened; the rest counted. */
  instant(rows: LogRow[]) {
    const shown = rows.slice(-MAX_LINES);
    const more = rows.length - shown.length;
    return `📜 <b>Журнал</b> · ${rows.length === 1 ? 'новая запись' : `${num(rows.length)} новых`}\n\n${shown.map((r) => logLine(r)).join('\n')}${more ? `\n\n<i>…и ещё ${num(more)} раньше</i>` : ''}`;
  }

  digest(rows: LogRow[], from: Date) {
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.action, (by.get(r.action) ?? 0) + 1);
    const sellers = new Set(rows.map((r) => r.seller?.username).filter(Boolean)).size;
    const top = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${actionEmoji(a)} ${h(actionLabel(a))}: <b>${num(n)}</b>`);
    const since = from.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit' });
    return `📜 <b>Журнал за час</b> · с ${since}\n\n${num(rows.length)} записей, продавцов: ${sellers}\n${top.join('\n')}\n\n<b>Последние</b>\n${rows.slice(-8).map((r) => logLine(r)).join('\n')}`;
  }

  private async send(chatId: string, html: string) {
    try {
      await this.bot.panel.notice(chatId, html, [[btn('📜 Открыть журнал', 'log'), btn('🔔 Настроить', 'notify')]]);
    } catch (e) {
      this.logger.warn(`journal notice to ${chatId}: ${(e as Error).message}`);
    }
  }
}
