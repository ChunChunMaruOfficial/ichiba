import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { appUrl } from '../mail/templates.js';
import { photoUrls } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { botEnabled, chatGone, type Keyboard, tg, TelegramError } from './bot-api.js';
import { signed } from './callbacks.js';
import { categoryOf, chatMessage, notificationMessage, notificationPath, openLabel, type TgCategory, tgPrefsOf } from './texts.js';

/** One Telegram ping per conversation in this window: a burst of messages is one nudge, not ten. */
const CHAT_COOLDOWN_S = 120;

/** A link button, only for an address Telegram accepts (it refuses http://localhost and other non-public URLs). */
export function linkButton(text: string, path: string) {
  const url = `${appUrl()}${path}`;
  return url.startsWith('https://') ? [{ text, url }] : [];
}

/**
 * Buttons under a notification: «Принять / Отклонить» right in Telegram for what waits on the user — a buy request
 * to a seller, an offer or a counter-offer — and a link to the page on the site for everything else. With a chat id
 * the buttons are signed for that chat (callbacks.ts).
 */
export function notificationKeyboard(type: string, p: Record<string, unknown>, chatId?: string | number): Keyboard {
  const open = linkButton(openLabel(type), notificationPath(type, p));
  const id = (k: string) => (typeof p[k] === 'string' && UUID.test(p[k] as string) ? (p[k] as string) : null);
  const cb = (data: string) => (chatId === undefined ? data : signed(chatId, data));
  if (type === 'request_new' && id('requestId')) {
    return [[{ text: '✅ Принять', style: 'success', callback_data: cb(`rq:a:${id('requestId')}`) }, { text: '✖️ Отклонить', style: 'danger', callback_data: cb(`rq:d:${id('requestId')}`) }], ...(open.length ? [open] : [])];
  }
  if ((type === 'offer_new' || type === 'offer_countered') && id('offerId')) {
    const counter = linkButton('↔️ Предложить свою цену', id('listingId') ? `/item/${id('listingId')}` : '/sales');
    return [[{ text: '✅ Принять', style: 'success', callback_data: cb(`of:a:${id('offerId')}`) }, { text: '✖️ Отклонить', style: 'danger', callback_data: cb(`of:d:${id('offerId')}`) }], ...(counter.length ? [counter] : [])];
  }
  return open.length ? [open] : [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Accounts that may act from this Telegram chat: linked to it, alive, and linked under the account's current
 * sessionVersion — a password reset, a block or a deletion voids the link (the stale rows are cleared on the way).
 */
export async function linkedAccounts(prisma: PrismaService, chatId: string) {
  const rows = await prisma.user.findMany({
    where: { tgChatId: chatId, deletedAt: null, blockedAt: null },
    select: { id: true, username: true, tgPrefs: true, sessionVersion: true, tgSessionVersion: true },
    orderBy: { tgLinkedAt: 'asc' },
  });
  const stale = rows.filter((u) => u.tgSessionVersion !== u.sessionVersion).map((u) => u.id);
  if (stale.length) await prisma.user.updateMany({ where: { id: { in: stale } }, data: UNLINK });
  return rows.filter((u) => u.tgSessionVersion === u.sessionVersion);
}

/** Columns that unlink an account from its chat. */
export const UNLINK = { tgChatId: null, tgUsername: null, tgLinkedAt: null, tgSessionVersion: null } as const;

/** Sends the site's notifications and new chat messages to the Telegram chat a user linked in settings. */
@Injectable()
export class TelegramNotifier {
  private readonly logger = new Logger('Telegram');
  /** Chat cooldowns when Redis is not configured (one instance). */
  private readonly recent = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  get enabled() {
    return botEnabled();
  }

  /** The linked chat of a user who wants this group of messages, or null. */
  async target(userId: string, category: TgCategory) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, tgChatId: true, tgPrefs: true, deletedAt: true, blockedAt: true, sessionVersion: true, tgSessionVersion: true },
    });
    if (!u?.tgChatId || u.deletedAt || u.blockedAt || u.tgSessionVersion !== u.sessionVersion || !tgPrefsOf(u.tgPrefs)[category]) return null;
    // Several accounts in one Telegram (a person running a few shops): each message says which one it is about.
    const shared = await this.prisma.user.count({ where: { tgChatId: u.tgChatId, deletedAt: null, blockedAt: null } });
    return { chatId: u.tgChatId, footer: shared > 1 ? `\n\n<i>Аккаунт @${u.username}</i>` : '' };
  }

  /** A copy of an in-app notification. Never throws: the notification itself is already saved. */
  async notification(userId: string, type: string, payload: Prisma.InputJsonValue) {
    if (!this.enabled) return;
    const p = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
    const to = await this.target(userId, categoryOf(type));
    if (!to) return;
    await this.send(to.chatId, notificationMessage(type, p) + to.footer, notificationKeyboard(type, p, to.chatId), await this.cover(p));
  }

  /** A new message in a conversation; one nudge per conversation every couple of minutes. */
  async chat(userId: string, m: { threadId: string; from: string; title: string; preview: string }) {
    if (!this.enabled) return;
    const to = await this.target(userId, 'chat');
    if (!to || !(await this.once(`chat:${userId}:${m.threadId}`, CHAT_COOLDOWN_S))) return;
    const reply = linkButton('Ответить', `/messages/${m.threadId}`);
    await this.send(to.chatId, chatMessage(m.from, m.title, m.preview) + to.footer, reply.length ? [reply] : []);
  }

  /** A message of a group the user may switch off (interest, digest), with the account footer and its own buttons. */
  async direct(userId: string, category: TgCategory, html: string, keyboard: (chatId: string) => Keyboard = () => [], photo: string | null = null) {
    if (!this.enabled) return null;
    const to = await this.target(userId, category);
    if (!to) return null;
    return this.send(to.chatId, html + to.footer, keyboard(to.chatId), photo);
  }

  /** True the first time `key` is seen within `seconds` (across instances through Redis, else in this process). */
  async once(key: string, seconds: number) {
    if (this.redis.client) {
      try {
        return (await this.redis.client.set(`ichiba:tg:once:${key}`, '1', 'EX', seconds, 'NX')) === 'OK';
      } catch {
        // Redis down: fall through to this instance's memory.
      }
    }
    const now = Date.now();
    if ((this.recent.get(key) ?? 0) > now) return false;
    if (this.recent.size > 5000) this.recent.clear();
    this.recent.set(key, now + seconds * 1000);
    return true;
  }

  /** The item's photo (from payload.listingId, or the first item of payload.requestId) when Telegram can fetch it. */
  private async cover(p: Record<string, unknown>) {
    let listingId = typeof p.listingId === 'string' ? p.listingId : null;
    if (!listingId && typeof p.requestId === 'string') {
      listingId = (await this.prisma.buyRequestItem.findFirst({ where: { requestId: p.requestId }, select: { listingId: true } }))?.listingId ?? null;
    }
    return listingId ? this.coverOf(listingId) : null;
  }

  /** The first photo of an item as a public https URL Telegram can fetch, or null. */
  async coverOf(listingId: string) {
    const ph = await this.prisma.photo.findFirst({ where: { listingId }, orderBy: { order: 'asc' }, select: { key: true, provider: true } });
    const url = ph ? photoUrls(ph).m : null;
    return url?.startsWith('https://') ? url : null;
  }

  /**
   * Sends a message (as a photo with a caption when there is a cover). A chat that is gone (bot blocked) is unlinked
   * from every account; a photo Telegram can't take falls back to text.
   */
  async send(chatId: string, html: string, keyboard: Keyboard = [], photo: string | null = null) {
    const markup = keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};
    try {
      // A caption holds 1024 characters, a message 4096.
      if (photo && html.length <= 1000) {
        try {
          return await tg('sendPhoto', { chat_id: chatId, photo, caption: html, parse_mode: 'HTML', ...markup });
        } catch (e) {
          if (chatGone(e) || !(e instanceof TelegramError) || e.code !== 400) throw e;
        }
      }
      return await tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup });
    } catch (e) {
      if (chatGone(e)) {
        await this.unlinkChat(chatId);
        this.logger.log(`chat ${chatId} is gone (${(e as TelegramError).description}): unlinked`);
        return null;
      }
      this.logger.warn(`send to ${chatId}: ${(e as Error).message}`);
      return null;
    }
  }

  unlinkChat(chatId: string) {
    return this.prisma.user.updateMany({ where: { tgChatId: chatId }, data: UNLINK });
  }
}
