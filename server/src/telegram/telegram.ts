import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Delete, Headers, HttpCode, HttpException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional, Patch, Post, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { esc as h } from '../mail/templates.js';
import { background } from '../common/background.js';
import { ZodPipe } from '../common/zod.js';
import { EventsService } from '../events/events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OffersService } from '../offers/offers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { RequestsService } from '../requests/requests.service.js';
import { botEnabled, botUsername, type Keyboard, tg, type TgMessage, type TgUpdate } from './bot-api.js';
import { signed, verified } from './callbacks.js';
import { AdminBotService } from './admin/admin-bot.js';
import { linkButton, linkedAccounts, notificationKeyboard, TelegramNotifier, UNLINK } from './notifier.js';
import { type Ctx, TelegramShopService } from './shop.js';
import { TG_CATEGORIES, tgPrefsOf } from './texts.js';

/** A «Подключить» link works this long; the settings page asks for a fresh one after that. */
const LINK_TTL_MS = 15 * 60_000;
/** Updates one Telegram user may send a minute; the rest are dropped (a stuck client, a script, a flood). */
const RATE_PER_MIN = 40;
/** Buttons sent before they were signed: only these two shapes are still taken unsigned (and authorised as before). */
const LEGACY = /^(rq|of):([adDb]):([0-9a-f-]{36})$/;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Where Telegram delivers updates: TELEGRAM_WEBHOOK_URL, or this service's own public Railway domain. Null on a
 * laptop — there the bot polls only with TELEGRAM_POLLING=true, since polling switches the shared bot's webhook off.
 */
const webhookUrl = () =>
  process.env.TELEGRAM_WEBHOOK_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/telegram/webhook` : null);
/** Telegram sends this back in a header on every update, so nobody else can post fake ones. Derived, no extra secret. */
const webhookSecret = () => createHmac('sha256', process.env.JWT_SECRET ?? '').update('telegram-webhook').digest('hex').slice(0, 48);

const WELCOME = [
  'Здесь можно управлять магазином: /menu — вещи, цены, «снять с продажи», «продано», статистика.',
  '',
  'Сюда будут приходить:',
  '🛍 запросы на покупку — принимайте прямо здесь',
  '💬 предложения цены',
  '🔨 ставки на аукционах',
  '✉️ новые сообщения в чате',
  '⭐ отзывы и статусы сделок',
  '♡ кто-то сохранил вещь или положил в корзину (анонимно)',
  '🌙 вечерняя сводка за день',
  '',
  '<i>Что присылать — /settings здесь или в настройках на сайте. Отключить: /stop</i>',
].join('\n');

/** The notification bot: links a chat to an account, answers buttons under notifications, and keeps the webhook set. */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TelegramBot');
  private polling = false;
  /** Rate limit and replay guard when Redis is not configured (one instance). */
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: TelegramNotifier,
    private readonly events: EventsService,
    private readonly requests: RequestsService,
    private readonly offers: OffersService,
    private readonly shop: TelegramShopService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly admin?: AdminBotService,
  ) {}

  onApplicationBootstrap() {
    if (!botEnabled()) return;
    background(this.connect(), 'telegram setup');
  }

  onModuleDestroy() {
    this.polling = false;
  }

  private async connect() {
    await tg('setMyCommands', {
      commands: [
        { command: 'menu', description: 'Мой магазин' },
        { command: 'items', description: 'Вещи в продаже' },
        { command: 'deals', description: 'Ждут ответа' },
        { command: 'stats', description: 'Статистика за неделю' },
        { command: 'settings', description: 'Какие уведомления присылать' },
        { command: 'cancel', description: 'Отменить ввод' },
        { command: 'status', description: 'Какой аккаунт подключён' },
        { command: 'stop', description: 'Отключить бота от всех аккаунтов' },
      ],
    });
    const url = webhookUrl();
    if (url) {
      await tg('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
      this.logger.log(`webhook: ${url}`);
    } else if (process.env.TELEGRAM_POLLING === 'true') {
      await tg('deleteWebhook');
      this.logger.warn('polling for updates (TELEGRAM_POLLING): the deployed bot gets nothing until it sets its webhook again');
      this.polling = true;
      void this.poll();
    } else {
      this.logger.log('no public URL for the webhook: the bot sends but does not hear replies (set TELEGRAM_WEBHOOK_URL or TELEGRAM_POLLING=true)');
    }
  }

  private async poll() {
    let offset = 0;
    while (this.polling) {
      try {
        const updates = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'my_chat_member'] }, 35_000);
        for (const u of updates) {
          offset = u.update_id + 1;
          await this.handle(u);
        }
      } catch (e) {
        this.logger.warn(`poll: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  secretOk(header: string | undefined) {
    const want = Buffer.from(webhookSecret());
    const got = Buffer.from(header ?? '');
    return got.length === want.length && timingSafeEqual(got, want);
  }

  /** A one-time deep link: t.me/<bot>?start=<token>. Only a hash of the token is stored. */
  async link(userId: string) {
    if (!botEnabled()) throw new ServiceUnavailableException({ message: 'Telegram-бот ещё не настроен' });
    const token = randomBytes(18).toString('base64url');
    await this.prisma.user.update({ where: { id: userId }, data: { tgLinkTokenHash: hashToken(token), tgLinkTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS) } });
    return { url: `https://t.me/${botUsername()}?start=${token}`, expiresAt: new Date(Date.now() + LINK_TTL_MS) };
  }

  async unlink(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: UNLINK });
    await this.events.emit(userId, { type: 'counters', data: {} });
  }

  async test(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, tgChatId: true, sessionVersion: true, tgSessionVersion: true } });
    if (!u.tgChatId || u.tgSessionVersion !== u.sessionVersion) throw new HttpException({ message: 'Telegram не подключён' }, 409);
    const sent = await this.notifier.send(
      u.tgChatId,
      `🔔 <b>Проверка связи</b>\n\nВсё работает: уведомления аккаунта @${u.username} приходят сюда.`,
      [linkButton('Настройки уведомлений', '/settings#telegram')].filter((r) => r.length),
    );
    if (!sent) throw new HttpException({ message: 'Telegram не принял сообщение — подключите бота заново' }, 409);
    return { ok: true };
  }

  // ---------- updates ----------

  /**
   * True the first time a key is seen within `seconds`. Guards against Telegram re-delivering an update (it retries
   * when an answer is slow) and counts the rate limit. Redis when there is one, else this instance's memory.
   */
  private async fresh(key: string, seconds: number) {
    if (this.redis.client) {
      try {
        return (await this.redis.client.set(`ichiba:tg:${key}`, '1', 'EX', seconds, 'NX')) === 'OK';
      } catch {
        // Redis down: memory.
      }
    }
    const now = Date.now();
    if ((this.seen.get(key) ?? 0) > now) return false;
    if (this.seen.size > 20_000) this.seen.clear();
    this.seen.set(key, now + seconds * 1000);
    return true;
  }

  private async withinRate(fromId: number) {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `ichiba:tg:rate:${fromId}:${minute}`;
    if (this.redis.client) {
      try {
        const n = await this.redis.client.incr(key);
        if (n === 1) await this.redis.client.expire(key, 70);
        return n <= RATE_PER_MIN;
      } catch {
        // Redis down: memory.
      }
    }
    const n = (this.seen.get(key) ?? 0) + 1;
    if (this.seen.size > 20_000) this.seen.clear();
    this.seen.set(key, n);
    return n <= RATE_PER_MIN;
  }

  async handle(u: TgUpdate) {
    try {
      if (!(await this.fresh(`upd:${u.update_id}`, 24 * 3600))) return;
      const from = u.message?.from?.id ?? u.callback_query?.from.id;
      if (from && !(await this.withinRate(from))) {
        if (u.callback_query) await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'Слишком часто — подождите минуту', show_alert: false }).catch(() => undefined);
        return;
      }
      // The admin panel (/admin, its buttons, answers it is waiting for) when it has no bot of its own.
      if (this.admin && (await this.admin.wants(u))) return await this.admin.handle(u);
      if (from && this.admin?.enabled && !this.admin.dedicated && (u.callback_query || u.message?.text?.startsWith('/'))) await this.admin.forget(from);
      if (u.message?.text) await this.onText(u.message);
      else if (u.callback_query) await this.onButton(u.callback_query);
      else if (u.my_chat_member && u.my_chat_member.new_chat_member.status === 'kicked') await this.notifier.unlinkChat(String(u.my_chat_member.chat.id));
    } catch (e) {
      this.logger.warn(`update ${u.update_id}: ${(e as Error).message}`);
    }
  }

  private reply(chatId: number, html: string, keyboard: Keyboard = []) {
    return tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  }

  private settingsButton(): Keyboard {
    const b = linkButton('⚙️ Настройки уведомлений', '/settings#telegram');
    return b.length ? [b] : [];
  }

  private async onText(m: TgMessage) {
    const chatId = String(m.chat.id);
    const text = (m.text ?? '').trim();
    const [rawCommand, arg] = text.split(/\s+/, 2);
    // «/menu@Ichiba_auth_bot» from the command list is the same command.
    const command = rawCommand.startsWith('/') ? rawCommand.split('@')[0].toLowerCase() : '';
    if (m.chat.type !== 'private' || m.from?.id !== m.chat.id) {
      if (command === '/start') await this.reply(m.chat.id, 'Бот ichiba работает только в личном чате.');
      return;
    }
    if (command === '/start' && arg) return this.claim(m, arg);
    if (command === '/stop') {
      await this.shop.clearSlot(m.chat.id);
      const { count } = await this.notifier.unlinkChat(chatId);
      return this.reply(m.chat.id, count ? '🔕 Бот отключён от всех аккаунтов: уведомлений не будет, управлять вещами отсюда нельзя. Подключить снова можно в настройках на сайте.' : 'Этот чат не подключён ни к одному аккаунту ichiba.', this.settingsButton());
    }
    const accounts = await linkedAccounts(this.prisma, chatId);
    if (!accounts.length) {
      return this.reply(
        m.chat.id,
        '🏮 <b>Бот магазинов ichiba</b>\n\nПрисылает запросы на покупку, предложения цены, ставки и сообщения из чата, а ещё даёт управлять вещами: менять цену, снимать с продажи, отмечать проданными.\n\nЧтобы подключить: <b>Настройки → Telegram → «Подключить Telegram»</b> на сайте.',
        this.settingsButton(),
      );
    }
    const ctx: Ctx = { chatId: m.chat.id, accounts };
    if (command === '/cancel') {
      await this.shop.clearSlot(m.chat.id);
      return this.reply(m.chat.id, 'Отменено.', [[{ text: '☰ Меню', callback_data: signed(m.chat.id, 'm') }]]);
    }
    if (command) await this.shop.clearSlot(m.chat.id);
    const one = accounts.length === 1 ? accounts[0].id : null;
    if (command === '/status') {
      return this.reply(m.chat.id, `🏮 <b>Подключено:</b> ${accounts.map((a) => `@${a.username}`).join(', ')}\n\n${WELCOME}`, this.settingsButton());
    }
    if (command === '/items' && one) return this.shop.list(ctx, one, 'a', 0);
    if (command === '/deals' && one) return this.shop.pending(ctx, one);
    if (command === '/stats' && one) return this.shop.stats(ctx, one);
    if (command === '/settings' && one) return this.shop.prefs(ctx, one);
    if (command) return this.shop.accounts(ctx);
    if (await this.shop.typed(ctx, text)) return;
    return this.shop.accounts(ctx);
  }

  /** /start <token> from the settings button: this chat now gets that account's notifications and may manage it. */
  private async claim(m: TgMessage, token: string) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return this.reply(m.chat.id, '⌛ Ссылка устарела или уже использована. Нажмите «Подключить Telegram» в настройках ещё раз.', this.settingsButton());
    const chatId = String(m.chat.id);
    const user = await this.prisma.user.findFirst({
      where: { tgLinkTokenHash: hashToken(token), tgLinkTokenExpiresAt: { gt: new Date() }, deletedAt: null, blockedAt: null },
      select: { id: true, username: true, sessionVersion: true, tgChatId: true },
    });
    if (!user) return this.reply(m.chat.id, '⌛ Ссылка устарела или уже использована. Нажмите «Подключить Telegram» в настройках ещё раз.', this.settingsButton());
    // One use: the token is cleared in the same conditional write, so two taps (or two people) can't both claim it.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, tgLinkTokenHash: hashToken(token) },
      data: { tgChatId: chatId, tgUsername: m.from?.username ?? null, tgLinkedAt: new Date(), tgSessionVersion: user.sessionVersion, tgLinkTokenHash: null, tgLinkTokenExpiresAt: null },
    });
    if (!count) return this.reply(m.chat.id, '⌛ Ссылка уже использована. Нажмите «Подключить Telegram» в настройках ещё раз.', this.settingsButton());
    // The chat it was linked to before hears that it no longer is.
    if (user.tgChatId && user.tgChatId !== chatId) {
      await this.notifier.send(user.tgChatId, `🔌 Аккаунт @${h(user.username)} подключён к другому Telegram — уведомления о нём сюда больше не придут.`);
    }
    // A trace on the site (🔔): if this wasn't the owner, they see it and can unlink.
    await this.notifications.notify(user.id, 'telegram_linked', { tgUsername: m.from?.username ?? null });
    // The settings page is waiting for this: it refreshes the session and shows «Подключено».
    await this.events.emit(user.id, { type: 'counters', data: {} });
    this.logger.log(`account ${user.id} linked to a chat`);
    return this.reply(m.chat.id, `🏮 <b>Готово! Аккаунт @${h(user.username)} подключён</b>\n\n${WELCOME}`, [[{ text: '☰ Открыть магазин', callback_data: signed(m.chat.id, `+m:${user.id}`) }], ...this.settingsButton()]);
  }

  private async onButton(q: NonNullable<TgUpdate['callback_query']>) {
    const answer = (text = '', alert = false) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert }).catch(() => undefined);
    if (!q.message || q.message.chat.type !== 'private' || q.message.chat.id !== q.from.id) return answer();
    const chatId = q.message.chat.id;
    const data = verified(chatId, q.data) ?? (LEGACY.test(q.data ?? '') ? q.data! : null);
    if (!data) return answer('Кнопка устарела — откройте /menu', true);
    if (data === 'done') return answer();

    const accounts = await linkedAccounts(this.prisma, String(chatId));
    if (!accounts.length) return answer('Этот Telegram не подключён к магазину. Подключите его в настройках на сайте.', true);
    const ctx: Ctx = { chatId, messageId: q.message.message_id, hasPhoto: !!q.message.photo?.length, accounts };
    try {
      const deal = LEGACY.exec(data);
      if (deal) await this.onDeal(q, ctx, deal[1] as 'rq' | 'of', deal[2], deal[3], answer);
      else if (await this.shop.button(ctx, data)) await answer();
      else await answer('Кнопка устарела — откройте /menu', true);
    } catch (e) {
      this.logger.warn(`button ${data.split(':')[0]}: ${(e as Error).message}`);
      await answer(e instanceof HttpException ? 'Не получилось — попробуйте на сайте' : 'Что-то пошло не так — попробуйте ещё раз', true);
    }
  }

  /**
   * «Принять / Отклонить» under a buy request or an offer. Declining asks once more; the account is the one this chat
   * is linked to that owns the deal, and the services check the rest exactly as for the buttons on the site.
   */
  private async onDeal(
    q: NonNullable<TgUpdate['callback_query']>,
    ctx: Ctx,
    kind: 'rq' | 'of',
    step: string,
    id: string,
    answer: (text?: string, alert?: boolean) => Promise<unknown>,
  ) {
    const setKeyboard = (keyboard: Keyboard) =>
      tg('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.messageId, reply_markup: { inline_keyboard: keyboard } }).catch(() => undefined);
    const target =
      kind === 'rq'
        ? await this.prisma.buyRequest.findUnique({ where: { id }, select: { sellerId: true } }).then((r) => (r ? { ids: [r.sellerId], listingId: null } : null))
        : await this.prisma.offer.findUnique({ where: { id }, select: { sellerId: true, buyerId: true, listingId: true } }).then((o) => (o ? { ids: [o.sellerId, o.buyerId], listingId: o.listingId } : null));
    const actor = ctx.accounts.find((u) => target?.ids.includes(u.id));
    if (!actor) return answer('Этот Telegram не подключён к аккаунту, которому адресовано уведомление', true);

    const sign = (data: string) => signed(ctx.chatId, data);
    const original = kind === 'rq' ? notificationKeyboard('request_new', { requestId: id }, ctx.chatId) : notificationKeyboard('offer_new', { offerId: id, listingId: target!.listingId }, ctx.chatId);
    const what = kind === 'rq' ? 'запрос' : 'предложение';
    if (step === 'd') {
      await setKeyboard([[{ text: `Да, отклонить ${what}`, callback_data: sign(`${kind}:D:${id}`) }], [{ text: '← Назад', callback_data: sign(`${kind}:b:${id}`) }]]);
      return answer();
    }
    if (step === 'b') {
      await setKeyboard(original);
      return answer();
    }

    const dealLink = (requestId?: string) => linkButton('Открыть сделку', requestId ? `/deals/${requestId}` : kind === 'rq' ? `/deals/${id}` : '/sales');
    const done = { text: '', callback_data: sign('done') };
    try {
      if (step === 'a') {
        const requestId = kind === 'rq' ? (await this.requests.accept(actor.id, id), id) : (await this.offers.accept(actor.id, id)).requestId;
        this.logger.log(`chat ${ctx.chatId} account ${actor.id}: accepted ${what} ${id}`);
        await setKeyboard([[{ ...done, text: kind === 'rq' ? '✅ Запрос принят' : '✅ Предложение принято' }], dealLink(requestId)].filter((r) => r.length));
        return answer(kind === 'rq' ? 'Принято! Договоритесь с покупателем о передаче' : 'Принято! Сделка открыта');
      }
      if (kind === 'rq') await this.requests.decline(actor.id, id, null);
      else await this.offers.decline(actor.id, id);
      this.logger.log(`chat ${ctx.chatId} account ${actor.id}: declined ${what} ${id}`);
      await setKeyboard([[{ ...done, text: kind === 'rq' ? '✖️ Запрос отклонён' : '✖️ Предложение отклонено' }]]);
      return answer('Отклонено');
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      const body = e.getResponse() as { message?: string } | string;
      // Already answered on the site, expired, or no longer allowed: the buttons go, a link to the deal stays.
      const open = linkButton('Открыть на ichiba', kind === 'rq' ? `/deals/${id}` : '/sales');
      await setKeyboard(open.length ? [open] : []);
      return answer(typeof body === 'string' ? body : (body.message ?? 'Не получилось'), true);
    }
  }
}

const PrefsDto = z.object(Object.fromEntries(TG_CATEGORIES.map((c) => [c, z.boolean().optional()])) as Record<(typeof TG_CATEGORIES)[number], z.ZodOptional<z.ZodBoolean>>);

@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly prisma: PrismaService,
  ) {}

  /** Updates from Telegram. Always 200 (a refusal makes Telegram retry); the work runs after the answer. */
  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: TgUpdate) {
    if (!this.bot.secretOk(secret)) return { ok: false };
    background(this.bot.handle(update), 'telegram update');
    return { ok: true };
  }

  @Post('link')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  link(@CurrentUser() user: AuthUser) {
    return this.bot.link(user.id);
  }

  @Delete('link')
  async unlink(@CurrentUser() user: AuthUser) {
    await this.bot.unlink(user.id);
    return { ok: true };
  }

  @Patch('prefs')
  async prefs(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PrefsDto)) dto: z.infer<typeof PrefsDto>) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { tgPrefs: true } });
    const prefs = { ...tgPrefsOf(u.tgPrefs), ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) };
    await this.prisma.user.update({ where: { id: user.id }, data: { tgPrefs: prefs } });
    return prefs;
  }

  @Post('test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  test(@CurrentUser() user: AuthUser) {
    return this.bot.test(user.id);
  }
}
