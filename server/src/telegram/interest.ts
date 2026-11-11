/**
 * Telegram-only pings to a seller about interest in their items: someone saved an item (♡), put it in a cart, or
 * followed the shop — and an evening summary of the day. They never name the buyer: the seller only ever sees counts
 * (D4, favorites.controller.ts). At most one ping per item and kind an hour, one follower ping an hour; the rest
 * shows up in the evening summary. Groups `interest` and `digest`, switchable on the site and in the bot.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { withJobLock } from '../common/job-lock.js';
import { background } from '../common/background.js';
import { esc as h } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { StatsService, type StatField } from '../stats/stats.js';
import { type Keyboard } from './bot-api.js';
import { signed } from './callbacks.js';
import { linkButton, TelegramNotifier } from './notifier.js';
import { tgPrefsOf } from './texts.js';

const HOUR_S = 3600;
const MINSK_OFFSET_MS = 3 * 3600_000;
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s) || 'Без названия';

/** The text of an interest ping. */
export function interestMessage(kind: 'favorites' | 'carts', title: string, favoritesCount: number) {
  return kind === 'favorites'
    ? `♡ <b>Вещь добавили в избранное</b>\n\n«${h(short(title))}» — теперь в избранном у ${favoritesCount}. Когда снизите цену, все они узнают об этом.`
    : `🛒 <b>Вещь положили в корзину</b>\n\n«${h(short(title))}» — кто-то собирается её купить. Запрос на покупку придёт сюда.`;
}

export interface DayTotals {
  views: number;
  favorites: number;
  carts: number;
  chats: number;
  offers: number;
  requests: number;
}

/** The evening summary, or null when the day had nothing worth a message. */
export function digestMessage(username: string, t: DayTotals, top: Array<{ title: string; views: number }>) {
  if (!t.views && !t.favorites && !t.carts && !t.chats && !t.offers && !t.requests) return null;
  const parts = [
    `👁 ${t.views}`,
    t.favorites ? `♡ ${t.favorites}` : null,
    t.carts ? `🛒 ${t.carts}` : null,
    t.chats ? `✉️ ${t.chats}` : null,
    t.offers ? `💬 ${t.offers}` : null,
    t.requests ? `🛍 ${t.requests}` : null,
  ].filter(Boolean);
  return [
    `🌙 <b>Итоги дня</b> · @${h(username)}`,
    '',
    parts.join(' · '),
    top.length ? `\n<b>Больше всего смотрели</b>\n${top.map((x, i) => `${i + 1}. «${h(short(x.title, 50))}» — 👁 ${x.views}`).join('\n')}` : '',
    '',
    '<i>👁 просмотры · ♡ в избранное · 🛒 в корзину · ✉️ чаты · 💬 предложения · 🛍 запросы</i>',
  ].join('\n');
}

@Injectable()
export class TelegramInterest implements OnModuleInit {
  private readonly logger = new Logger('TelegramInterest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stats: StatsService,
    private readonly notifier: TelegramNotifier,
  ) {}

  onModuleInit() {
    this.stats.onTrack((listingId, field) => {
      if (field === 'favorites' || field === 'carts') background(this.item(listingId, field), `telegram ${field}`);
    });
  }

  private menuButton(chatId: string, sellerId: string, listingId?: string): Keyboard {
    return [[{ text: listingId ? 'Открыть вещь в боте' : 'Мой магазин', callback_data: signed(chatId, listingId ? `+v:${listingId}` : `+m:${sellerId}`) }]];
  }

  async item(listingId: string, kind: 'favorites' | 'carts') {
    if (!this.notifier.enabled) return;
    const l = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { sellerId: true, title: true, favoritesCount: true, status: true } });
    // Only items on sale: a ♡ on a sold item is the buyer's bookmark, not news for the seller.
    if (!l || (l.status !== 'PUBLISHED' && l.status !== 'RESERVED')) return;
    // Cheap check first: no linked chat, nothing to throttle.
    if (!(await this.notifier.target(l.sellerId, 'interest'))) return;
    if (!(await this.notifier.once(`interest:${kind}:${listingId}`, HOUR_S))) return;
    await this.notifier.direct(l.sellerId, 'interest', interestMessage(kind, l.title, l.favoritesCount), (chat) => this.menuButton(chat, l.sellerId, listingId), await this.notifier.coverOf(listingId));
  }

  /** A new follower (follows.controller.ts). */
  async follower(sellerId: string) {
    if (!this.notifier.enabled) return;
    if (!(await this.notifier.target(sellerId, 'interest'))) return;
    if (!(await this.notifier.once(`interest:follow:${sellerId}`, HOUR_S))) return;
    const total = await this.prisma.follow.count({ where: { sellerId } });
    await this.notifier.direct(sellerId, 'interest', `👤 <b>Новый подписчик</b>\n\nНа магазин подписаны: <b>${total}</b>. Они увидят ваши новые вещи первыми.`, (chat) => this.menuButton(chat, sellerId));
  }

  /** Every evening at 21:00 Minsk: the day of each seller who gets the summary. */
  @Cron('0 21 * * *', { timeZone: 'Europe/Minsk' })
  async evening() {
    if (!this.notifier.enabled) return;
    await withJobLock(this.redis, 'telegram-digest', 30 * 60_000, () => this.digest());
  }

  async digest(now = Date.now()) {
    const d = new Date(now + MINSK_OFFSET_MS);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const sellers = await this.prisma.user.findMany({
      where: { tgChatId: { not: null }, deletedAt: null, blockedAt: null, listings: { some: { stats: { some: { day } } } } },
      select: { id: true, username: true, tgPrefs: true },
    });
    let sent = 0;
    for (const s of sellers) {
      if (!tgPrefsOf(s.tgPrefs).digest) continue;
      const rows = await this.prisma.listingStat.findMany({ where: { day, listing: { sellerId: s.id } }, select: { views: true, favorites: true, carts: true, chats: true, offers: true, requests: true, listing: { select: { title: true } } } });
      const t: DayTotals = { views: 0, favorites: 0, carts: 0, chats: 0, offers: 0, requests: 0 };
      for (const r of rows) for (const k of Object.keys(t) as StatField[]) t[k] += r[k];
      const top = rows
        .filter((r) => r.views > 0)
        .sort((a, b) => b.views - a.views)
        .slice(0, 3)
        .map((r) => ({ title: r.listing.title, views: r.views }));
      const html = digestMessage(s.username, t, top);
      if (!html) continue;
      const more = linkButton('Статистика на сайте', '/sales/stats');
      const res = await this.notifier.direct(s.id, 'digest', html, (chat) => [...this.menuButton(chat, s.id), ...(more.length ? [more] : [])]);
      if (res) sent++;
      // Telegram allows ~30 messages a second across chats: stay well below.
      await new Promise((r) => setTimeout(r, 60));
    }
    if (sent) this.logger.log(`evening summary: ${sent} sent`);
  }
}
