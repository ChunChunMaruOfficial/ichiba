import { createHmac, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../auth/auth.guard.js';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { background } from '../../common/background.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.js';
import { botToken, tgAs, type TgMessage, type TgUpdate } from '../bot-api.js';
import { verified } from '../callbacks.js';
import { allowlisted, LOCKOUT_MS, lockedOutFor, MAX_FAILS, sessionMs, stateOf, unlocked, type TgAdminState } from './access.js';
import { AdminApi, AdminApiError, type Admin } from './api.js';
import type { Ctx, Routes } from './ctx.js';
import { Panel } from './panel.js';
import { ROUTES } from './routes.js';
import { notifyRoutes } from './notify.js';
import { AdminStore, type ChatState } from './store.js';
import { ask, go, h, type Go, type Result } from './ui.js';

interface Account extends Admin {
  passwordHash: string | null;
  tgAdmin: unknown;
}

const dedicated = () => !!process.env.TELEGRAM_ADMIN_BOT_TOKEN;
const token = () => process.env.TELEGRAM_ADMIN_BOT_TOKEN || botToken();
const webhookSecret = () => createHmac('sha256', process.env.JWT_SECRET ?? '').update('telegram-admin-webhook').digest('hex').slice(0, 48);
const webhookUrl = () =>
  process.env.TELEGRAM_ADMIN_WEBHOOK_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/telegram/admin-webhook` : null);

/**
 * The admin panel in Telegram. Runs in its own bot when TELEGRAM_ADMIN_BOT_TOKEN is set, otherwise inside the
 * notification bot behind /admin. Who gets in, checked on every single update:
 *  1. a private chat, written by the Telegram account itself;
 *  2. that Telegram is linked (settings → Telegram) to an account with role ADMIN, not blocked or deleted — read
 *     from the database each time, so a role taken away closes the bot at once;
 *  3. optional TELEGRAM_ADMIN_IDS allowlist;
 *  4. the account's password typed in the bot (deleted from the chat at once), good for TELEGRAM_ADMIN_SESSION_HOURS
 *     and only while the account's sessionVersion is the same (a password reset or a block ends it); five wrong
 *     passwords lock the bot for 15 minutes; every unlock and failure goes to the moderation log.
 * Then every action is a request to the server's own /admin API (api.ts) with the same guards as the site.
 */
@Injectable()
export class AdminBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AdminBot');
  readonly store: AdminStore;
  readonly panel: Panel;
  private readonly api: AdminApi;
  private readonly routes: Routes;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    redis: RedisService,
    jwt: JwtService,
  ) {
    this.store = new AdminStore(redis);
    this.api = new AdminApi(jwt);
    this.panel = new Panel((m, p) => this.call(m, p), this.store);
    this.routes = { ...ROUTES, ...notifyRoutes(prisma) };
  }

  get enabled() {
    return !!token();
  }
  get dedicated() {
    return dedicated();
  }

  call(method: string, params: Record<string, unknown>) {
    return tgAs(token(), method, params);
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    background(this.connect(), 'admin bot setup');
  }
  onModuleDestroy() {
    this.polling = false;
  }

  private async connect() {
    const commands = [
      { command: 'admin', description: 'Админка' },
      { command: 'lock', description: 'Закрыть админку' },
    ];
    if (dedicated()) {
      await this.call('setMyCommands', { commands });
      const url = webhookUrl();
      if (url) {
        await this.call('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'] });
        this.logger.log(`admin bot webhook: ${url}`);
      } else if (process.env.TELEGRAM_ADMIN_POLLING === 'true') {
        await this.call('deleteWebhook', {});
        this.polling = true;
        void this.poll();
      }
      return;
    }
    // Inside the notification bot: /admin shows up only in admins' chats, everybody else keeps the usual menu.
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', tgChatId: { not: null }, blockedAt: null, deletedAt: null }, select: { tgChatId: true } });
    for (const a of admins) {
      await this.call('setMyCommands', {
        scope: { type: 'chat', chat_id: a.tgChatId },
        commands: [...commands, { command: 'status', description: 'Какой аккаунт подключён' }, { command: 'stop', description: 'Отключить уведомления' }],
      }).catch(() => undefined);
    }
  }

  private async poll() {
    let offset = 0;
    while (this.polling) {
      try {
        const updates = (await tgAs(token(), 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35_000)) as TgUpdate[];
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

  /** For the notification bot: is this update the admin panel's? (Never when the panel has a bot of its own.) */
  async wants(u: TgUpdate) {
    if (dedicated()) return false;
    const q = u.callback_query;
    if (q?.message && verified(q.message.chat.id, q.data)?.startsWith('ad:')) return true;
    const m = u.message;
    if (!m?.text || m.chat.type !== 'private') return false;
    const text = m.text.trim();
    // Of commands, only its own: /start <token> (linking), /menu and the rest stay with the shop bot.
    if (text.startsWith('/')) return /^\/(admin|lock)(@\w+)?$/.test(text) && !!(await this.account(m.from?.id));
    return !!(await this.store.state(String(m.chat.id))).ask;
  }

  /** The chat went on with the shop bot: a question the admin panel was waiting on no longer catches its text. */
  async forget(chatId: number | string) {
    const s = await this.store.state(String(chatId));
    if (s.ask) await this.store.saveState(String(chatId), { ...s, ask: undefined });
  }

  private async account(tgUserId: number | undefined): Promise<Account | null> {
    if (!tgUserId || !allowlisted(tgUserId)) return null;
    const u = await this.prisma.user.findFirst({
      where: { tgChatId: String(tgUserId), role: 'ADMIN', blockedAt: null, deletedAt: null },
      select: { id: true, username: true, sessionVersion: true, tgSessionVersion: true, passwordHash: true, tgAdmin: true },
    });
    // A link made before the account's last password reset / block / «выйти везде» is void (notifier.ts linkedAccounts).
    if (!u || u.tgSessionVersion !== u.sessionVersion) return null;
    const { tgSessionVersion: _, ...rest } = u;
    return { ...rest, role: 'ADMIN' };
  }

  private saveTg(userId: string, s: TgAdminState) {
    return this.prisma.user.update({ where: { id: userId }, data: { tgAdmin: s as object } });
  }
  private audit(userId: string, action: string, reason: string | null = null) {
    return this.prisma.moderationAction.create({ data: { moderatorId: userId, targetType: 'USER', targetId: userId, action, reason } }).catch(() => undefined);
  }

  // ---------- updates ----------

  /** The dedicated bot's own replay guard and rate limit (in the shared bot, TelegramBotService does both). */
  async handleOnce(u: TgUpdate) {
    const from = u.message?.from?.id ?? u.callback_query?.from.id ?? 0;
    const minute = Math.floor(Date.now() / 60_000);
    const fresh = await this.store.once(`upd:${u.update_id}`, 24 * 3600);
    const n = await this.store.count(`rate:${from}:${minute}`, 70);
    if (!fresh || n > 40) return;
    return this.handle(u);
  }

  async handle(u: TgUpdate) {
    try {
      const cq = u.callback_query;
      const m = u.message;
      const from = cq?.from ?? m?.from;
      const chat = cq?.message?.chat ?? m?.chat;
      if (!from || !chat) return;
      // Only a private chat, written by the account itself — never a group, a channel or a forwarded button.
      if (chat.type !== 'private' || chat.id !== from.id) {
        if (cq) await this.call('answerCallbackQuery', { callback_query_id: cq.id });
        return;
      }
      const chatId = String(chat.id);
      const account = await this.account(from.id);
      if (!account) {
        await this.store.saveState(chatId, {});
        if (cq) await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Нет доступа', show_alert: true });
        else if (dedicated()) await this.call('sendMessage', { chat_id: chatId, text: 'Этот бот только для администраторов ichiba.' });
        return;
      }
      const state = await this.store.state(chatId);
      if (cq) await this.onButton(account, chatId, cq, state);
      else if (m) await this.onMessage(account, chatId, m, state);
    } catch (e) {
      this.logger.warn(`update ${u.update_id}: ${(e as Error).message}`);
    }
  }

  private lockAsk() {
    return ask(
      '🔐 <b>Админка ichiba</b>\n\nВведите пароль администратора — тот же, что для входа в админку на сайте. Сообщение с паролем сразу удалится из чата.',
      go('unlock'),
      go('unlock'),
      { secret: true },
    );
  }

  private async onMessage(account: Account, chatId: string, m: TgMessage, state: ChatState) {
    const text = (m.text ?? '').trim();
    const pending = state.ask;
    // Whatever was typed into the panel goes from the chat: passwords at once, answers once they are read.
    if (pending || /^\/(admin|lock|start)/.test(text)) await this.call('deleteMessage', { chat_id: chatId, message_id: m.message_id }).catch(() => undefined);
    const s = stateOf(account.tgAdmin);

    if (/^\/lock(@\w+)?$/.test(text)) return this.lock(account, chatId, state, true);
    if (pending?.then.r === 'unlock' && !text.startsWith('/')) return this.unlock(account, chatId, text, state);
    if (!unlocked(s, account.sessionVersion)) return this.present(account, chatId, this.lockAsk(), { ...state, ask: undefined }, { fresh: !pending });
    if (pending && !text.startsWith('/')) {
      if (!text) return this.present(account, chatId, { kind: 'ask', ...pending }, state, { note: '⚠️ Нужен текст.\n\n' });
      const then: Go = { r: pending.then.r, p: { ...pending.then.p, input: text.slice(0, 6000) } };
      return this.present(account, chatId, await this.run(account, then, { ...pending, kind: 'ask' }), { ...state, ask: undefined });
    }
    // /admin, /start or anything else: a fresh panel at the bottom of the chat.
    return this.present(account, chatId, await this.run(account, go('home')), { ...state, ask: undefined }, { fresh: true });
  }

  private async onButton(account: Account, chatId: string, cq: NonNullable<TgUpdate['callback_query']>, state: ChatState) {
    const answer = (text = '', alert = false) => this.call('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190), show_alert: alert }).catch(() => undefined);
    const panelState: ChatState = { ...state, panel: cq.message?.message_id ?? state.panel, ask: undefined };
    const s = stateOf(account.tgAdmin);
    if (!unlocked(s, account.sessionVersion)) {
      await answer('Админка закрыта — введите пароль');
      return this.present(account, chatId, this.lockAsk(), panelState);
    }
    const route = await this.store.route(chatId, verified(chatId, cq.data) ?? '');
    if (!route) {
      await answer('Кнопка устарела — открываю меню');
      return this.present(account, chatId, await this.run(account, go('home')), panelState);
    }
    if (route.r === 'lock') {
      await answer('🔒 Админка закрыта');
      return this.lock(account, chatId, panelState, false);
    }
    const result = await this.run(account, route);
    if (result.kind === 'toast' && result.error) return answer(result.text, true);
    if (result.kind === 'toast') await answer(result.text, result.alert);
    else await answer();
    return this.present(account, chatId, result, panelState, { skipToast: true });
  }

  // ---------- password ----------

  private async unlock(account: Account, chatId: string, password: string, state: ChatState) {
    const s = stateOf(account.tgAdmin);
    const lock = this.lockAsk();
    const wait = lockedOutFor(s);
    if (wait) return this.present(account, chatId, lock, state, { note: `⛔️ Слишком много неверных паролей. Попробуйте через ${Math.ceil(wait / 60_000)} мин.\n\n` });
    if (!account.passwordHash) return this.present(account, chatId, lock, state, { note: '⚠️ У аккаунта нет пароля. Задайте его на сайте: вход в админку → «Забыли пароль?».\n\n' });
    const ok = password.length > 0 && password.length <= 200 && (await bcrypt.compare(password, account.passwordHash));
    if (!ok) {
      const n = (s.failed?.n ?? 0) + 1;
      const locked = n >= MAX_FAILS;
      await this.saveTg(account.id, { ...s, failed: locked ? { n: 0, until: new Date(Date.now() + LOCKOUT_MS).toISOString() } : { n, until: null } });
      await this.audit(account.id, 'tg_admin_unlock_failed', locked ? 'пять попыток подряд — пауза 15 минут' : `попытка ${n}`);
      this.logger.warn(`wrong admin password in the Telegram bot for @${account.username} (${locked ? 'locked for 15 min' : `attempt ${n}`})`);
      const note = locked ? '⛔️ Пять неверных паролей подряд — админка в боте закрыта на 15 минут.\n\n' : `⚠️ Неверный пароль. Осталось попыток: ${MAX_FAILS - n}.\n\n`;
      return this.present(account, chatId, lock, state, { note });
    }
    const until = new Date(Date.now() + sessionMs());
    await this.saveTg(account.id, { ...s, session: { until: until.toISOString(), sv: account.sessionVersion }, failed: null });
    await this.audit(account.id, 'tg_admin_unlock');
    const note = `🔓 Админка открыта до ${until.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit' })}.\n\n`;
    return this.present(account, chatId, await this.run(account, go('home')), { ...state, ask: undefined }, { note });
  }

  private async lock(account: Account, chatId: string, state: ChatState, fresh: boolean) {
    await this.saveTg(account.id, { ...stateOf(account.tgAdmin), session: null });
    return this.present(account, chatId, this.lockAsk(), state, { note: '🔒 Админка закрыта.\n\n', fresh });
  }

  // ---------- routes ----------

  private async run(account: Account, route: Go, retry?: Extract<Result, { kind: 'ask' }>): Promise<Result> {
    const handler = this.routes[route.r];
    if (!handler) return { kind: 'toast', text: 'Неизвестная команда', error: true, then: go('home') };
    const admin: Admin = { id: account.id, username: account.username, role: 'ADMIN', sessionVersion: account.sessionVersion };
    const ctx: Ctx = { admin, api: (method, path, body) => this.api.call(admin, method, path, body), p: route.p ?? {} };
    try {
      return await handler(ctx);
    } catch (e) {
      if (!(e instanceof AdminApiError)) this.logger.warn(`route ${route.r}: ${(e as Error).message}`);
      const msg = e instanceof AdminApiError ? e.message : 'Что-то пошло не так — попробуйте ещё раз';
      // A typed answer the API refused: the same question again, with the reason.
      if (retry) return { ...retry, text: `⚠️ ${h(msg)}\n\n${retry.text}` };
      return { kind: 'toast', text: `⚠️ ${msg}`, error: true };
    }
  }

  /** Draws a result: toasts become a line on top of the next screen (when there is no button to answer). */
  private async present(account: Account, chatId: string, result: Result, state: ChatState, opts: { note?: string; fresh?: boolean; skipToast?: boolean } = {}) {
    let note = opts.note ?? '';
    let r = result;
    let skip = !!opts.skipToast;
    for (let hops = 0; r.kind === 'toast' && hops < 4; hops++) {
      if (!skip && r.text) note += `${h(r.text)}\n\n`;
      skip = false;
      r = r.then ? await this.run(account, r.then) : { kind: 'screen', text: '', rows: [[{ text: '🏠 Меню', go: go('home') }]] };
    }
    if (r.kind === 'toast') r = { kind: 'screen', text: h(r.text), rows: [[{ text: '🏠 Меню', go: go('home') }]] };
    const next: ChatState = { ...state, ask: undefined };
    let screenToShow;
    if (r.kind === 'ask') {
      next.ask = { then: r.then, back: r.back, secret: r.secret, text: r.text, skip: r.skip };
      screenToShow = this.panel.askScreen(r, note);
      note = '';
    } else screenToShow = r;
    next.panel = await this.panel.show(chatId, screenToShow, state, { note, fresh: opts.fresh });
    await this.store.saveState(chatId, next);
    const shown = (this.shown.get(chatId) ?? 0) + 1;
    this.shown.set(chatId, shown);
    if (r.kind !== 'ask' && r.expireMs) this.expire(chatId, next.panel, shown, r.expireMs);
  }

  /** Screens drawn per chat on this instance: an expiring screen is replaced only if nothing was drawn after it. */
  private readonly shown = new Map<string, number>();

  private expire(chatId: string, messageId: number, shown: number, ms: number) {
    setTimeout(() => {
      if (this.shown.get(chatId) !== shown) return;
      void this.call('editMessageText', { chat_id: chatId, message_id: messageId, text: '🔒 Скрыто — данные показываются один раз.', reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    }, ms).unref();
  }
}

/** Updates of the dedicated admin bot (TELEGRAM_ADMIN_BOT_TOKEN). Always 200; a wrong secret is ignored. */
@Controller('telegram')
export class AdminBotController {
  constructor(private readonly bot: AdminBotService) {}

  @Public()
  @SkipThrottle()
  @Post('admin-webhook')
  @HttpCode(200)
  webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: TgUpdate) {
    if (!this.bot.dedicated || !this.bot.secretOk(secret)) return { ok: false };
    background(this.bot.handleOnce(update), 'admin bot update');
    return { ok: true };
  }
}
