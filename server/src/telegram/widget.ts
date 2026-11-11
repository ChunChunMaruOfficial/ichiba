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
import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
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
import { siteLink } from './widget-notice.js';
import { loadWidgetCtx, packState, saveWidgetCtx, type WCtx } from './widget-store.js';

type Account = Awaited<ReturnType<typeof linkedAccounts>>[number];
export type WidgetState = Record<string, unknown> & { s?: string };

export interface WidgetQuery {
  id: string;
  from: { id: number; username?: string };
  chat?: { id: number; type: string };
  message_id?: number;
  data?: string;
}


const PAGE = 6;
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

export { packState };

/** A command from the widget, matched whole (anything else is ignored). */
export interface Command {
  op: string;
  f: string;
  n: number;
}

export function parseCommand(data: string | undefined): Command | null {
  const d = data ?? '';
  let m: RegExpExecArray | null;
  if (/^([hdtnxbEHUSBO]|na|nx)$/.test(d)) return { op: d, f: '', n: 0 };
  if ((m = /^l:([ahds]):(\d{1,4})$/.exec(d))) return { op: 'l', f: m[1], n: Number(m[2]) };
  if ((m = /^(o|Z|da|dx|nt|xa|ba|bx):(\d{1,2})$/.exec(d))) return { op: m[1], f: '', n: Number(m[2]) };
  if ((m = /^P:(\d{1,6})$/.exec(d))) return { op: 'P', f: '', n: Number(m[1]) };
  return null;
}

@Injectable()
export class TelegramWidgetService {
  private readonly logger = new Logger('TelegramWidget');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly listings: ListingsService,
    private readonly requests: RequestsService,
    private readonly offers: OffersService,
    private readonly shop: TelegramShopService,
    @Optional() private readonly auth?: AuthService,
  ) {}

  // ---------- per-message memory (widget-store.ts) ----------

  private load(chatId: number, messageId: number) {
    return loadWidgetCtx(this.redis, chatId, messageId);
  }

  private save(chatId: number, messageId: number, ctx: WCtx) {
    return saveWidgetCtx(this.redis, chatId, messageId, ctx);
  }

  // ---------- sending ----------

  /**
   * /menu (and every «Открыть магазин»): a new widget message with the first screen — or straight at one of the
   * shop's items. False when Telegram refused it (old API, etc.), so the caller can fall back to the classic menu.
   */
  async open(chatId: number, accounts: Account[], opts: { item?: string; screen?: 'l' | 'd' | 'b' | 't' | 'n' } = {}): Promise<boolean> {
    const owner = opts.item ? (await this.prisma.listing.findUnique({ where: { id: opts.item }, select: { sellerId: true } }))?.sellerId : null;
    const ctx: WCtx = owner && accounts.some((a) => a.id === owner) ? { acc: owner } : accounts.length === 1 ? { acc: accounts[0].id } : {};
    const screens = { l: () => this.list(accounts, ctx, 'a', 0), d: () => this.deals(accounts, ctx), b: () => this.buys(accounts, ctx), t: () => this.stats(accounts, ctx), n: () => this.nots(accounts, ctx) };
    const state = !ctx.acc
      ? this.pick(accounts)
      : owner === ctx.acc && opts.item
        ? await this.item(accounts, ctx, opts.item)
        : opts.screen
          ? await screens[opts.screen]()
          : await this.home(accounts, ctx);
    const name = ctx.acc ? this.username(accounts, ctx) : null;
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
    const ctx = await this.load(chatId, messageId);
    // A card (cards.ts): its few commands work for a Telegram not linked yet too (sign-up from the bot).
    if (ctx.card) return this.answerCard(q, ctx, chatId, messageId);
    const accounts = await linkedAccounts(this.prisma, String(chatId));
    if (!accounts.length) return answer({ e: 'Этот Telegram не подключён к магазину. Подключите его на сайте: Настройки → Telegram.' });

    // A deal card (notifier.ts) answers its own request or offer, nothing else.
    if (ctx.notice) return this.answerNotice(q, ctx, accounts, chatId, messageId);
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
      case 'b':
        return this.buys(accounts, ctx);
      case 'ba':
      case 'bx': {
        // A counter-offer from a seller to this account as a buyer.
        const id = ctx.buys?.[c.n];
        const o = id ? await this.prisma.offer.findUnique({ where: { id }, select: { buyerId: true } }) : null;
        if (!id || !o || o.buyerId !== acc) return this.buys(accounts, ctx);
        if (c.op === 'ba') await this.offers.accept(acc, id);
        else await this.offers.decline(acc, id);
        audit(c.op === 'ba' ? 'accepted counter-offer' : 'declined counter-offer', id);
        return { ...(await this.buys(accounts, ctx)), t: c.op === 'ba' ? '✅ Принято — сделка открыта, продавец свяжется' : '✖️ Отклонено' };
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
        // The typed price of the old menu: the card's stepper does it now.
        return this.item(accounts, ctx, id);
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
    // A buyer without a single item of their own: «Покупки» is their home.
    if (!counts.length && !requests && !offers) return this.buys(accounts, ctx);
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

  /**
   * A tap in a card: «✨ Мой магазин» (W) and «Открыть вещь» (Wv) send the shop menu as a new message; «Подключить»
   * (RL) and «Создать аккаунт» (RC) sign the person up or link the account they already have — both only for the
   * Telegram account that tapped, which Telegram itself vouches for. A done card stops asking.
   */
  private async answerCard(q: WidgetQuery, ctx: WCtx, chatId: number, messageId: number) {
    const card = ctx.card!;
    const shown: Record<string, unknown> = { ...(card.ns ?? {}) };
    const cmd = q.data ?? '';
    const accounts = await linkedAccounts(this.prisma, String(chatId));
    if (cmd === 'W' || cmd === 'Wv') {
      if (accounts.length) await this.open(chatId, accounts, cmd === 'Wv' && card.item ? { item: card.item } : {});
      else shown.d = 'Сначала подключите аккаунт ichiba';
    } else if ((cmd === 'RL' || cmd === 'RC') && !shown.d) {
      shown.d = accounts.length ? '✅ Этот Telegram уже подключён' : await this.signUp(chatId, q.from, cmd === 'RC');
      shown.c = [];
      ctx.card = { ...card, ns: shown };
      await this.save(chatId, messageId, ctx);
      const linked = await linkedAccounts(this.prisma, String(chatId));
      if (linked.length) await this.open(chatId, linked);
    }
    const packed = packState(shown);
    await tg('editMessageWidgetData', { chat_id: chatId, message_id: messageId, chat_data: packed }).catch(() => undefined);
    await tg('answerWidgetQuery', { widget_query_id: q.id, data: packed }).catch(() => undefined);
  }

  /** Links the account with this Telegram id (signed up through Telegram before), or creates one when asked to. */
  private async signUp(chatId: number, from: WidgetQuery['from'], create: boolean): Promise<string> {
    let user = await this.prisma.user.findFirst({ where: { telegramId: String(from.id), deletedAt: null }, select: { id: true, username: true, blockedAt: true } });
    if (user?.blockedAt) return '⚠️ Аккаунт заблокирован — напишите в поддержку';
    let isNew = false;
    if (!user) {
      if (!create || !this.auth) return '⚠️ Аккаунт не найден — создайте новый';
      const made = await this.auth.signupFromTelegram(String(from.id), from.username ?? '');
      user = { id: made.user.id, username: made.user.username, blockedAt: made.user.blockedAt };
      isNew = made.isNew;
    }
    const { sessionVersion } = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { tgChatId: String(chatId), tgUsername: from.username ?? null, tgLinkedAt: new Date(), tgSessionVersion: sessionVersion },
    });
    this.logger.log(`account ${user.id} ${isNew ? 'signed up and linked' : 'linked'} from the bot`);
    return isNew ? `🎉 Аккаунт @${user.username} создан и подключён` : `✅ Аккаунт @${user.username} подключён`;
  }

  /** «Покупки»: counter-offers from sellers to answer first, then purchases on their way. */
  private async buys(accounts: Account[], ctx: WCtx): Promise<WidgetState> {
    const acc = ctx.acc!;
    const [counters, purchases] = await Promise.all([
      this.prisma.offer.findMany({
        where: { buyerId: acc, status: 'PENDING', from: 'SELLER' },
        orderBy: { createdAt: 'asc' },
        take: 3,
        select: { id: true, amount: true, listing: { select: { title: true } } },
      }),
      this.prisma.buyRequest.findMany({
        where: { buyerId: acc, status: { in: Object.keys(BUY_STATUS) as Array<keyof typeof BUY_STATUS> } },
        orderBy: { updatedAt: 'desc' },
        take: 4,
        select: { status: true, priceTotal: true, items: { select: { listing: { select: { title: true } } }, take: 1 } },
      }),
    ]);
    Object.assign(ctx, { buys: counters.map((o) => o.id), item: undefined });
    return {
      s: 'b',
      u: this.username(accounts, ctx),
      i: [
        ...counters.map((o, k) => ['c', short(o.listing.title, 26), o.amount, 'Продавец предлагает свою цену', k]),
        ...purchases.map((r) => ['p', short(r.items[0]?.listing.title ?? '', 26), r.priceTotal, BUY_STATUS[r.status as keyof typeof BUY_STATUS] ?? '', 0]),
      ],
    };
  }

  /**
   * A tap in a deal card: «na» accepts, «nx» declines the one request or offer the card was sent about, as the
   * account of this chat that is a party to it; the services decide whether it is still that side's turn.
   */
  private async answerNotice(q: WidgetQuery, ctx: WCtx, accounts: Account[], chatId: number, messageId: number) {
    const notice = ctx.notice!;
    const shown = { ...(notice.ns ?? {}) };
    const c = parseCommand(q.data);
    if (!shown.d && c && (c.op === 'na' || c.op === 'nx')) {
      const parties =
        notice.k === 'r'
          ? await this.prisma.buyRequest.findUnique({ where: { id: notice.id }, select: { sellerId: true } }).then((r) => (r ? [r.sellerId] : []))
          : await this.prisma.offer.findUnique({ where: { id: notice.id }, select: { sellerId: true, buyerId: true } }).then((o) => (o ? [o.sellerId, o.buyerId] : []));
      const actor = accounts.find((a) => parties.includes(a.id));
      if (!actor) shown.d = '⚠️ Этот Telegram не подключён к аккаунту, которому адресовано предложение';
      else {
        try {
          if (c.op === 'na') {
            const requestId = notice.k === 'r' ? (await this.requests.accept(actor.id, notice.id), notice.id) : (await this.offers.accept(actor.id, notice.id)).requestId;
            shown.d = notice.k === 'r' ? '✅ Принято — договоритесь с покупателем о передаче' : '✅ Принято — сделка открыта';
            if (requestId) shown.u = siteLink(`/deals/${requestId}`) ?? shown.u;
          } else {
            if (notice.k === 'r') await this.requests.decline(actor.id, notice.id, null);
            else await this.offers.decline(actor.id, notice.id);
            shown.d = '✖️ Отклонено';
          }
          this.logger.log(`chat ${chatId} account ${actor.id}: ${c.op === 'na' ? 'accepted' : 'declined'} ${notice.k} ${notice.id} (card)`);
        } catch (e) {
          const why = refusal(e);
          if (why == null) throw e;
          // Already answered on the site, expired, not this side's turn: the card says so and stops asking.
          shown.d = `⚠️ ${why}`;
        }
      }
      shown.a = 0;
      ctx.notice = { ...notice, ns: shown };
      await this.save(chatId, messageId, ctx);
    }
    const packed = packState(shown);
    await tg('editMessageWidgetData', { chat_id: chatId, message_id: messageId, chat_data: packed }).catch(() => undefined);
    await tg('answerWidgetQuery', { widget_query_id: q.id, data: packed }).catch(() => undefined);
  }
}

/** What a buyer reads about a purchase on its way. */
const BUY_STATUS = {
  PENDING_SELLER: 'Ждём ответа продавца',
  ACCEPTED: 'Продавец подтвердил',
  WAITING_PAYMENT: 'Ожидает оплаты',
  WAITING_HANDOVER: 'Договоритесь о передаче',
  HANDED_OVER: 'Передано — подтвердите получение',
  IN_TRANSIT: 'В пути',
  DISPUTED: 'Открыт спор',
} as const;

/** True when a refusal is the services' own (a message for the seller), not a crash. */
export const isRefusal = (e: unknown) => e instanceof HttpException;
