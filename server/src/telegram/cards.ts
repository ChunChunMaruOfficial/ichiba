/**
 * Every message of the bot is a widget (Bot API 10.4): the shop menu (widget.ts), deal cards (widget-notice.ts) and
 * this generic card — a heading, lines of text, maybe a price, link buttons (open the site) and command buttons
 * (handled by widget.ts). htmlToCard turns the bot's usual HTML text + inline keyboard into one, so every reply,
 * notification and ping goes out the same way; the text and keyboards stay the single place their wording lives.
 */
import { appUrl } from '../mail/templates.js';
import type { RedisService } from '../redis/redis.js';
import { tg, type Keyboard } from './bot-api.js';
import { verified } from './callbacks.js';
import { CARD_HTML } from './widget-html.js';
import { packState, saveWidgetCtx, type WCtx } from './widget-store.js';

export interface CardState {
  /** Heading with its emoji. */
  h?: string;
  /** Lines of text (plain; the widget escapes them). */
  x?: string[];
  /** Link buttons: [label, https url]. */
  l?: Array<[string, string]>;
  /** Command buttons: [label, command] — commands widget.ts answers (W, Wv, RL, RC). */
  c?: Array<[string, string]>;
  [k: string]: unknown;
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'" };
/** The bot's HTML text as plain text: tags out, entities back. */
export const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|#0?39);/g, (m) => ENTITIES[m] ?? m);

/** An https link Telegram will open (≤256 characters), else undefined. */
export function httpsLink(url: string | undefined) {
  return url && url.startsWith('https://') && url.length <= 256 ? url : undefined;
}
export const siteUrl = (path: string) => httpsLink(`${appUrl()}${path}`);

/**
 * A card from the bot's usual message: the first paragraph is the heading when it is short, the rest are lines.
 * Link buttons stay links; «✨ Мой магазин» (W) and «Открыть вещь» (W:<id>) become commands; any other callback
 * button (the retired classic menu) is dropped. The item a «W:<id>» button names is returned for the card's memory.
 */
export function htmlToCard(chatId: string | number, html: string, keyboard: Keyboard = []): { state: CardState; item?: string } {
  const paras = html.trim().split(/\n{2,}/).map((p) => plain(p).trim()).filter(Boolean);
  const head = paras[0] && paras[0].length <= 70 && !paras[0].includes('\n') ? paras.shift() : undefined;
  const state: CardState = { h: head ?? 'Ichiba', x: paras };
  let item: string | undefined;
  for (const b of keyboard.flat()) {
    if (b.url && httpsLink(b.url)) (state.l ??= []).push([b.text, b.url]);
    else if (b.callback_data) {
      const data = verified(chatId, b.callback_data);
      const m = data ? /^W(?::([0-9a-f-]{36}))?$/.exec(data) : null;
      if (!m) continue;
      if (m[1]) item = m[1];
      (state.c ??= []).push([b.text, m[1] ? 'Wv' : 'W']);
    }
  }
  return { state, item };
}

/**
 * Sends a card and remembers what its buttons may do. Throws what Telegram answered when it refuses. No caption:
 * the apps draw it under the widget, so it would only repeat the card.
 */
export async function sendCard(redis: RedisService, chatId: string | number, state: CardState, ctx: WCtx = {}) {
  const msg = await tg<{ message_id: number }>('sendWidget', {
    chat_id: chatId,
    html: CARD_HTML,
    chat_data: packState(state),
    allow_queries: true,
    protect_content: true,
  });
  await saveWidgetCtx(redis, chatId, msg.message_id, { ...ctx, card: { ...(ctx.card ?? {}), ns: state } });
  return msg;
}
