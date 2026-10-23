import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Delete, Headers, HttpCode, HttpException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Patch, Post, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { background } from '../common/background.js';
import { ZodPipe } from '../common/zod.js';
import { EventsService } from '../events/events.js';
import { OffersService } from '../offers/offers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestsService } from '../requests/requests.service.js';
import { botEnabled, botUsername, type Keyboard, tg, type TgMessage, type TgUpdate } from './bot-api.js';
import { linkButton, notificationKeyboard, TelegramNotifier } from './notifier.js';
import { TG_CATEGORIES, tgPrefsOf } from './texts.js';

/** A «Подключить» link works this long; the settings page asks for a fresh one after that. */
const LINK_TTL_MS = 30 * 60_000;
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
  'Сюда будут приходить:',
  '🛍 запросы на покупку — принимайте прямо здесь',
  '💬 предложения цены',
  '🔨 ставки на аукционах',
  '✉️ новые сообщения в чате',
  '⭐ отзывы и статусы сделок',
  '',
  '<i>Что присылать — настраивается на сайте. Отключить: /stop</i>',
].join('\n');

/** The notification bot: links a chat to an account, answers buttons under notifications, and keeps the webhook set. */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TelegramBot');
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: TelegramNotifier,
    private readonly events: EventsService,
    private readonly requests: RequestsService,
    private readonly offers: OffersService,
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
        { command: 'status', description: 'Какой аккаунт подключён' },
        { command: 'stop', description: 'Отключить уведомления' },
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
    await this.prisma.user.update({ where: { id: userId }, data: { tgChatId: null, tgUsername: null, tgLinkedAt: null } });
    await this.events.emit(userId, { type: 'counters', data: {} });
  }

  async test(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, tgChatId: true } });
    if (!u.tgChatId) throw new HttpException({ message: 'Telegram не подключён' }, 409);
    const sent = await this.notifier.send(
      u.tgChatId,
      `🔔 <b>Проверка связи</b>\n\nВсё работает: уведомления аккаунта @${u.username} приходят сюда.`,
      [linkButton('Настройки уведомлений', '/settings#telegram')].filter((r) => r.length),
    );
    if (!sent) throw new HttpException({ message: 'Telegram не принял сообщение — подключите бота заново' }, 409);
    return { ok: true };
  }

  // ---------- updates ----------

  async handle(u: TgUpdate) {
    try {
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
    const [command, arg] = (m.text ?? '').trim().split(/\s+/, 2);
    if (m.chat.type !== 'private') {
      if (command.startsWith('/start')) await this.reply(m.chat.id, 'Уведомления ichiba приходят только в личный чат с ботом.');
      return;
    }
    if (command === '/start' && arg) return this.claim(m, arg);
    if (command === '/stop') {
      const { count } = await this.notifier.unlinkChat(chatId);
      return this.reply(m.chat.id, count ? '🔕 Уведомления отключены. Подключить снова можно в настройках на сайте.' : 'Этот чат не подключён ни к одному аккаунту ichiba.', this.settingsButton());
    }
    const accounts = await this.prisma.user.findMany({ where: { tgChatId: chatId, deletedAt: null }, select: { username: true } });
    if (accounts.length) {
      return this.reply(m.chat.id, `🏮 <b>Подключено:</b> ${accounts.map((a) => `@${a.username}`).join(', ')}\n\n${WELCOME}`, this.settingsButton());
    }
    return this.reply(
      m.chat.id,
      '🏮 <b>Бот уведомлений ichiba</b>\n\nПрисылает запросы на покупку, предложения цены, ставки и сообщения из чата — и даёт ответить на них в один тап.\n\nЧтобы подключить: <b>Настройки → Telegram → «Подключить Telegram»</b> на сайте.',
      this.settingsButton(),
    );
  }

  /** /start <token> from the settings button: this chat now gets that account's notifications. */
  private async claim(m: TgMessage, token: string) {
    const user = await this.prisma.user.findFirst({
      where: { tgLinkTokenHash: hashToken(token), tgLinkTokenExpiresAt: { gt: new Date() }, deletedAt: null, blockedAt: null },
      select: { id: true, username: true },
    });
    if (!user) return this.reply(m.chat.id, '⌛ Ссылка устарела или уже использована. Нажмите «Подключить Telegram» в настройках ещё раз.', this.settingsButton());
    await this.prisma.user.update({
      where: { id: user.id },
      data: { tgChatId: String(m.chat.id), tgUsername: m.from?.username ?? null, tgLinkedAt: new Date(), tgLinkTokenHash: null, tgLinkTokenExpiresAt: null },
    });
    // The settings page is waiting for this: it refreshes the session and shows «Подключено».
    await this.events.emit(user.id, { type: 'counters', data: {} });
    this.logger.log(`account ${user.id} linked to a chat`);
    return this.reply(m.chat.id, `🏮 <b>Готово! Аккаунт @${user.username} подключён</b>\n\n${WELCOME}`, this.settingsButton());
  }

  /**
   * «Принять / Отклонить» under a buy request or an offer. Declining asks once more; the account is the one this chat
   * is linked to that owns the deal, and the services check the rest exactly as for the buttons on the site.
   */
  private async onButton(q: NonNullable<TgUpdate['callback_query']>) {
    const answer = (text = '', alert = false) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert });
    const match = /^(rq|of):([adDb]):([0-9a-f-]{36})$/.exec(q.data ?? '');
    if (!match || !q.message) return answer();
    const [, kind, step, id] = match;
    const setKeyboard = (keyboard: Keyboard) =>
      tg('editMessageReplyMarkup', { chat_id: q.message!.chat.id, message_id: q.message!.message_id, reply_markup: { inline_keyboard: keyboard } }).catch(() => undefined);

    const linked = await this.prisma.user.findMany({ where: { tgChatId: String(q.from.id), deletedAt: null, blockedAt: null }, select: { id: true } });
    const target =
      kind === 'rq'
        ? await this.prisma.buyRequest.findUnique({ where: { id }, select: { sellerId: true } }).then((r) => (r ? { ids: [r.sellerId], listingId: null } : null))
        : await this.prisma.offer.findUnique({ where: { id }, select: { sellerId: true, buyerId: true, listingId: true } }).then((o) => (o ? { ids: [o.sellerId, o.buyerId], listingId: o.listingId } : null));
    const actor = linked.find((u) => target?.ids.includes(u.id));
    if (!actor) return answer('Этот Telegram не подключён к аккаунту, которому адресовано уведомление', true);

    const original = kind === 'rq' ? notificationKeyboard('request_new', { requestId: id }) : notificationKeyboard('offer_new', { offerId: id, listingId: target!.listingId });
    const what = kind === 'rq' ? 'запрос' : 'предложение';
    if (step === 'd') {
      await setKeyboard([[{ text: `Да, отклонить ${what}`, callback_data: `${kind}:D:${id}` }], [{ text: '← Назад', callback_data: `${kind}:b:${id}` }]]);
      return answer();
    }
    if (step === 'b') {
      await setKeyboard(original);
      return answer();
    }

    const dealLink = (requestId?: string) => linkButton('Открыть сделку', requestId ? `/deals/${requestId}` : kind === 'rq' ? `/deals/${id}` : '/sales');
    try {
      if (step === 'a') {
        const requestId = kind === 'rq' ? (await this.requests.accept(actor.id, id), id) : (await this.offers.accept(actor.id, id)).requestId;
        await setKeyboard([[{ text: kind === 'rq' ? '✅ Запрос принят' : '✅ Предложение принято', callback_data: 'done' }], dealLink(requestId)].filter((r) => r.length));
        return answer(kind === 'rq' ? 'Принято! Договоритесь с покупателем о передаче' : 'Принято! Сделка открыта');
      }
      if (kind === 'rq') await this.requests.decline(actor.id, id, null);
      else await this.offers.decline(actor.id, id);
      await setKeyboard([[{ text: kind === 'rq' ? '✖️ Запрос отклонён' : '✖️ Предложение отклонено', callback_data: 'done' }]]);
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
