/**
 * «Подбор» — the site's swipe (swipe/swipe.ts) in Telegram: one photo message the person flips through, like a
 * dating bot — «Нравится» saves the item to favourites and teaches the recommendations, «Не моё» hides similar
 * ones for a week, exactly as the swipe on the site (the same controller does both; the deck is ranked for the
 * person by the same recommendations, without what they already swiped or saved).
 *
 * Why a photo message and not a widget: clothes are chosen by the photo, and a widget can't show one (no network
 * in it, 4 KB for the whole code). So it is one message edited in place (editMessageMedia), never a stream of them;
 * a new «Подбор» replaces the old one. Buttons are signed for the chat (callbacks.ts) and colored (Bot API 9.4).
 */
import { Injectable, Logger } from '@nestjs/common';
import { appUrl, esc as h } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { RedisService } from '../redis/redis.js';
import { StatsService } from '../stats/stats.js';
import { SwipeController } from '../swipe/swipe.js';
import { type InlineButton, type Keyboard, tg, TelegramError } from './bot-api.js';
import { signed } from './callbacks.js';

type Market = 'brands' | 'resale';
interface Card {
  id: string;
  title: string;
  price: number | null;
  size?: string | null;
  brand?: string | null;
  slug?: string;
  cover: { urls: Record<string, string> } | null;
  seller: { username: string; brand: string | null };
}
/** Where a chat is in its deck: the account, the market, the cards still to show. */
interface Deck {
  acc: string;
  m: Market;
  q: string[];
  msg?: number;
}

const DECK_TTL_S = 24 * 3600;

@Injectable()
export class TelegramSwipeService {
  private readonly logger = new Logger('TelegramSwipe');
  private readonly swipe: SwipeController;
  private readonly mem = new Map<number, Deck>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    recs: RecommendationsService,
    stats: StatsService,
  ) {
    // The site's own swipe: the same deck ranking and the same ♡ / «не моё» bookkeeping.
    this.swipe = new SwipeController(prisma, recs, stats);
  }

  private async load(chatId: number): Promise<Deck | null> {
    if (this.redis.client) {
      try {
        const raw = await this.redis.client.get(`ichiba:tg:swipe:${chatId}`);
        return raw ? (JSON.parse(raw) as Deck) : null;
      } catch {
        // Redis down: memory.
      }
    }
    return this.mem.get(chatId) ?? null;
  }

  private async save(chatId: number, d: Deck) {
    if (this.redis.client) {
      try {
        await this.redis.client.set(`ichiba:tg:swipe:${chatId}`, JSON.stringify(d), 'EX', DECK_TTL_S);
        return;
      } catch {
        // Redis down: memory.
      }
    }
    if (this.mem.size > 5000) this.mem.clear();
    this.mem.set(chatId, d);
  }

  /** The next cards for this person, ranked as on the site; only ones with a photo Telegram can fetch. */
  private async refill(d: Deck): Promise<string[]> {
    const { items } = (await this.swipe.deck('20', 'swipe_mode', '', d.m === 'resale' ? 'resale' : '', { id: d.acc } as never)) as { items: Card[] };
    return items.filter((c) => this.photo(c)).map((c) => c.id);
  }

  private photo(c: Card) {
    const url = c.cover?.urls.l ?? c.cover?.urls.m;
    return url?.startsWith('https://') ? url : null;
  }

  private caption(c: Card, m: Market) {
    const who = c.seller.brand ? h(c.seller.brand) : `@${h(c.seller.username)}`;
    const facts = [c.price != null ? `<b>${c.price.toLocaleString('ru-RU')} BYN</b>` : 'Цена договорная', c.size ? `размер ${h(c.size)}` : null].filter(Boolean).join(' · ');
    return [`<b>Подбор ichiba</b> · ${m === 'resale' ? 'вторичка' : 'бренды'}`, '', `<b>${h(c.title || 'Без названия')}</b>`, facts, who].join('\n');
  }

  private keyboard(chatId: number, c: Card, m: Market): Keyboard {
    const btn = (text: string, data: string, style?: InlineButton['style']): InlineButton => ({ text, callback_data: signed(chatId, data), ...(style ? { style } : {}) });
    const page = `${appUrl()}/item/${c.id}${c.slug ? `-${c.slug}` : ''}`;
    return [
      [btn('Не моё', `sw:l:${c.id}`, 'danger'), btn('Нравится', `sw:r:${c.id}`, 'success')],
      [...(page.startsWith('https://') ? [{ text: 'Подробнее на сайте', url: page }] : []), btn(m === 'resale' ? 'Смотреть бренды' : 'Смотреть вторичку', `sw:m:${m === 'resale' ? 'b' : 'r'}`)],
      [btn('Вернуть прошлую', 'sw:u'), btn('В меню', 'W', 'primary')],
    ];
  }

  /** Shows the next card of the deck in the chat's swipe message (or a new one); the deck is refilled when empty. */
  private async show(chatId: number, d: Deck, note?: string) {
    let card: Card | null = null;
    for (let tries = 0; tries < 3 && !card; tries++) {
      if (!d.q.length) d.q = await this.refill(d);
      const id = d.q.shift();
      if (!id) break;
      card = await this.cardById(id, d.acc);
    }
    if (!card) {
      const end = `<b>Подбор ichiba</b>\n\nВы посмотрели всё, что подходит, — новые вещи появляются каждый день.${note ? `\n\n${note}` : ''}`;
      const kb: Keyboard = [[{ text: d.m === 'resale' ? 'Смотреть бренды' : 'Смотреть вторичку', callback_data: signed(chatId, `sw:m:${d.m === 'resale' ? 'b' : 'r'}`) }], [{ text: 'В меню', callback_data: signed(chatId, 'W'), style: 'primary' }]];
      if (d.msg) await tg('editMessageCaption', { chat_id: chatId, message_id: d.msg, caption: end, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(() => undefined);
      else d.msg = (await tg<{ message_id: number }>('sendMessage', { chat_id: chatId, text: end, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } })).message_id;
      await this.save(chatId, d);
      return;
    }
    const caption = (note ? `<i>${h(note)}</i>\n\n` : '') + this.caption(card, d.m);
    const markup = { inline_keyboard: this.keyboard(chatId, card, d.m) };
    const photo = this.photo(card)!;
    if (d.msg) {
      try {
        await tg('editMessageMedia', { chat_id: chatId, message_id: d.msg, media: { type: 'photo', media: photo, caption, parse_mode: 'HTML' }, reply_markup: markup });
        await this.save(chatId, d);
        return;
      } catch (e) {
        if (!(e instanceof TelegramError) || !/not modified/i.test(e.description)) d.msg = undefined;
        else return;
      }
    }
    d.msg = (await tg<{ message_id: number }>('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: markup })).message_id;
    await this.save(chatId, d);
  }

  private async cardById(id: string, acc: string): Promise<Card | null> {
    const l = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, status: true, title: true, price: true, priceNegotiable: true, sizeValue: true, sellerId: true, seller: { select: { username: true, brandVerifiedAt: true, brandName: true } }, photos: { orderBy: { order: 'asc' }, take: 1, select: { key: true, provider: true } } },
    });
    if (!l || l.status !== 'PUBLISHED' || l.sellerId === acc || !l.photos[0]) return null;
    const { photoUrls } = await import('../media/media.service.js');
    return {
      id: l.id,
      title: l.title,
      price: l.priceNegotiable ? null : l.price,
      size: l.sizeValue,
      cover: { urls: photoUrls(l.photos[0]) as unknown as Record<string, string> },
      seller: { username: l.seller.username, brand: l.seller.brandVerifiedAt ? (l.seller.brandName ?? l.seller.username) : null },
    };
  }

  /** «Подбор» from the menu: a fresh deck for this account, in a new message that replaces the old one. */
  async open(chatId: number, acc: string, market: Market = 'brands') {
    const old = await this.load(chatId);
    if (old?.msg) await tg('deleteMessage', { chat_id: chatId, message_id: old.msg }).catch(() => undefined);
    const d: Deck = { acc, m: market, q: [] };
    await this.show(chatId, d);
    this.logger.log(`chat ${chatId} account ${acc}: swipe opened`);
  }

  /**
   * A button under the swipe message: «sw:r:<id>» / «sw:l:<id>» (only the card on screen counts), «sw:u» undo,
   * «sw:m:b|r» another market. The account is the one the deck was opened for, still linked to this chat.
   */
  async button(chatId: number, linked: string[], data: string, answer: (text?: string) => Promise<unknown>) {
    const d = await this.load(chatId);
    if (!d || !linked.includes(d.acc)) return answer('Подбор устарел — откройте его из меню');
    const m = /^sw:([lr]):([0-9a-f-]{36})$/.exec(data);
    if (m) {
      await this.swipe.swipe({ id: d.acc } as never, { listingId: m[2], direction: m[1] === 'r' ? 'right' : 'left', context: 'swipe_mode' }).catch(() => undefined);
      await answer(m[1] === 'r' ? 'Сохранили в избранное' : 'Больше такого не покажем');
      return this.show(chatId, d);
    }
    if (data === 'sw:u') {
      const { listingId } = await this.swipe.undo({ id: d.acc } as never);
      await answer(listingId ? 'Вернули прошлую вещь' : 'Нечего возвращать');
      if (listingId) d.q.unshift(listingId);
      return this.show(chatId, d);
    }
    const mk = /^sw:m:([br])$/.exec(data);
    if (mk) {
      await answer();
      return this.show(chatId, { ...d, m: mk[1] === 'r' ? 'resale' : 'brands', q: [] });
    }
    return answer();
  }
}
