/**
 * What the bot remembers about each widget message it sent (the shop menu or a deal card): kept server-side per
 * chat + message, never in the widget, so a tap can only name things the bot itself put on that message. Redis
 * when configured (shared by every instance), this process's memory otherwise.
 */
import type { RedisService } from '../redis/redis.js';

/** A deal card: the request or offer it is about. */
export interface NoticeCtx {
  k: 'r' | 'o';
  id: string;
  /** What the card shows (widget-notice.ts), kept to redraw it after an answer. */
  ns?: Record<string, unknown>;
}

export interface WCtx {
  acc?: string;
  f?: string;
  p?: number;
  ids?: string[];
  item?: string;
  deals?: Array<['r' | 'o', string]>;
  /** Counter-offers waiting for this account as a buyer, by position on the «Покупки» screen. */
  buys?: string[];
  notice?: NoticeCtx;
  /** A generic card (cards.ts): what it shows, and the item its «Открыть вещь» button opens. */
  card?: { item?: string; ns?: Record<string, unknown> };
  /** The menu's version: 2 = the one template drawing blocks (widget-view.ts). Older menus are sent anew once. */
  v?: number;
}

const TTL_S = 30 * 24 * 3600;
const MAX_STATE = 1024;

/** Emoji (pictographs and their joiners) out of a UI string: the widgets draw their own line icons. */
export const noEmoji = (s: string) => s.replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/^ +| +$/gm, '');

/**
 * The bot's own wording without emoji: headings, toasts, «done» lines, button labels, and the start of each line.
 * Users' text (titles, names, chat previews in the middle of a line) is left as they wrote it.
 */
function plainUi(state: Record<string, unknown>): Record<string, unknown> {
  const out = { ...state };
  for (const k of ['h', 'd', 'e']) if (typeof out[k] === 'string') out[k] = noEmoji(out[k] as string);
  if (typeof out.t === 'string' && typeof out.s === 'string') out.t = noEmoji(out.t);
  for (const k of ['l', 'c']) if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).map((b) => (Array.isArray(b) && typeof b[0] === 'string' ? [noEmoji(b[0]), ...b.slice(1)] : b));
  if (Array.isArray(out.x)) out.x = (out.x as unknown[]).map((v) => (typeof v === 'string' ? v.replace(/^(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\s)+/u, '') : v));
  return out;
}

/** A widget's state as JSON within the 1024 bytes Telegram keeps: long texts are cut down until it fits. */
export function packState(state: Record<string, unknown>): string {
  state = plainUi(state);
  let json = JSON.stringify(state);
  // Cards: long lines are shortened first, at a word, keeping the start of each.
  for (const n of [300, 200, 140, 90]) {
    if (Buffer.byteLength(json) <= MAX_STATE || !Array.isArray(state.x)) break;
    const lines = (state.x as unknown[]).map((v) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n).replace(/\s+\S*$/, '')}…` : v));
    state = { ...state, x: lines };
    json = JSON.stringify(state);
  }
  for (let n = 22; Buffer.byteLength(json) > MAX_STATE && n >= 6; n -= 4) {
    const cut = (v: unknown): unknown => (typeof v === 'string' && v.length > n ? `${v.slice(0, n - 1)}…` : Array.isArray(v) ? v.map(cut) : v);
    json = JSON.stringify({ ...state, i: cut(state.i), T: cut(state.T), z: cut(state.z), t: cut(state.t), w: cut(state.w) });
  }
  // A screen of blocks (widget-view.ts): its texts are cut down, never its commands or links.
  for (let n = 40; Buffer.byteLength(json) > MAX_STATE && Array.isArray(state.B) && n >= 10; n -= 6) {
    const cut = (v: unknown): unknown =>
      typeof v === 'string' && v.length > n && !/^[\w:]+$/.test(v) && !v.startsWith('https://') ? `${v.slice(0, n - 1)}…` : Array.isArray(v) ? v.map(cut) : v;
    json = JSON.stringify({ ...state, B: cut(state.B) });
  }
  return Buffer.byteLength(json) > MAX_STATE ? JSON.stringify({ s: state.s, H: state.H ?? ['Ichiba'], B: [['p', 'Слишком много данных — откройте на сайте']] }) : json;
}
const mem = new Map<string, { v: WCtx; until: number }>();
const menus = new Map<string, number>();
const key = (chatId: number | string, messageId: number) => `ichiba:tg:w:${chatId}:${messageId}`;

/** The chat's current menu message (one per chat: a new one replaces it). */
export async function chatMenu(redis: RedisService, chatId: number | string): Promise<number | null> {
  const k = `ichiba:tg:menu:${chatId}`;
  if (redis.client) {
    try {
      const v = await redis.client.get(k);
      return v ? Number(v) : null;
    } catch {
      // Redis down: memory.
    }
  }
  const hit = menus.get(k);
  return hit ?? null;
}

export async function setChatMenu(redis: RedisService, chatId: number | string, messageId: number) {
  const k = `ichiba:tg:menu:${chatId}`;
  if (redis.client) {
    try {
      await redis.client.set(k, String(messageId), 'EX', TTL_S);
      return;
    } catch {
      // Redis down: memory.
    }
  }
  if (menus.size > 5000) menus.clear();
  menus.set(k, messageId);
}

export async function loadWidgetCtx(redis: RedisService, chatId: number | string, messageId: number): Promise<WCtx> {
  const k = key(chatId, messageId);
  if (redis.client) {
    try {
      const raw = await redis.client.get(k);
      return raw ? (JSON.parse(raw) as WCtx) : {};
    } catch {
      // Redis down: memory.
    }
  }
  const hit = mem.get(k);
  return hit && hit.until > Date.now() ? hit.v : {};
}

export async function saveWidgetCtx(redis: RedisService, chatId: number | string, messageId: number, ctx: WCtx) {
  const k = key(chatId, messageId);
  if (redis.client) {
    try {
      await redis.client.set(k, JSON.stringify(ctx), 'EX', TTL_S);
      return;
    } catch {
      // Redis down: memory.
    }
  }
  if (mem.size > 5000) mem.clear();
  mem.set(k, { v: ctx, until: Date.now() + TTL_S * 1000 });
}
