/**
 * The shop side of the bot: a seller manages their items from Telegram — the list of what is on sale, hidden, drafts
 * and sold; an item's card with its numbers; price, «снять с продажи», «вернуть», «продано», «поднять», bargaining
 * on/off, sizes in stock; what waits for an answer; the week's statistics; which notifications to get.
 *
 * Security, in layers (any one of them alone would already refuse a forged action):
 *  1. The webhook only takes updates carrying the secret header (telegram.ts); only private chats are served and the
 *     sender must be the chat itself.
 *  2. The acting accounts are the ones linked to this chat under their current sessionVersion (linkedAccounts).
 *  3. Every button is HMAC-signed for this chat (callbacks.ts): it can't be forged or replayed in another chat.
 *  4. Every action re-checks that the item's seller is one of those accounts, then goes through ListingsService —
 *     the same checks as on the site (ownership, status, running deal or auction, moderation).
 *  5. What can't be undone (sold, a size out of stock, a price) asks for a second tap, and typed input lives in a
 *     short-lived, chat-bound slot (5 min) that only accepts the one value it waits for.
 */
import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ListingsService } from '../listings/listings.service.js';
import { esc as h } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { nextBumpAt } from '../stats/stats.js';
import { type InlineButton, type Keyboard, tg, TelegramError } from './bot-api.js';
import { signed } from './callbacks.js';
import { linkButton, linkedAccounts, notificationKeyboard, TelegramNotifier, UNLINK } from './notifier.js';
import { notificationMessage, TG_CATEGORIES, type TgCategory, tgPrefsOf } from './texts.js';

export type Account = Awaited<ReturnType<typeof linkedAccounts>>[number];

/** Where an answer goes: the chat, and the bot's message the button was under (edited in place) if any. */
export interface Ctx {
  chatId: number;
  messageId?: number;
  hasPhoto?: boolean;
  accounts: Account[];
}

interface Screen {
  html: string;
  keyboard: Keyboard;
  photo?: string | null;
}

/** What the bot waits for the seller to type, and for which item or account. */
type Awaiting = { k: 'price'; lid: string } | { k: 'search'; acc: string };

const PAGE = 8;
const AWAIT_TTL_S = 300;
const MAX_PRICE = 100_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** List filters: f → statuses, heading, empty text. */
const FILTERS = {
  a: { statuses: ['PUBLISHED', 'RESERVED'], title: '📦 В продаже', empty: 'Сейчас ничего не выставлено.' },
  h: { statuses: ['HIDDEN'], title: '🙈 Сняты с продажи', empty: 'Снятых с продажи вещей нет.' },
  d: { statuses: ['DRAFT'], title: '📝 Черновики', empty: 'Черновиков нет.' },
  s: { statuses: ['SOLD'], title: '✅ Проданные', empty: 'Проданных вещей пока нет.' },
} as const;
type Filter = keyof typeof FILTERS;

const STATUS: Record<string, string> = {
  PUBLISHED: '🟢 В продаже',
  RESERVED: '🔒 Идёт сделка',
  HIDDEN: '🙈 Снята с продажи',
  DRAFT: '📝 Черновик',
  SOLD: '✅ Продана',
  BLOCKED: '🚫 Снята модератором',
};
const filterOf = (status: string): Filter => (status === 'HIDDEN' ? 'h' : status === 'DRAFT' ? 'd' : status === 'SOLD' ? 's' : 'a');

/** Same wording as the settings page (client components/telegram-settings.tsx). */
export const CATEGORY_LABELS: Record<TgCategory, string> = {
  deals: 'Покупки и сделки',
  offers: 'Предложения цены',
  chat: 'Сообщения в чате',
  auctions: 'Аукционы',
  interest: 'Интерес к вещам: ♡, корзина, подписчики',
  digest: 'Вечерняя сводка за день',
  favorites: 'Избранное и подписки',
  account: 'Модерация и аккаунт',
};

/** A short fingerprint of a size for a button (sizes may be Cyrillic: bytes, not characters, are limited). */
const sizeTag = (size: string) => createHash('sha256').update(size).digest('hex').slice(0, 6);
const byn = (n: number | null | undefined) => (n == null ? 'договорная' : `${n.toLocaleString('ru-RU')} BYN`);
const short = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s) || 'Без названия';
const title = (s: string) => `«${h(short(s, 60))}»`;

/** A typed price: digits with optional spaces and «BYN»/«р»; null when it isn't one. */
export function parsePrice(text: string): number | null {
  const m = /^(\d[\d\s]{0,7})\s*(byn|бел\.?\s*руб\.?|руб\.?|р\.?)?$/i.exec(text.trim()); // the class of spaces covers the no-break one Telegram may put in a number
  if (!m) return null;
  const n = Number(m[1].replace(/\s/g, ''));
  return Number.isInteger(n) && n >= 1 && n <= MAX_PRICE ? n : null;
}

/** The message of a refused service call, as the site would show it. */
export function refusal(e: unknown): string | null {
  if (!(e instanceof HttpException)) return null;
  const body = e.getResponse() as { message?: string | string[]; fields?: Record<string, string> } | string;
  if (typeof body === 'string') return body;
  const fields = body.fields ? Object.values(body.fields).filter(Boolean).join('; ') : '';
  const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message;
  return [msg, fields].filter(Boolean).join(': ') || 'Не получилось';
}

@Injectable()
export class TelegramShopService {
  private readonly logger = new Logger('TelegramShop');
  /** Typed-input slots when Redis is not configured (one instance). */
  private readonly slots = new Map<number, { v: Awaiting; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly listings: ListingsService,
    private readonly notifier: TelegramNotifier,
  ) {}

  // ---------- plumbing ----------

  /** A signed button for this chat. */
  private btn(ctx: Ctx, text: string, data: string): InlineButton {
    return { text, callback_data: signed(ctx.chatId, data) };
  }

  private rows(...rows: Array<InlineButton[] | false | null | undefined>): Keyboard {
    return rows.filter((r): r is InlineButton[] => !!r && r.length > 0);
  }

  /**
   * Shows a screen: edits the message the button was under when the kind matches (text ↔ text, photo ↔ photo),
   * otherwise sends a new one. «Message is not modified» (a double tap) is not an error.
   */
  async show(ctx: Ctx, s: Screen) {
    const markup = { reply_markup: { inline_keyboard: s.keyboard } };
    const photo = s.photo && s.html.length <= 1000 ? s.photo : null;
    try {
      if (ctx.messageId && !!photo === !!ctx.hasPhoto) {
        if (photo) {
          await tg('editMessageMedia', { chat_id: ctx.chatId, message_id: ctx.messageId, media: { type: 'photo', media: photo, caption: s.html, parse_mode: 'HTML' }, ...markup });
        } else {
          await tg('editMessageText', { chat_id: ctx.chatId, message_id: ctx.messageId, text: s.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup });
        }
        return;
      }
    } catch (e) {
      if (e instanceof TelegramError && /not modified/i.test(e.description)) return;
      if (!(e instanceof TelegramError) || e.code !== 400) throw e;
      // Too old to edit, or Telegram can't fetch the photo: a new message instead.
    }
    if (ctx.messageId) await tg('deleteMessage', { chat_id: ctx.chatId, message_id: ctx.messageId }).catch(() => undefined);
    await this.notifier.send(String(ctx.chatId), s.html, s.keyboard, photo);
  }

  private async setSlot(chatId: number, v: Awaiting) {
    if (this.redis.client) {
      try {
        await this.redis.client.set(`ichiba:tg:await:${chatId}`, JSON.stringify(v), 'EX', AWAIT_TTL_S);
        return;
      } catch {
        // Redis down: this instance's memory.
      }
    }
    if (this.slots.size > 5000) this.slots.clear();
    this.slots.set(chatId, { v, until: Date.now() + AWAIT_TTL_S * 1000 });
  }

  /** Takes the slot (one use) and checks its shape: only what this code wrote is ever acted on. */
  private async takeSlot(chatId: number): Promise<Awaiting | null> {
    let raw: string | null = null;
    if (this.redis.client) {
      try {
        const key = `ichiba:tg:await:${chatId}`;
        const res = await this.redis.client.multi().get(key).del(key).exec();
        raw = (res?.[0]?.[1] as string | null) ?? null;
      } catch {
        raw = null;
      }
    }
    const mem = this.slots.get(chatId);
    this.slots.delete(chatId);
    let v: unknown = mem && mem.until > Date.now() ? mem.v : null;
    if (raw) {
      try {
        v = JSON.parse(raw);
      } catch {
        v = null;
      }
    }
    const o = v as Record<string, unknown> | null;
    const id = new RegExp(`^${UUID}$`);
    if (o?.k === 'price' && typeof o.lid === 'string' && id.test(o.lid)) return { k: 'price', lid: o.lid };
    if (o?.k === 'search' && typeof o.acc === 'string' && id.test(o.acc)) return { k: 'search', acc: o.acc };
    return null;
  }

  clearSlot(chatId: number) {
    this.slots.delete(chatId);
    return this.redis.client?.del(`ichiba:tg:await:${chatId}`).catch(() => undefined);
  }

  private account(ctx: Ctx, id: string | undefined) {
    return id ? (ctx.accounts.find((a) => a.id === id) ?? null) : ctx.accounts.length === 1 ? ctx.accounts[0] : null;
  }

  /** An item the chat may act on: it exists and its seller is one of the chat's accounts. */
  private async own(ctx: Ctx, id: string) {
    const l = await this.prisma.listing.findUnique({ where: { id }, select: { id: true, sellerId: true, status: true, title: true, price: true, priceNegotiable: true, sizes: true, acceptsOffers: true } });
    if (!l || l.status === 'DELETED' || !ctx.accounts.some((a) => a.id === l.sellerId)) return null;
    return l;
  }

  private audit(ctx: Ctx, accountId: string, action: string, listingId?: string) {
    this.logger.log(`chat ${ctx.chatId} account ${accountId}: ${action}${listingId ? ` ${listingId}` : ''}`);
  }

  // ---------- screens ----------

  /** Several shops in one Telegram: pick one first. */
  async accounts(ctx: Ctx): Promise<void> {
    if (ctx.accounts.length === 1) return this.menu(ctx, ctx.accounts[0].id);
    return this.show(ctx, {
      html: `🏮 <b>Ваши магазины</b>\n\nК этому Telegram подключено ${ctx.accounts.length}. Выберите, с каким работать:`,
      keyboard: this.rows(...ctx.accounts.map((a) => [this.btn(ctx, `@${a.username}`, `m:${a.id}`)])),
    });
  }

  async menu(ctx: Ctx, accId?: string): Promise<void> {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    const [counts, requests, offers] = await Promise.all([
      this.prisma.listing.groupBy({ by: ['status'], where: { sellerId: acc.id, status: { in: ['PUBLISHED', 'RESERVED', 'HIDDEN', 'DRAFT', 'SOLD'] } }, _count: true }),
      this.prisma.buyRequest.count({ where: { sellerId: acc.id, status: 'PENDING_SELLER' } }),
      this.prisma.offer.count({ where: { sellerId: acc.id, status: 'PENDING', from: 'BUYER' } }),
    ]);
    const n = (...st: string[]) => counts.filter((c) => st.includes(c.status)).reduce((a, c) => a + c._count, 0);
    const waiting = requests + offers;
    const shop = linkButton('🌐 Магазин на сайте', `/u/${encodeURIComponent(acc.username)}`);
    return this.show(ctx, {
      html: [
        `🏮 <b>Магазин @${h(acc.username)}</b>`,
        '',
        `В продаже: <b>${n('PUBLISHED', 'RESERVED')}</b> · снято: ${n('HIDDEN')} · черновики: ${n('DRAFT')} · продано: ${n('SOLD')}`,
        waiting ? `\n🛍 <b>Ждут вашего ответа: ${waiting}</b>` : '',
      ].join('\n'),
      keyboard: this.rows(
        waiting > 0 && [this.btn(ctx, `🛍 Ждут ответа (${waiting})`, `q:${acc.id}`)],
        [this.btn(ctx, `📦 В продаже (${n('PUBLISHED', 'RESERVED')})`, `l:${acc.id}:a:0`), this.btn(ctx, `🙈 Снятые (${n('HIDDEN')})`, `l:${acc.id}:h:0`)],
        [this.btn(ctx, `📝 Черновики (${n('DRAFT')})`, `l:${acc.id}:d:0`), this.btn(ctx, '✅ Проданные', `l:${acc.id}:s:0`)],
        [this.btn(ctx, '🔎 Найти вещь', `f:${acc.id}`), this.btn(ctx, '📊 Статистика', `t:${acc.id}`)],
        [this.btn(ctx, '🔔 Уведомления', `n:${acc.id}`), ...(ctx.accounts.length > 1 ? [this.btn(ctx, '🔁 Другой магазин', 'm')] : [])],
        shop,
      ),
    });
  }

  async list(ctx: Ctx, accId: string, f: Filter, page: number, query?: string): Promise<void> {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    const statuses: string[] = query ? ['PUBLISHED', 'RESERVED', 'HIDDEN', 'DRAFT', 'SOLD'] : [...FILTERS[f].statuses];
    const where = {
      sellerId: acc.id,
      status: { in: statuses as Array<'PUBLISHED' | 'RESERVED' | 'HIDDEN' | 'DRAFT' | 'SOLD'> },
      ...(query ? { title: { contains: query, mode: 'insensitive' as const } } : {}),
    };
    const total = await this.prisma.listing.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.min(Math.max(0, page), pages - 1);
    const items = await this.prisma.listing.findMany({
      where,
      orderBy: f === 's' && !query ? [{ soldAt: 'desc' }, { updatedAt: 'desc' }] : [{ updatedAt: 'desc' }],
      skip: query ? 0 : p * PAGE,
      take: PAGE,
      select: { id: true, title: true, price: true, status: true },
    });
    const heading = query ? `🔎 «${h(short(query, 40))}»` : FILTERS[f].title;
    const summary = total
      ? query
        ? `Нашлось: ${total}${total > PAGE ? ` (показаны первые ${PAGE})` : ''}`
        : `Всего: ${total}. Нажмите на вещь, чтобы изменить её.`
      : query
        ? 'Ничего не нашлось.'
        : FILTERS[f].empty;
    const mark = (st: string) => (st === 'RESERVED' ? '🔒 ' : query ? `${(STATUS[st] ?? '').split(' ')[0]} ` : '');
    return this.show(ctx, {
      html: `${heading} · @${h(acc.username)}\n\n${summary}`,
      keyboard: this.rows(
        ...items.map((l) => [this.btn(ctx, `${mark(l.status)}${short(l.title, 32)} · ${byn(l.price)}`, `v:${l.id}`)]),
        !query && pages > 1 && [
          this.btn(ctx, p > 0 ? '‹ Назад' : '·', p > 0 ? `l:${acc.id}:${f}:${p - 1}` : 'x'),
          this.btn(ctx, `${p + 1} / ${pages}`, 'x'),
          this.btn(ctx, p < pages - 1 ? 'Дальше ›' : '·', p < pages - 1 ? `l:${acc.id}:${f}:${p + 1}` : 'x'),
        ],
        [this.btn(ctx, '← Меню', `m:${acc.id}`)],
      ),
    });
  }

  async item(ctx: Ctx, id: string, note?: string): Promise<void> {
    const own = await this.own(ctx, id);
    if (!own) return this.gone(ctx);
    const l = await this.prisma.listing.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        title: true,
        status: true,
        price: true,
        previousPrice: true,
        priceNegotiable: true,
        sizeValue: true,
        sizes: true,
        acceptsOffers: true,
        viewsCount: true,
        favoritesCount: true,
        publishedAt: true,
        lastBumpAt: true,
        hiddenByAdmin: true,
        blockedReason: true,
        saleType: true,
      },
    });
    const auction = await this.prisma.auction.findFirst({ where: { listingId: id, status: 'ACTIVE' }, select: { id: true } });
    const next = nextBumpAt(l);
    const bumpIn = next ? Math.ceil((next.getTime() - Date.now()) / 3600_000) : null;
    const size = l.sizes.length > 1 ? `Размеры в наличии: ${h(l.sizes.join(', '))}` : l.sizeValue ? `Размер: ${h(l.sizeValue)}` : null;
    const live = l.status === 'PUBLISHED';
    const html = [
      note ? `${note}\n` : null,
      `<b>${h(short(l.title, 80))}</b>`,
      `💰 ${l.priceNegotiable ? 'Цена договорная' : `<b>${byn(l.price)}</b>`}${l.previousPrice ? ` <s>${byn(l.previousPrice)}</s>` : ''}`,
      size && `📏 ${size}`,
      `${STATUS[l.status] ?? h(l.status)}${auction ? ' · 🔨 идёт аукцион' : ''}`,
      l.status === 'BLOCKED' && l.blockedReason ? `Причина: ${h(l.blockedReason)}` : null,
      l.hiddenByAdmin ? '⚠️ Скрыта администрацией — вернуть её в продажу можно только через поддержку' : null,
      live || l.status === 'RESERVED' ? `👁 ${l.viewsCount} · ♡ ${l.favoritesCount} · ${l.acceptsOffers ? '🤝 торг принимается' : 'без торга'}` : null,
      live && bumpIn != null ? (bumpIn <= 0 ? '⏫ Можно поднять в ленте' : `⏫ Поднять можно через ${bumpIn} ч`) : null,
    ]
      .filter(Boolean)
      .join('\n');

    const editable = live || l.status === 'HIDDEN' || l.status === 'DRAFT';
    const keyboard = this.rows(
      editable && !auction && [this.btn(ctx, '💰 Изменить цену', `p:${id}`), ...(live && bumpIn != null && bumpIn <= 0 ? [this.btn(ctx, '⏫ Поднять', `b:${id}`)] : [])],
      live && [this.btn(ctx, '🙈 Снять с продажи', `h:${id}`), this.btn(ctx, '✅ Продано', `s:${id}`)],
      l.status === 'HIDDEN' && !l.hiddenByAdmin && [this.btn(ctx, '👁 Вернуть в продажу', `u:${id}`), this.btn(ctx, '✅ Продано', `s:${id}`)],
      l.status === 'DRAFT' && [this.btn(ctx, '🚀 Опубликовать', `u:${id}`)],
      live && l.saleType === 'FIXED' && !l.priceNegotiable && !auction && [this.btn(ctx, l.acceptsOffers ? '🤝 Выключить торг' : '🤝 Включить торг', `o:${id}`)],
      (live || l.status === 'HIDDEN') && l.sizes.length > 1 && [this.btn(ctx, '📏 Размеры в наличии', `z:${id}`)],
      l.status === 'RESERVED' && [this.btn(ctx, '🛍 Ждут ответа', `q:${l.sellerId}`)],
      [...linkButton('✏️ Редактировать', `/item/${id}/edit`), ...linkButton('🌐 На сайте', `/item/${id}`)],
      [this.btn(ctx, '← К списку', `l:${l.sellerId}:${filterOf(l.status)}:0`), this.btn(ctx, '☰ Меню', `m:${l.sellerId}`)],
    );
    return this.show(ctx, { html, keyboard, photo: await this.notifier.coverOf(id) });
  }

  private gone(ctx: Ctx) {
    return this.show(ctx, { html: 'Этой вещи нет или она не из ваших магазинов.', keyboard: this.rows([this.btn(ctx, '☰ Меню', 'm')]) });
  }

  // ---------- actions on an item ----------

  /** Runs a ListingsService call for the item's seller; a refusal is shown on the card instead of thrown. */
  private async act(ctx: Ctx, id: string, action: string, run: (sellerId: string) => Promise<unknown>, done: string) {
    const l = await this.own(ctx, id);
    if (!l) return this.gone(ctx);
    try {
      await run(l.sellerId);
    } catch (e) {
      const why = refusal(e);
      if (why == null) throw e;
      return this.item(ctx, id, `⚠️ ${h(why)}`);
    }
    this.audit(ctx, l.sellerId, action, id);
    return this.item(ctx, id, done);
  }

  private async confirm(ctx: Ctx, id: string, question: (t: string) => string, yes: string, yesData: string, back = `v:${id}`) {
    const l = await this.own(ctx, id);
    if (!l) return this.gone(ctx);
    return this.show(ctx, { html: question(title(l.title)), keyboard: this.rows([this.btn(ctx, yes, yesData)], [this.btn(ctx, '← Нет, назад', back)]) });
  }

  /** «Изменить цену»: a reply with the new price is awaited for five minutes. */
  async askPrice(ctx: Ctx, id: string) {
    const l = await this.own(ctx, id);
    if (!l) return this.gone(ctx);
    await this.setSlot(ctx.chatId, { k: 'price', lid: id });
    await tg('sendMessage', {
      chat_id: ctx.chatId,
      text: `💰 Новая цена для ${title(l.title)} — сейчас ${l.priceNegotiable ? 'договорная' : byn(l.price)}.\n\nПришлите число в BYN, например <code>95</code>.\n<i>Отмена: /cancel</i>`,
      parse_mode: 'HTML',
      reply_markup: { force_reply: true, input_field_placeholder: 'Цена в BYN' },
    });
  }

  private async confirmPrice(ctx: Ctx, id: string, price: number) {
    const l = await this.own(ctx, id);
    if (!l) return this.gone(ctx);
    const warn = l.price && price * 2 < l.price ? '\n\n⚠️ Это больше чем вдвое дешевле текущей цены — проверьте, нет ли опечатки.' : '';
    return this.show(ctx, {
      html: `Поставить ${title(l.title)} цену <b>${byn(price)}</b>${l.price ? ` вместо ${byn(l.price)}` : ''}?${warn}`,
      keyboard: this.rows([this.btn(ctx, `✅ Да, ${byn(price)}`, `P:${id}:${price}`)], [this.btn(ctx, 'Отмена', `v:${id}`)]),
    });
  }

  private setPrice(ctx: Ctx, id: string, price: number) {
    if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) return this.item(ctx, id, '⚠️ Такую цену поставить нельзя');
    return this.act(
      ctx,
      id,
      `price → ${price}`,
      async (sellerId) => {
        const l = await this.own(ctx, id);
        await this.listings.update(sellerId, id, { price, ...(l?.priceNegotiable ? { priceNegotiable: false } : {}) });
      },
      `✅ Цена изменена: ${byn(price)}`,
    );
  }

  private toggleOffers(ctx: Ctx, id: string) {
    return this.act(
      ctx,
      id,
      'offers toggle',
      async (sellerId) => {
        const l = await this.own(ctx, id);
        await this.listings.update(sellerId, id, { acceptsOffers: !l?.acceptsOffers });
      },
      '✅ Готово',
    );
  }

  private async sizes(ctx: Ctx, id: string) {
    const l = await this.own(ctx, id);
    if (!l) return this.gone(ctx);
    if (l.sizes.length < 2) return this.item(ctx, id);
    return this.show(ctx, {
      html: `📏 <b>Размеры в наличии</b> · ${title(l.title)}\n\nПродали размер вне ichiba? Нажмите его, чтобы убрать из наличия.`,
      keyboard: this.rows(...l.sizes.map((s, i) => [this.btn(ctx, `✖️ ${short(s, 20)}`, `y:${id}:${i}`)]), [this.btn(ctx, '← К вещи', `v:${id}`)]),
    });
  }

  private async confirmSize(ctx: Ctx, id: string, i: number) {
    const l = await this.own(ctx, id);
    if (!l || !l.sizes[i]) return this.sizes(ctx, id);
    const last = l.sizes.length === 2 ? `\n\nОстанется один размер — ${h(l.sizes[1 - i])}.` : '';
    return this.show(ctx, {
      html: `Убрать размер <b>${h(l.sizes[i])}</b> из наличия ${title(l.title)}?${last}`,
      // The size itself goes into the button, not only its position: a list changed meanwhile can't remove another.
      keyboard: this.rows([this.btn(ctx, `Да, убрать ${short(l.sizes[i], 12)}`, `Y:${id}:${i}:${sizeTag(l.sizes[i])}`)], [this.btn(ctx, '← Назад', `z:${id}`)]),
    });
  }

  private async removeSize(ctx: Ctx, id: string, i: number, check: string) {
    const l = await this.own(ctx, id);
    if (!l || !l.sizes[i] || sizeTag(l.sizes[i]) !== check) return this.item(ctx, id, '⚠️ Список размеров изменился — откройте его заново');
    const size = l.sizes[i];
    return this.act(ctx, id, `size − ${size}`, (sellerId) => this.listings.update(sellerId, id, { sizes: l.sizes.filter((_, j) => j !== i) }), `✅ Размер ${h(size)} убран из наличия`);
  }

  // ---------- what waits, statistics, notifications ----------

  async pending(ctx: Ctx, accId: string) {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    const [requests, offers] = await Promise.all([
      this.prisma.buyRequest.findMany({
        where: { sellerId: acc.id, status: 'PENDING_SELLER' },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true, priceTotal: true, buyer: { select: { username: true } }, items: { select: { listing: { select: { title: true } } }, take: 1 } },
      }),
      this.prisma.offer.findMany({
        where: { sellerId: acc.id, status: 'PENDING', from: 'BUYER' },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true, amount: true, buyer: { select: { username: true } }, listing: { select: { title: true } } },
      }),
    ]);
    const none = !requests.length && !offers.length;
    return this.show(ctx, {
      html: none ? `🛍 <b>Ждут ответа</b> · @${h(acc.username)}\n\nНичего не ждёт — все запросы и предложения отвечены.` : `🛍 <b>Ждут ответа</b> · @${h(acc.username)}\n\nНажмите, чтобы принять или отклонить:`,
      keyboard: this.rows(
        ...requests.map((r) => [this.btn(ctx, `🛍 @${short(r.buyer.username, 14)} · ${short(r.items[0]?.listing.title ?? '', 18)} · ${byn(r.priceTotal)}`, `r:${r.id}`)]),
        ...offers.map((o) => [this.btn(ctx, `💬 @${short(o.buyer.username, 14)} · ${short(o.listing.title, 18)} · ${byn(o.amount)}`, `w:${o.id}`)]),
        linkButton('Все продажи на сайте', '/sales'),
        [this.btn(ctx, '← Меню', `m:${acc.id}`)],
      ),
    });
  }

  /** One request or offer as its notification, with the signed «Принять / Отклонить». */
  private async deal(ctx: Ctx, kind: 'r' | 'w', id: string) {
    const mine = (sellerId: string) => ctx.accounts.some((a) => a.id === sellerId);
    if (kind === 'r') {
      const r = await this.prisma.buyRequest.findUnique({
        where: { id },
        select: { id: true, sellerId: true, status: true, priceTotal: true, buyer: { select: { username: true } }, items: { select: { listingId: true, listing: { select: { title: true } } } } },
      });
      if (!r || !mine(r.sellerId)) return this.gone(ctx);
      if (r.status !== 'PENDING_SELLER') return this.pending(ctx, r.sellerId);
      const more = r.items.length > 1 ? ` и ещё ${r.items.length - 1}` : '';
      const p = { requestId: r.id, title: `${r.items[0]?.listing.title ?? ''}${more}`, price: r.priceTotal, buyer: r.buyer.username };
      return this.notifier.send(String(ctx.chatId), notificationMessage('request_new', p), notificationKeyboard('request_new', p, ctx.chatId), await this.notifier.coverOf(r.items[0]?.listingId ?? ''));
    }
    const o = await this.prisma.offer.findUnique({
      where: { id },
      select: { id: true, sellerId: true, status: true, from: true, amount: true, listingId: true, buyer: { select: { username: true } }, listing: { select: { title: true, price: true } } },
    });
    if (!o || !mine(o.sellerId)) return this.gone(ctx);
    if (o.status !== 'PENDING' || o.from !== 'BUYER') return this.pending(ctx, o.sellerId);
    const p = { offerId: o.id, listingId: o.listingId, title: o.listing.title, amount: o.amount, price: o.listing.price, buyer: o.buyer.username };
    return this.notifier.send(String(ctx.chatId), notificationMessage('offer_new', p), notificationKeyboard('offer_new', p, ctx.chatId), await this.notifier.coverOf(o.listingId));
  }

  async stats(ctx: Ctx, accId: string) {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    const from = new Date(Date.now() - 7 * 24 * 3600_000);
    const rows = await this.prisma.listingStat.findMany({
      where: { day: { gte: from }, listing: { sellerId: acc.id } },
      select: { listingId: true, views: true, favorites: true, carts: true, chats: true, offers: true, requests: true, listing: { select: { title: true } } },
    });
    const sum = { views: 0, favorites: 0, carts: 0, chats: 0, offers: 0, requests: 0 };
    const byItem = new Map<string, { title: string; views: number; favorites: number }>();
    for (const r of rows) {
      for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] += r[k];
      const it = byItem.get(r.listingId) ?? { title: r.listing.title, views: 0, favorites: 0 };
      it.views += r.views;
      it.favorites += r.favorites;
      byItem.set(r.listingId, it);
    }
    const top = [...byItem.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 3);
    const html = [
      `📊 <b>За 7 дней</b> · @${h(acc.username)}`,
      '',
      `👁 Просмотры: <b>${sum.views}</b>`,
      `♡ В избранное: <b>${sum.favorites}</b>`,
      `🛒 В корзину: <b>${sum.carts}</b>`,
      `✉️ Новые чаты: <b>${sum.chats}</b>`,
      `💬 Предложения цены: <b>${sum.offers}</b>`,
      `🛍 Запросы на покупку: <b>${sum.requests}</b>`,
      top.length ? `\n<b>Чаще всего смотрели</b>\n${top.map(([, t], i) => `${i + 1}. ${title(t.title)} — 👁 ${t.views} · ♡ ${t.favorites}`).join('\n')}` : '',
    ].join('\n');
    return this.show(ctx, {
      html,
      keyboard: this.rows(...top.map(([id, t]) => [this.btn(ctx, short(t.title, 36), `v:${id}`)]), linkButton('Подробная статистика', '/sales/stats'), [this.btn(ctx, '← Меню', `m:${acc.id}`)]),
    });
  }

  async prefs(ctx: Ctx, accId: string, note?: string) {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: acc.id }, select: { tgPrefs: true } });
    const prefs = tgPrefsOf(u.tgPrefs);
    return this.show(ctx, {
      html: `${note ? `${note}\n\n` : ''}🔔 <b>Что присылать</b> · @${h(acc.username)}\n\nНажмите, чтобы включить или выключить.`,
      keyboard: this.rows(
        ...TG_CATEGORIES.map((c, i) => [this.btn(ctx, `${prefs[c] ? '✅' : '⬜️'} ${CATEGORY_LABELS[c]}`, `N:${acc.id}:${i}`)]),
        [this.btn(ctx, '🔌 Отключить этот магазин от Telegram', `k:${acc.id}`)],
        [this.btn(ctx, '← Меню', `m:${acc.id}`)],
      ),
    });
  }

  private async togglePref(ctx: Ctx, accId: string, i: number) {
    const acc = this.account(ctx, accId);
    const c = TG_CATEGORIES[i];
    if (!acc || !c) return this.accounts(ctx);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: acc.id }, select: { tgPrefs: true } });
    const prefs = tgPrefsOf(u.tgPrefs);
    await this.prisma.user.update({ where: { id: acc.id }, data: { tgPrefs: { ...prefs, [c]: !prefs[c] } } });
    return this.prefs(ctx, acc.id);
  }

  private async unlink(ctx: Ctx, accId: string) {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    // Only this chat's link: the condition keeps a link made meanwhile from another chat.
    await this.prisma.user.updateMany({ where: { id: acc.id, tgChatId: String(ctx.chatId) }, data: UNLINK });
    this.audit(ctx, acc.id, 'unlinked from the bot');
    const rest = ctx.accounts.filter((a) => a.id !== acc.id);
    return this.show(ctx, {
      html: `🔕 Магазин @${h(acc.username)} отключён: уведомления о нём больше не придут, менять его вещи отсюда нельзя.\n\nПодключить снова — в настройках на сайте.`,
      keyboard: this.rows(rest.length > 0 && [this.btn(ctx, '☰ Другие магазины', 'm')]),
    });
  }

  private async askSearch(ctx: Ctx, accId: string) {
    const acc = this.account(ctx, accId);
    if (!acc) return this.accounts(ctx);
    await this.setSlot(ctx.chatId, { k: 'search', acc: acc.id });
    await tg('sendMessage', {
      chat_id: ctx.chatId,
      text: '🔎 Пришлите часть названия вещи — например <code>куртка</code>.\n<i>Отмена: /cancel</i>',
      parse_mode: 'HTML',
      reply_markup: { force_reply: true, input_field_placeholder: 'Название вещи' },
    });
  }

  // ---------- entry points (telegram.ts) ----------

  /**
   * A verified button (callbacks.ts) from a chat with linked accounts. Returns false for data this service doesn't
   * own. The shapes are matched whole: ids must be UUIDs, numbers small integers.
   */
  async button(ctx: Ctx, data: string): Promise<boolean> {
    // «+» = open in a new message: buttons under a notification leave the notification itself as it was.
    if (data.startsWith('+')) {
      ctx = { ...ctx, messageId: undefined, hasPhoto: false };
      data = data.slice(1);
    }
    const U = UUID;
    let m: RegExpExecArray | null;
    if (data === 'm') return this.accounts(ctx).then(() => true);
    if (data === 'x') return true;
    if ((m = new RegExp(`^m:(${U})$`).exec(data))) return this.menu(ctx, m[1]).then(() => true);
    if ((m = new RegExp(`^l:(${U}):([ahds]):(\\d{1,4})$`).exec(data))) return this.list(ctx, m[1], m[2] as Filter, Number(m[3])).then(() => true);
    if ((m = new RegExp(`^([qtnfk]):(${U})$`).exec(data))) {
      const [, op, acc] = m;
      if (!this.account(ctx, acc)) return this.accounts(ctx).then(() => true);
      if (op === 'q') await this.pending(ctx, acc);
      else if (op === 't') await this.stats(ctx, acc);
      else if (op === 'n') await this.prefs(ctx, acc);
      else if (op === 'f') await this.askSearch(ctx, acc);
      else {
        const a = this.account(ctx, acc)!;
        await this.show(ctx, {
          html: `Отключить магазин @${h(a.username)} от этого Telegram?\n\nУведомления о нём перестанут приходить, а менять его вещи через бота станет нельзя.`,
          keyboard: this.rows([this.btn(ctx, 'Да, отключить', `K:${acc}`)], [this.btn(ctx, '← Нет, назад', `n:${acc}`)]),
        });
      }
      return true;
    }
    if ((m = new RegExp(`^K:(${U})$`).exec(data))) return this.unlink(ctx, m[1]).then(() => true);
    if ((m = new RegExp(`^N:(${U}):(\\d)$`).exec(data))) return this.togglePref(ctx, m[1], Number(m[2])).then(() => true);
    if ((m = new RegExp(`^([rw]):(${U})$`).exec(data))) return this.deal(ctx, m[1] as 'r' | 'w', m[2]).then(() => true);
    if ((m = new RegExp(`^P:(${U}):(\\d{1,6})$`).exec(data))) return this.setPrice(ctx, m[1], Number(m[2])).then(() => true);
    if ((m = new RegExp(`^y:(${U}):(\\d{1,2})$`).exec(data))) return this.confirmSize(ctx, m[1], Number(m[2])).then(() => true);
    if ((m = new RegExp(`^Y:(${U}):(\\d{1,2}):([0-9a-f]{6})$`).exec(data))) return this.removeSize(ctx, m[1], Number(m[2]), m[3]).then(() => true);
    if (!(m = new RegExp(`^([vpbhHsSuoz]):(${U})$`).exec(data))) return false;

    const [, op, id] = m;
    switch (op) {
      case 'v':
        await this.item(ctx, id);
        break;
      case 'p':
        await this.askPrice(ctx, id);
        break;
      case 'b':
        await this.act(ctx, id, 'bump', (s) => this.listings.bump(s, id), '⏫ Подняли в ленте');
        break;
      case 'h':
        await this.confirm(ctx, id, (t) => `Снять ${t} с продажи?\n\nЕё не будет в ленте и поиске, ожидающие предложения цены отменятся. Вернуть можно в любой момент.`, '🙈 Да, снять', `H:${id}`);
        break;
      case 'H':
        await this.act(ctx, id, 'hide', (s) => this.listings.hide(s, id), '🙈 Снята с продажи');
        break;
      case 's':
        await this.confirm(ctx, id, (t) => `Отметить ${t} проданной вне ichiba?\n\nОжидающие запросы и предложения будут отклонены. <b>Это нельзя отменить.</b>`, '✅ Да, продано', `S:${id}`);
        break;
      case 'S':
        await this.act(ctx, id, 'sold', (s) => this.listings.markSold(s, id), '✅ Отмечена проданной');
        break;
      case 'u':
        await this.act(ctx, id, 'publish', (s) => this.listings.publish(s, id), '🟢 Вещь в продаже');
        break;
      case 'o':
        await this.toggleOffers(ctx, id);
        break;
      case 'z':
        await this.sizes(ctx, id);
        break;
    }
    return true;
  }

  /** A typed message while the bot waits for something (a price, a search). False: nothing was awaited. */
  async typed(ctx: Ctx, text: string): Promise<boolean> {
    const slot = await this.takeSlot(ctx.chatId);
    if (!slot) return false;
    if (slot.k === 'search') {
      const q = text.trim().slice(0, 60);
      if (q.length < 2) {
        await this.show(ctx, { html: 'Нужно хотя бы две буквы названия.', keyboard: this.rows([this.btn(ctx, '🔎 Искать снова', `f:${slot.acc}`)]) });
        return true;
      }
      await this.list(ctx, slot.acc, 'a', 0, q);
      return true;
    }
    const price = parsePrice(text);
    if (price == null) {
      await this.setSlot(ctx.chatId, slot);
      await tg('sendMessage', { chat_id: ctx.chatId, text: `Не понял цену. Пришлите целое число от 1 до ${MAX_PRICE.toLocaleString('ru-RU')}, например <code>95</code>. Отмена: /cancel`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
      return true;
    }
    await this.confirmPrice(ctx, slot.lid, price);
    return true;
  }
}
