import { createHmac, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../auth/auth.guard.js';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { background } from '../../common/background.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.js';
import { botToken, TelegramError, tgAs, type TgMessage, type TgUpdate, type TgUser } from '../bot-api.js';
import { verified } from '../callbacks.js';
import { ADMIN_COMMANDS, adminChatCommands } from '../profile.js';
import { allowlisted, ownerUsername, LOCKOUT_MS, lockedOutFor, MAX_FAILS, sessionMs, stateOf, unlocked, patchTgAdmin } from './access.js';
import { AdminApi, AdminApiError, type Admin } from './api.js';
import type { Ctx, Routes } from './ctx.js';
import { Panel } from './panel.js';
import { ROUTES } from './routes.js';
import { notifyRoutes } from './notify.js';
import { AdminStore, type ChatState } from './store.js';
import { ask, btn, go, h, type Go, type Result, type Screen } from './ui.js';
import { ADMIN_WIDGET_HTML } from './widget-html.js';
import { split, toModel } from './widget-model.js';

/** A tap in the panel widget (Bot API 10.4 `widget_query`); kept here so bot-api.ts stays the shop bot's. */
export interface WidgetQuery {
  id: string;
  from: TgUser;
  chat?: { id: number; type: string };
  message_id?: number;
  data?: string;
}
type Update = TgUpdate & { widget_query?: WidgetQuery };
type Mode = 'widget' | 'panel';
/** The interactive panel is the default; TELEGRAM_ADMIN_WIDGETS=false keeps the text one (a client without widgets). */
const widgetsOn = () => process.env.TELEGRAM_ADMIN_WIDGETS !== 'false';

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
    const commands = ADMIN_COMMANDS;
    if (dedicated()) {
      await this.call('setMyCommands', { commands });
      const url = webhookUrl();
      if (url) {
        await this.call('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query', 'widget_query'] });
        this.logger.log(`admin bot webhook: ${url}`);
      } else if (process.env.TELEGRAM_ADMIN_POLLING === 'true') {
        await this.call('deleteWebhook', {});
        this.polling = true;
        void this.poll();
      }
      return;
    }
    // Inside the notification bot: /admin shows up only in admins' chats, everybody else keeps the usual menu.
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', tgChatId: { not: null }, blockedAt: null, deletedAt: null }, select: { tgChatId: true, tgUsername: true } });
    // /admin is listed only where it opens: the owner's Telegram (access.ts ownerUsername).
    for (const a of admins.filter((x) => ownerUsername(x.tgUsername ?? undefined))) {
      await this.call('setMyCommands', {
        scope: { type: 'chat', chat_id: a.tgChatId },
        // This list replaces the default one in an admin's chat, so the shop commands stay in it (profile.ts).
        commands: adminChatCommands(),
      }).catch(() => undefined);
    }
  }

  private async poll() {
    let offset = 0;
    while (this.polling) {
      try {
        const updates = (await tgAs(token(), 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'widget_query'] }, 35_000)) as TgUpdate[];
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
    const w = (u as Update).widget_query;
    if (w) return this.ownsWidget(w);
    const q = u.callback_query;
    if (q?.message && verified(q.message.chat.id, q.data)?.startsWith('ad:')) return true;
    const m = u.message;
    if (!m?.text || m.chat.type !== 'private') return false;
    const text = m.text.trim();
    // Of commands, only its own: /start <token> (linking), /menu and the rest stay with the shop bot.
    if (text.startsWith('/')) return /^\/(admin|lock)(@\w+)?$/.test(text) && !!(await this.account(m.from));
    return !!(await this.store.state(String(m.chat.id))).ask;
  }

  /** The chat went on with the shop bot: a question the admin panel was waiting on no longer catches its text. */
  async forget(chatId: number | string, opts: { keepUnlock?: boolean } = {}) {
    const s = await this.store.state(String(chatId));
    if (!s.ask || (opts.keepUnlock && s.ask.then.r === 'unlock')) return;
    await this.store.saveState(String(chatId), { ...s, ask: undefined });
  }

  /** Set by the shared bot: when the panel asks for text, the shop's own pending input is dropped. */
  onAsk?: (chatId: string) => Promise<unknown>;

  private async account(from: { id: number; username?: string } | undefined): Promise<Account | null> {
    const tgUserId = from?.id;
    if (!tgUserId || !allowlisted(tgUserId) || !ownerUsername(from.username)) return null;
    const u = await this.prisma.user.findFirst({
      where: { tgChatId: String(tgUserId), role: 'ADMIN', blockedAt: null, deletedAt: null },
      select: { id: true, username: true, sessionVersion: true, tgSessionVersion: true, passwordHash: true, tgAdmin: true },
    });
    // A link made before the account's last password reset / block / «выйти везде» is void (notifier.ts linkedAccounts).
    if (!u || u.tgSessionVersion !== u.sessionVersion) return null;
    const { tgSessionVersion: _, ...rest } = u;
    return { ...rest, role: 'ADMIN' };
  }

  private saveTg(userId: string, key: 'session' | 'failed', value: unknown) {
    return patchTgAdmin(this.prisma, userId, key, value);
  }
  private audit(userId: string, action: string, reason: string | null = null) {
    return this.prisma.moderationAction.create({ data: { moderatorId: userId, targetType: 'USER', targetId: userId, action, reason } }).catch(() => undefined);
  }

  // ---------- updates ----------

  /** The dedicated bot's own replay guard and rate limit (in the shared bot, TelegramBotService does both). */
  async handleOnce(u: TgUpdate) {
    const from = u.message?.from?.id ?? u.callback_query?.from.id ?? (u as Update).widget_query?.from.id ?? 0;
    const minute = Math.floor(Date.now() / 60_000);
    const fresh = await this.store.once(`upd:${u.update_id}`, 24 * 3600);
    const n = await this.store.count(`rate:${from}:${minute}`, 70);
    if (!fresh || n > 40) return;
    return this.handle(u);
  }

  async handle(u: TgUpdate) {
    const w = (u as Update).widget_query;
    if (w) return this.handleWidget(w).catch((e: Error) => this.logger.warn(`widget ${w.id}: ${e.message}`));
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
      const account = await this.account(from);
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
    // /admin opens the interactive panel; a typed answer goes back to wherever its question came from.
    const mode: Mode = pending ? (pending.mode ?? 'panel') : widgetsOn() ? 'widget' : 'panel';

    if (/^\/lock(@\w+)?$/.test(text)) return this.lock(account, chatId, state, mode, true);
    if (pending?.then.r === 'unlock' && !text.startsWith('/')) return this.unlock(account, chatId, text, state, mode);
    if (!unlocked(s, account.sessionVersion, chatId)) return this.present(account, chatId, this.lockAsk(), { ...state, ask: undefined }, { fresh: !pending, mode });
    if (pending && !text.startsWith('/')) {
      if (!text) return this.present(account, chatId, { kind: 'ask', ...pending }, state, { note: '⚠️ Нужен текст.\n\n', mode });
      const then: Go = { r: pending.then.r, p: { ...pending.then.p, input: text.slice(0, 6000) } };
      return this.present(account, chatId, await this.run(account, then, { ...pending, kind: 'ask' }), { ...state, ask: undefined }, { mode, route: then });
    }
    // /admin, /start or anything else: a fresh panel at the bottom of the chat.
    return this.present(account, chatId, await this.run(account, go('home')), { ...state, ask: undefined }, { fresh: true, mode, route: go('home') });
  }

  private async onButton(account: Account, chatId: string, cq: NonNullable<TgUpdate['callback_query']>, state: ChatState) {
    const answer = (text = '', alert = false) => this.call('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190), show_alert: alert }).catch(() => undefined);
    // «Текстовая версия» sits under the widget: the text panel then opens below it, as a message of its own.
    const underWidget = !!state.widget && cq.message?.message_id === state.widget.mid;
    // «Отмена» / «Пропустить» under a widget-mode question: the answer goes back into the widget.
    const fromPrompt = !!state.prompt && cq.message?.message_id === state.prompt;
    const panelState: ChatState = { ...state, panel: underWidget ? state.panel : (cq.message?.message_id ?? state.panel), ask: undefined };
    const s = stateOf(account.tgAdmin);
    if (!unlocked(s, account.sessionVersion, chatId)) {
      await answer('Админка закрыта — введите пароль');
      return this.present(account, chatId, this.lockAsk(), panelState, { mode: 'panel' });
    }
    const route = await this.store.route(chatId, verified(chatId, cq.data) ?? '');
    if (!route) {
      await answer('Кнопка устарела — открываю меню');
      return this.present(account, chatId, await this.run(account, go('home')), panelState, { mode: 'panel' });
    }
    if (route.r === 'lock') {
      await answer('🔒 Админка закрыта');
      return this.lock(account, chatId, panelState, 'panel', false);
    }
    if (route.r === 'widget') {
      await answer();
      return this.present(account, chatId, await this.run(account, go('home')), panelState, { mode: 'widget', fresh: true, route: go('home') });
    }
    const target = route.r === 'classic' ? go('home') : route;
    const result = await this.run(account, target);
    if (result.kind === 'toast' && result.error) return answer(result.text, true);
    if (result.kind === 'toast') await answer(result.text, result.alert);
    else await answer();
    if (fromPrompt) return this.present(account, chatId, result, { ...state, ask: undefined }, { skipToast: true, mode: 'widget', route: target });
    return this.present(account, chatId, result, panelState, { skipToast: true, mode: 'panel', fresh: underWidget });
  }

  // ---------- the widget ----------

  /** Whether a widget query comes from the panel widget this bot drew in that chat (never decided by its data). */
  async ownsWidget(q: WidgetQuery) {
    if (!q.chat || q.chat.type !== 'private' || q.chat.id !== q.from.id || !q.message_id) return false;
    return (await this.store.state(String(q.chat.id))).widget?.mid === q.message_id;
  }

  /**
   * A tap in the widget: `b<rev>.<n>` a button of the screen drawn at revision rev, `r<rev>` refresh, `f<rev>` the
   * screen's full text as a message. Same gates as a button: owner, linked ADMIN account, unlocked in this chat.
   * Answered within the 15 seconds Telegram allows; the new screen arrives as the widget's data.
   */
  async handleWidget(q: WidgetQuery) {
    const answer = (o: Record<string, unknown>) => this.call('answerWidgetQuery', { widget_query_id: q.id, data: JSON.stringify(o) }).catch(() => undefined);
    if (!(await this.ownsWidget(q))) return answer({ e: 'Эта панель устарела — откройте /admin' });
    const chatId = String(q.chat!.id);
    const account = await this.account(q.from);
    if (!account) return answer({ e: 'Нет доступа' });
    const state = await this.store.state(chatId);
    const w = state.widget!;
    if (!unlocked(stateOf(account.tgAdmin), account.sessionVersion, chatId)) {
      await answer({ t: '🔐 Введите пароль в чат' });
      return this.present(account, chatId, this.lockAsk(), { ...state, ask: undefined }, { mode: 'widget' });
    }
    const m = /^([bfr])(\d{1,9})(?:\.(\d{1,3}))?$/.exec(q.data ?? '');
    if (!m) return answer({ e: 'Не понял кнопку' });
    if (Number(m[2]) !== w.rev) return answer({ e: 'Экран обновился — нажмите ещё раз' });
    if (m[1] === 'f') {
      const r = await this.run(account, w.last ?? go('home'));
      if (r.kind !== 'ask' && r.kind !== 'toast') await this.panel.notice(chatId, r.text, []);
      return answer({ t: '📄 Полный текст — сообщением ниже' });
    }
    const route = m[1] === 'r' ? (w.last ?? go('home')) : await this.store.route(chatId, `ad:${w.scr}:${Number(m[3] ?? -1)}`);
    if (!route) {
      await answer({ t: 'Кнопка устарела — открываю меню' });
      return this.present(account, chatId, await this.run(account, go('home')), state, { mode: 'widget', route: go('home') });
    }
    if (route.r === 'lock') {
      await answer({ t: '🔒 Админка закрыта' });
      return this.lock(account, chatId, state, 'widget', false);
    }
    if (route.r === 'classic') {
      await answer({ t: '📝 Текстовая версия — ниже' });
      return this.present(account, chatId, await this.run(account, go('home')), state, { mode: 'panel', fresh: true });
    }
    const result = await this.run(account, route);
    if (result.kind === 'toast' && result.error) return answer({ e: result.text });
    await answer(result.kind === 'ask' ? { t: '✍️ Ответьте сообщением в чат' } : { o: 1 });
    return this.present(account, chatId, result, state, { mode: 'widget', route });
  }

  /** Draws a screen into the widget (editing its data), or sends a new widget when there is none or `fresh`. */
  private async drawWidget(chatId: string, screen: Screen, note: string, state: ChatState, route: Go | undefined, fresh: boolean) {
    const rev = (state.widget?.rev ?? 0) + 1;
    const { model, routes } = toModel(screen, rev, note);
    const scr = routes.length ? await this.store.saveScreen(chatId, routes) : '';
    const [chatData, publicData] = split(model);
    const last = route ?? state.widget?.last;
    if (state.widget && !fresh) {
      try {
        await this.call('editMessageWidgetData', { chat_id: chatId, message_id: state.widget.mid, chat_data: chatData, public_data: publicData });
        return { mid: state.widget.mid, rev, scr, last };
      } catch (e) {
        if (e instanceof TelegramError && /not modified/i.test(e.description)) return { mid: state.widget.mid, rev, scr, last };
        // Deleted or too old: a new widget below.
      }
    }
    const sent = (await this.call('sendWidget', {
      chat_id: chatId,
      html: ADMIN_WIDGET_HTML,
      chat_data: chatData,
      public_data: publicData,
      allow_queries: true,
      protect_content: true,
      reply_markup: { inline_keyboard: await this.panel.keyboard(chatId, [[btn('📝 Текстовая версия', 'classic')]]) },
    })) as { message_id: number };
    if (state.widget && state.widget.mid !== sent.message_id) await this.call('deleteMessage', { chat_id: chatId, message_id: state.widget.mid }).catch(() => undefined);
    return { mid: sent.message_id, rev, scr, last };
  }

  // ---------- password ----------

  private async unlock(account: Account, chatId: string, password: string, state: ChatState, mode: Mode) {
    const s = stateOf(account.tgAdmin);
    const lock = this.lockAsk();
    const again = (note: string) => this.present(account, chatId, lock, state, { note, mode });
    const wait = lockedOutFor(s);
    if (wait) return again(`⛔️ Слишком много неверных паролей. Попробуйте через ${Math.ceil(wait / 60_000)} мин.\n\n`);
    if (!account.passwordHash) return again('⚠️ У аккаунта нет пароля. Задайте его на сайте: вход в админку → «Забыли пароль?».\n\n');
    // Counted before the check and atomically (Redis INCR): guesses sent in parallel each get their own number, so
    // the sixth one is refused unseen however many arrive at once. Reset only by a right password.
    const attempt = await this.store.count(`pwfail:${account.id}`, LOCKOUT_MS / 1000);
    if (attempt > MAX_FAILS) return again('⛔️ Слишком много неверных паролей. Попробуйте через 15 мин.\n\n');
    const ok = password.length > 0 && password.length <= 200 && (await bcrypt.compare(password, account.passwordHash));
    if (!ok) {
      const n = attempt;
      const locked = n >= MAX_FAILS;
      await this.saveTg(account.id, 'failed', locked ? { n: 0, until: new Date(Date.now() + LOCKOUT_MS).toISOString() } : { n, until: null });
      await this.audit(account.id, 'tg_admin_unlock_failed', locked ? 'пять попыток подряд — пауза 15 минут' : `попытка ${n}`);
      this.logger.warn(`wrong admin password in the Telegram bot for @${account.username} (${locked ? 'locked for 15 min' : `attempt ${n}`})`);
      return again(locked ? '⛔️ Пять неверных паролей подряд — админка в боте закрыта на 15 минут.\n\n' : `⚠️ Неверный пароль. Осталось попыток: ${MAX_FAILS - n}.\n\n`);
    }
    const until = new Date(Date.now() + sessionMs());
    await this.store.reset(`pwfail:${account.id}`);
    await this.saveTg(account.id, 'failed', null);
    await this.saveTg(account.id, 'session', { until: until.toISOString(), sv: account.sessionVersion, chat: chatId });
    await this.audit(account.id, 'tg_admin_unlock');
    const note = `🔓 Админка открыта до ${until.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit' })}.\n\n`;
    return this.present(account, chatId, await this.run(account, go('home')), { ...state, ask: undefined }, { note, mode, route: go('home') });
  }

  private async lock(account: Account, chatId: string, state: ChatState, mode: Mode, fresh: boolean) {
    await this.saveTg(account.id, 'session', null);
    return this.present(account, chatId, this.lockAsk(), state, { note: '🔒 Админка закрыта.\n\n', fresh, mode });
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

  /**
   * Draws a result: toasts become a line on top of the next screen (when there is no button to answer).
   * mode 'panel': everything in the one text panel message. mode 'widget': screens go into the widget; a question is
   * a message of its own under it (removed once answered); one-time screens (a new password) stay plain messages, so
   * the sweep can hide them.
   */
  private async present(account: Account, chatId: string, result: Result, state: ChatState, opts: { note?: string; fresh?: boolean; skipToast?: boolean; mode?: Mode; route?: Go } = {}) {
    const mode = opts.mode ?? 'panel';
    let note = opts.note ?? '';
    let r = result;
    let route = opts.route;
    let skip = !!opts.skipToast;
    for (let hops = 0; r.kind === 'toast' && hops < 4; hops++) {
      if (!skip && r.text) note += `${h(r.text)}\n\n`;
      skip = false;
      route = r.then ?? route;
      r = r.then ? await this.run(account, r.then) : { kind: 'screen', text: '', rows: [[{ text: '🏠 Меню', go: go('home') }]] };
    }
    if (r.kind === 'toast') r = { kind: 'screen', text: h(r.text), rows: [[{ text: '🏠 Меню', go: go('home') }]] };
    const next: ChatState = { ...state, ask: undefined };

    if (mode === 'widget') {
      // An earlier question under the widget goes; this answer replaced it.
      if (state.prompt) await this.call('deleteMessage', { chat_id: chatId, message_id: state.prompt }).catch(() => undefined);
      next.prompt = undefined;
      if (r.kind === 'ask') {
        next.ask = { then: r.then, back: r.back, secret: r.secret, text: r.text, skip: r.skip, mode: 'widget' };
        await this.onAsk?.(chatId);
        // Locked: the widget says so, the password prompt is a message under it.
        if (r.then.r === 'unlock' && state.widget) next.widget = await this.drawWidget(chatId, { text: '🔐 Админка закрыта\nВведите пароль администратора в чат — сообщение с ним сразу удалится.', rows: [] }, note, state, undefined, false);
        next.prompt = await this.panel.show(chatId, this.panel.askScreen(r, note), {}, {});
      } else if (r.expireMs) {
        // A new password: a plain message the minute sweep hides; the widget stays as it was.
        const mid = await this.panel.show(chatId, r, {}, { note });
        await this.store.addExpiry(chatId, mid, Date.now() + r.expireMs);
      } else {
        next.widget = await this.drawWidget(chatId, r, note, state, route, !!opts.fresh);
      }
      await this.store.saveState(chatId, next);
      return;
    }

    let screenToShow;
    if (r.kind === 'ask') {
      next.ask = { then: r.then, back: r.back, secret: r.secret, text: r.text, skip: r.skip };
      await this.onAsk?.(chatId);
      screenToShow = this.panel.askScreen(r, note);
      note = '';
    } else screenToShow = r;
    // A one-time screen (a new password) on display goes off the schedule: it is being replaced right now. If the
    // new screen landed in another message (the old one couldn't be edited), the old one is hidden at once.
    const pending = await this.store.takeExpiry(chatId);
    next.panel = await this.panel.show(chatId, screenToShow, state, { note, fresh: opts.fresh });
    await this.store.saveState(chatId, next);
    if (pending && pending !== next.panel) await this.hide(chatId, pending);
    if (r.kind !== 'ask' && r.expireMs) await this.store.addExpiry(chatId, next.panel, Date.now() + r.expireMs);
  }

  private hide(chatId: string, messageId: number) {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text: '🔒 Скрыто — данные показываются один раз.', reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }

  /** Hides one-time screens whose time is up (called every minute by AdminLogNotifier, survives restarts). */
  async sweepExpired(now = Date.now()) {
    for (const e of await this.store.dueExpiries(now)) await this.hide(e.chatId, e.messageId);
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
