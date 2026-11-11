/**
 * The shop as a widget message (Bot API 10.4): /menu sends WIDGET_HTML, every tap in it arrives as a widget_query
 * with a short command, and the answer is the next screen's state (also written to the message with
 * editMessageWidgetData, so it survives a reopened chat).
 *
 * Trust: the command text is user input. The acting accounts are the ones linked to the chat under their current
 * session version (linkedAccounts); the widget only ever names positions in lists the bot itself built for that
 * message (kept server-side per chat+message, never in the widget), so it can't name a foreign item, deal or shop;
 * and each action goes through ListingsService / RequestsService / OffersService with the same checks as the site.
 * Only private chats with the sender itself are served. Users' text goes into the state as data and the widget
 * escapes it into element text.
 */
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ListingsService } from '../listings/listings.service.js';
import { OffersService } from '../offers/offers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { RequestsService } from '../requests/requests.service.js';
import { nextBumpAt } from '../stats/stats.js';
import { tg } from './bot-api.js';
import { linkedAccounts } from './notifier.js';
import { refusal, TelegramShopService } from './shop.js';
import { TG_CATEGORIES, tgPrefsOf } from './texts.js';
import { WIDGET_HTML } from './widget-html.js';

type Account = Awaited<ReturnType<typeof linkedAccounts>>[number];
export type WidgetState = Record<string, unknown> & { s?: string };

export interface WidgetQuery {
  id: string;
  from: { id: number; username?: string };
  chat?: { id: number; type: string };
  message_id?: number;
  data?: string;
}

/** What the bot remembers about one widget message: the shop and the lists it showed, by position. */
interface WCtx {
  acc?: string;
  f?: string;
  p?: number;
  ids?: string[];
  item?: string;
  deals?: Array<['r' | 'o', string]>;
}

const PAGE = 6;
const CTX_TTL_S = 30 * 24 * 3600;
const MAX_STATE = 1024;
const MAX_PRICE = 100_000;
const FILTERS: Record<string, Array<'PUBLISHED' | 'RESERVED' | 'HIDDEN' | 'DRAFT' | 'SOLD'>> = {
  a: ['PUBLISHED', 'RESERVED'],
  h: ['HIDDEN'],
  d: ['DRAFT'],
  s: ['SOLD'],
};
const ST: Record<string, string> = { PUBLISHED: 'P', RESERVED: 'R', HIDDEN: 'H', DRAFT: 'D', SOLD: 'S', BLOCKED: 'B' };
const filterOf = (status: string) => (status === 'HIDDEN' ? 'h' : status === 'DRAFT' ? 'd' : status === 'SOLD' ? 's' : 'a');
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s) || 'Без названия';

/** The state as JSON within the 1024 bytes a widget takes: long titles are cut down until it fits. */
export function packState(state: WidgetState): string {
  let json = JSON.stringify(state);
  for (let n = 22; Buffer.byteLength(json) > MAX_STATE && n >= 6; n -= 4) {
    const cut = (v: unknown): unknown => (typeof v === 'string' && v.length > n ? `${v.slice(0, n - 1)}…` : Array.isArray(v) ? v.map(cut) : v);
    json = JSON.stringify({ ...state, i: cut(state.i), T: cut(state.T), z: cut(state.z) });
  }
  return Buffer.byteLength(json) > MAX_STATE ? JSON.stringify({ s: state.s, u: state.u, t: 'Слишком много данных — откройте на сайте' }) : json;
}

/** A command from the widget, matched whole (anything else is ignored). */
export interface Command {
  op: string;
  f: string;
  n: number;
}

export function parseCommand(data: string | undefined): Command | null {
  const d = data ?? '';
  let m: RegExpExecArray | null;
  if (/^[hdtnxEHUSBO]$/.test(d)) return { op: d, f: '', n: 0 };
  if ((m = /^l:([ahds]):(\d{1,4})$/.exec(d))) return { op: 'l', f: m[1], n: Number(m[2]) };
  if ((m = /^(o|Z|da|dx|nt|xa):(\d{1,2})$/.exec(d))) return { op: m[1], f: '', n: Number(m[2]) };
  if ((m = /^P:(\d{1,6})$/.exec(d))) return { op: 'P', f: '', n: Number(m[1]) };
  return null;
}

@Injectable()
export class TelegramWidgetService {
  private readonly logger = new Logger('TelegramWidget');
  private readonly mem = new Map<string, { v: WCtx; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly listings: ListingsService,
    private readonly requests: RequestsService,
    private readonly offers: OffersService,
    private readonly shop: TelegramShopService,
  ) {}

  // ---------- per-message memory ----------

  private key(chatId: number, messageId: number) {
    return `ichiba:tg:w:${chatId}:${messageId}`;
  }

  private async load(chatId: number, messageId: number): Promise<WCtx> {
    const k = this.key(chatId, messageId);
    if (this.redis.client) {
      try {
        const raw = await this.redis.client.get(k);
        return raw ? (JSON.parse(raw) as WCtx) : {};
      } catch {
        // Redis down: memory.
      }
    }
    const hit = this.mem.get(k);
    return hit && hit.until > Date.now() ? hit.v : {};
  }

  private async save(chatId: number, messageId: number, ctx: WCtx) {
    const k = this.key(chatId, messageId);
    if (this.redis.client) {
      try {
        await this.redis.client.set(k, JSON.stringify(ctx), 'EX', CTX_TTL_S);
        return;
      } catch {
        // Redis down: memory.
      }
    }
    if (this.mem.size > 5000) this.mem.clear();
    this.mem.set(k, { v: ctx, until: Date.now() + CTX_TTL_S * 1000 });
  }

  // ---------- sending ----------

  /** /menu: a new widget message with the shop's first screen. False when Telegram refused it (old API, etc.). */
  async open(chatId: number, accounts: Account[]): Promise<boolean> {
    const ctx: WCtx = accounts.length === 1 ? { acc: accounts[0].id } : {};
    const state = ctx.acc ? await this.home(accounts, ctx) : this.pick(accounts);
    const name = ctx.acc ? accounts[0].username : null;
    try {
      const msg = await tg<{ message_id: number }>('sendWidget', {
        chat_id: chatId,
        html: WIDGET_HTML,
        chat_data: packState(state),
        allow_queries: true,
        protect_content: true,
        caption: `🏮 Магазин${name ? ` @${name}` : ''} на ichiba\n\nНе видно карточку? Обновите Telegram — или откройте /list`,
      });
      await this.save(chatId, msg.message_id, ctx);
      return true;
    } catch (e) {
      this.logger.warn(`sendWidget: ${(e as Error).message}`);
      return false;
    }
  }

  // ---------- a tap ----------

  async query(q: WidgetQuery) {
    const answer = (state: WidgetState) => tg('answerWidgetQuery', { widget_query_id: q.id, data: packState(state) }).catch(() => undefined);
    const chatId = q.chat?.id;
    const messageId = q.message_id;
    if (!chatId || !messageId || q.chat?.type !== 'private' || chatId !== q.from.id) return answer({ e: 'Это меню работает только в личном чате с ботом' });
    const accounts = await linkedAccounts(this.prisma, String(chatId));
    if (!accounts.length) return answer({ e: 'Этот Telegram не подключён к магазину. Подключите его на сайте: Настройки → Telegram.' });

    const ctx = await this.load(chatId, messageId);
    if (ctx.acc && !accounts.some((a) => a.id === ctx.acc)) ctx.acc = undefined;
    if (!ctx.acc && accounts.length === 1) ctx.acc = accounts[0].id;

    let state: WidgetState;
    try {
      state = await this.run(q, ctx, accounts, chatId);
    } catch (e) {
      const why = refusal(e);
      if (why == null) {
        this.logger.warn(`widget ${q.data}: ${(e as Error).message}`);
        return answer({ s: 'h', u: this.username(accounts, ctx), t: 'Что-то пошло не так — попробуйте ещё раз' });
      }
      state = ctx.item ? await this.item(accounts, ctx, ctx.item) : await this.home(accounts, ctx);
      state.t = `⚠️ ${why}`;
    }
    await this.save(chatId, messageId, ctx);
    const packed = packState(state);
    await tg('editMessageWidgetData', { chat_id: chatId, message_id: messageId, chat_data: packed }).catch(() => undefined);
    await tg('answerWidgetQuery', { widget_query_id: q.id, data: packed }).catch(() => undefined);
  }

  private username(accounts: Account[], ctx: WCtx) {
    return accounts.find((a) => a.id === ctx.acc)?.username;
  }

  private async run(q: WidgetQuery, ctx: WCtx, accounts: Account[], chatId: number): Promise<WidgetState> {
    const c = parseCommand(q.data);
    if (!c) return this.home(accounts, ctx);
    if (c.op === 'x') return this.pick(accounts);
    if (c.op === 'xa') {
      const a = accounts[c.n];
      if (a) Object.assign(ctx, { acc: a.id, ids: undefined, item: undefined, deals: undefined });
      return a ? this.home(accounts, ctx) : this.pick(accounts);
    }
    if (!ctx.acc) return this.pick(accounts);
    const acc = ctx.acc;
    const audit = (what: string, id?: string) => this.logger.log(`chat ${chatId} account ${acc}: ${what}${id ? ` ${id}` : ''} (widget)`);

    switch (c.op) {
      case 'h':
        return this.home(accounts, ctx);
      case 'l':
        return this.list(accounts, ctx, c.f, c.n);
      case 'o': {
        const id = ctx.ids?.[c.n];
        return id ? this.item(accounts, ctx, id) : this.list(accounts, ctx, ctx.f ?? 'a', ctx.p ?? 0);
      }
      case 'd':
        return this.deals(accounts, ctx);
      case 'da':
      case 'dx': {
        const deal = ctx.deals?.[c.n];
        if (!deal) return this.deals(accounts, ctx);
        const [kind, id] = deal;
        const row = kind === 'r' ? await this.prisma.buyRequest.findUnique({ where: { id }, select: { sellerId: true } }) : await this.prisma.offer.findUnique({ where: { id }, select: { sellerId: true } });
        if (!row || row.sellerId !== acc) return this.deals(accounts, ctx);
        if (c.op === 'da') await (kind === 'r' ? this.requests.accept(acc, id) : this.offers.accept(acc, id));
        else await (kind === 'r' ? this.requests.decline(acc, id, null) : this.offers.decline(acc, id));
        audit(c.op === 'da' ? 'accepted' : 'declined', id);
        const next = await this.deals(accounts, ctx);
        return { ...next, t: c.op === 'da' ? '✅ Принято — договоритесь о передаче в «Сделках» на сайте' : '✖️ Отклонено' };
      }
      case 't':
        return this.stats(accounts, ctx);
      case 'n':
        return this.nots(accounts, ctx);
      case 'nt': {
        const cat = TG_CATEGORIES[c.n] as (typeof TG_CATEGORIES)[number] | undefined;
        if (cat) {
          const u = await this.prisma.user.findUniqueOrThrow({ where: { id: acc }, select: { tgPrefs: true } });
          const prefs = tgPrefsOf(u.tgPrefs);
          await this.prisma.user.update({ where: { id: acc }, data: { tgPrefs: { ...prefs, [cat]: !prefs[cat] } } });
        }
        return this.nots(accounts, ctx);
      }
    }
    return this.itemAction(c, ctx, accounts, chatId, audit);
  }

  /** Actions on the item this message has open: it must still be the current shop's own. */
  private async itemAction(c: Command, ctx: WCtx, accounts: Account[], chatId: number, audit: (what: string, id?: string) => void): Promise<WidgetState> {
    const id = ctx.item;
    const l = id ? await this.prisma.listing.findUnique({ where: { id }, select: { id: true, sellerId: true, status: true, priceNegotiable: true, acceptsOffers: true, sizes: true } }) : null;
    if (!id || !l || l.status === 'DELETED' || l.sellerId !== ctx.acc) return this.home(accounts, { ...ctx, item: undefined });
    const seller = l.sellerId;
    let done: string;
    switch (c.op) {
      case 'P': {
        const price = c.n;
        if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) return { ...(await this.item(accounts, ctx, id)), t: '⚠️ Такую цену поставить нельзя' };
        await this.listings.update(seller, id, { price, ...(l.priceNegotiable ? { priceNegotiable: false } : {}) });
        done = `✅ Цена: ${price.toLocaleString('ru-RU')} BYN`;
        break;
      }
      case 'E':
        await this.shop.askPrice({ chatId, accounts }, id);
        return { ...(await this.item(accounts, ctx, id)), t: '✎ Пришлите новую цену сообщением ниже' };
      case 'H':
        await this.listings.hide(seller, id);
        done = '🙈 Снята с продажи';
        break;
      case 'U':
        await this.listings.publish(seller, id);
        done = '🟢 В продаже';
        break;
      case 'S':
        await this.listings.markSold(seller, id);
        done = '✅ Отмечена проданной';
        break;
      case 'B':
        await this.listings.bump(seller, id);
        done = '⏫ Подняли в ленте';
        break;
      case 'O':
        await this.listings.update(seller, id, { acceptsOffers: !l.acceptsOffers });
        done = l.acceptsOffers ? 'Торг выключен' : '🤝 Торг включён';
        break;
      case 'Z': {
        const k = c.n;
        const size = l.sizes[k];
        if (!size || l.sizes.length < 2) return this.item(accounts, ctx, id);
        await this.listings.update(seller, id, { sizes: l.sizes.filter((_, j) => j !== k) });
        done = `Размер ${size} убран из наличия`;
        break;
      }
      default:
        return this.item(accounts, ctx, id);
    }
    audit(c.op, id);
    return { ...(await this.item(accounts, ctx, id)), t: done };
  }

  // ---------- screens ----------

  private pick(accounts: Account[]): WidgetState {
    return { s: 'x', a: accounts.map((a) => a.username) };
  }

  private async home(accounts: Account[], ctx: WCtx): Promise<WidgetState> {
    if (!ctx.acc) return this.pick(accounts);
    ctx.item = undefined;
    const acc = ctx.acc;
    const [counts, requests, offers] = await Promise.all([
      this.prisma.listing.groupBy({ by: ['status'], where: { sellerId: acc, status: { in: ['PUBLISHED', 'RESERVED', 'HIDDEN', 'DRAFT', 'SOLD'] } }, _count: true }),
      this.prisma.buyRequest.count({ where: { sellerId: acc, status: 'PENDING_SELLER' } }),
      this.prisma.offer.count({ where: { sellerId: acc, status: 'PENDING', from: 'BUYER' } }),
    ]);
    const n = (...st: string[]) => counts.filter((x) => st.includes(x.status)).reduce((a, x) => a + x._count, 0);
    return { s: 'h', u: this.username(accounts, ctx), n: [n('PUBLISHED', 'RESERVED'), n('HIDDEN'), n('DRAFT'), n('SOLD')], w: requests + offers, k: accounts.length > 1 ? 1 : 0 };
  }

  private async list(accounts: Account[], ctx: WCtx, f: string, page: number): Promise<WidgetState> {
    const where = { sellerId: ctx.acc!, status: { in: FILTERS[f] ?? FILTERS.a } };
    const total = await this.prisma.listing.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.min(Math.max(0, page), pages - 1);
    const rows = await this.prisma.listing.findMany({
      where,
      orderBy: f === 's' ? [{ soldAt: 'desc' }, { updatedAt: 'desc' }] : [{ updatedAt: 'desc' }],
      skip: p * PAGE,
      take: PAGE,
      select: { id: true, title: true, price: true, priceNegotiable: true, status: true },
    });
    Object.assign(ctx, { f, p, ids: rows.map((r) => r.id), item: undefined });
    return { s: 'l', u: this.username(accounts, ctx), f, p, P: pages, i: rows.map((r) => [short(r.title, 24), r.priceNegotiable ? null : r.price, ST[r.status] ?? '']) };
  }

  private async item(accounts: Account[], ctx: WCtx, id: string): Promise<WidgetState> {
    const l = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        sellerId: true,
        title: true,
        status: true,
        price: true,
        previousPrice: true,
        priceNegotiable: true,
        sizes: true,
        acceptsOffers: true,
        viewsCount: true,
        favoritesCount: true,
        publishedAt: true,
        lastBumpAt: true,
        hiddenByAdmin: true,
        saleType: true,
      },
    });
    if (!l || l.status === 'DELETED' || l.sellerId !== ctx.acc) return this.home(accounts, { ...ctx, item: undefined });
    ctx.item = id;
    const auction = await this.prisma.auction.findFirst({ where: { listingId: id, status: 'ACTIVE' }, select: { id: true } });
    const next = nextBumpAt(l);
    const bumpIn = next ? Math.max(0, Math.ceil((next.getTime() - Date.now()) / 3600_000)) : null;
    return {
      s: 'i',
      u: this.username(accounts, ctx),
      T: short(l.title, 60),
      c: l.priceNegotiable ? null : l.price,
      o: l.previousPrice,
      st: ST[l.status] ?? '',
      v: l.viewsCount,
      fv: l.favoritesCount,
      of: l.acceptsOffers ? 1 : 0,
      fx: l.saleType === 'FIXED' && !l.priceNegotiable && !auction ? 1 : 0,
      au: auction ? 1 : 0,
      ha: l.hiddenByAdmin ? 1 : 0,
      bu: bumpIn,
      z: l.sizes.length > 1 ? l.sizes.map((s) => short(s, 10)) : [],
      f: filterOf(l.status),
    };
  }

  private async deals(accounts: Account[], ctx: WCtx): Promise<WidgetState> {
    const acc = ctx.acc!;
    const [requests, offers] = await Promise.all([
      this.prisma.buyRequest.findMany({
        where: { sellerId: acc, status: 'PENDING_SELLER' },
        orderBy: { createdAt: 'asc' },
        take: 4,
        select: { id: true, priceTotal: true, buyer: { select: { username: true } }, items: { select: { listing: { select: { title: true } } }, take: 1 } },
      }),
      this.prisma.offer.findMany({
        where: { sellerId: acc, status: 'PENDING', from: 'BUYER' },
        orderBy: { createdAt: 'asc' },
        take: 4,
        select: { id: true, amount: true, buyer: { select: { username: true } }, listing: { select: { title: true } } },
      }),
    ]);
    const rows: Array<['r' | 'o', string, string, string, number]> = [
      ...requests.map((r): ['r', string, string, string, number] => ['r', r.id, short(r.buyer.username, 16), short(r.items[0]?.listing.title ?? '', 26), r.priceTotal]),
      ...offers.map((o): ['o', string, string, string, number] => ['o', o.id, short(o.buyer.username, 16), short(o.listing.title, 26), o.amount]),
    ];
    Object.assign(ctx, { deals: rows.map((r) => [r[0], r[1]]), item: undefined });
    return { s: 'd', u: this.username(accounts, ctx), w: rows.length, i: rows.map(([k, , buyer, title, amount]) => [k, buyer, title, amount]) };
  }

  private async stats(accounts: Account[], ctx: WCtx): Promise<WidgetState> {
    const DAY = 24 * 3600_000;
    const minsk = new Date(Date.now() + 3 * 3600_000);
    const today = Date.UTC(minsk.getUTCFullYear(), minsk.getUTCMonth(), minsk.getUTCDate());
    const from = new Date(today - 6 * DAY);
    const rows = await this.prisma.listingStat.findMany({
      where: { day: { gte: from }, listing: { sellerId: ctx.acc! } },
      select: { day: true, views: true, favorites: true, carts: true, chats: true, offers: true, requests: true },
    });
    const d = [0, 0, 0, 0, 0, 0, 0];
    const t = { v: 0, f: 0, c: 0, m: 0, o: 0, r: 0 };
    for (const r of rows) {
      const i = Math.round((r.day.getTime() - from.getTime()) / DAY);
      if (i >= 0 && i < 7) d[i] += r.views;
      t.v += r.views;
      t.f += r.favorites;
      t.c += r.carts;
      t.m += r.chats;
      t.o += r.offers;
      t.r += r.requests;
    }
    ctx.item = undefined;
    return { s: 't', u: this.username(accounts, ctx), d, ...t };
  }

  private async nots(accounts: Account[], ctx: WCtx): Promise<WidgetState> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.acc! }, select: { tgPrefs: true } });
    const prefs = tgPrefsOf(u.tgPrefs);
    ctx.item = undefined;
    return { s: 'n', u: this.username(accounts, ctx), q: TG_CATEGORIES.map((c) => (prefs[c] ? 1 : 0)) };
  }
}

/** True when a refusal is the services' own (a message for the seller), not a crash. */
export const isRefusal = (e: unknown) => e instanceof HttpException;
