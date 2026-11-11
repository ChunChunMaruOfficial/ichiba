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
}

const TTL_S = 30 * 24 * 3600;
const MAX_STATE = 1024;

/** A widget's state as JSON within the 1024 bytes Telegram keeps: long texts are cut down until it fits. */
export function packState(state: Record<string, unknown>): string {
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
  return Buffer.byteLength(json) > MAX_STATE ? JSON.stringify({ s: state.s, u: state.u, t: 'Слишком много данных — откройте на сайте' }) : json;
}
const mem = new Map<string, { v: WCtx; until: number }>();
const key = (chatId: number | string, messageId: number) => `ichiba:tg:w:${chatId}:${messageId}`;

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
