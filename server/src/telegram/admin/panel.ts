import { TelegramError, type InlineButton } from '../bot-api.js';
import { signed } from '../callbacks.js';
import type { AdminStore, ChatState } from './store.js';
import { fit, type Ask, type Btn, type Screen } from './ui.js';

type Call = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * Draws screens into the chat's one panel message: edits it in place when it can, sends a fresh one when it can't
 * (too old, deleted, a photo), and keeps the buttons' routes in the store.
 */
export class Panel {
  constructor(
    private readonly call: Call,
    private readonly store: AdminStore,
  ) {}

  /** Inline keyboard for any message of the panel (the widget's «Текстовая версия» too). */
  async keyboard(chatId: string, rows: Btn[][]) {
    const routes: NonNullable<Btn['go']>[] = [];
    for (const row of rows) for (const b of row) if (b.go) routes.push(b.go);
    const id = routes.length ? await this.store.saveScreen(chatId, routes) : '';
    let n = 0;
    return rows
      .map((row) => row.map((b): InlineButton => (b.go ? { text: b.text, callback_data: signed(chatId, `ad:${id}:${n++}`) } : { text: b.text, url: b.url })))
      .filter((r) => r.length);
  }

  /** The ask as a screen: the question, «skip» when allowed, and «Отмена» (none on the password prompt). */
  askScreen(a: Ask, note = ''): Screen {
    const rows: Btn[][] = [];
    if (a.skip) rows.push([{ text: `⏭ ${a.skip}`, go: { r: a.then.r, p: { ...a.then.p, input: '' } } }]);
    if (a.then.r !== 'unlock') rows.push([{ text: '✖️ Отмена', go: a.back }]);
    return { text: `${note}${a.text}\n\n<i>✍️ Ответьте сообщением в этот чат.</i>`, rows };
  }

  /** Shows a screen in the panel; returns the message id it ended up in. */
  async show(chatId: string, s: Screen, state: ChatState, opts: { note?: string; fresh?: boolean } = {}) {
    const text = fit(`${opts.note ?? ''}${s.text}`);
    const markup = { inline_keyboard: await this.keyboard(chatId, s.rows) };
    const body = { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup };
    if (state.panel && !opts.fresh) {
      try {
        await this.call('editMessageText', { ...body, message_id: state.panel });
        return state.panel;
      } catch (e) {
        if (e instanceof TelegramError && /not modified/i.test(e.description)) return state.panel;
        // Can't edit (deleted, too old, a photo): a new panel below.
      }
    }
    if (state.panel && opts.fresh) await this.call('deleteMessage', { chat_id: chatId, message_id: state.panel }).catch(() => undefined);
    const sent = (await this.call('sendMessage', body)) as { message_id: number };
    return sent.message_id;
  }

  /** A message outside the panel (a journal notice) whose buttons work like the panel's. */
  async notice(chatId: string, html: string, rows: Btn[][]) {
    await this.call('sendMessage', { chat_id: chatId, text: fit(html), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: await this.keyboard(chatId, rows) } });
  }
}
