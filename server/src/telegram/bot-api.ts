/**
 * The few Telegram Bot API calls the notification bot needs (https://core.telegram.org/bots/api), over plain fetch.
 * The bot is the one behind «Войти через Telegram» (TELEGRAM_BOT_TOKEN); TELEGRAM_API_URL points the calls at a
 * stand-in server in tests.
 */

export const botToken = () => process.env.TELEGRAM_BOT_TOKEN || null;
export const botUsername = () => process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || null;
/** Notifications need both: the token to send, the username for the «Подключить» deep link. */
export const botEnabled = () => !!(botToken() && botUsername());

/** An answer Telegram refused: `code` is its error_code (403 = the user blocked the bot, 400 = bad request…). */
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`telegram ${code}: ${description}`);
  }
}

export interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
  /** Bot API 9.4: red, green or blue; apps that don't know it draw their usual button. */
  style?: 'danger' | 'success' | 'primary';
}
export type Keyboard = InlineButton[][];

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: unknown[];
  reply_to_message?: { message_id: number };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string };
  /** A tap in a widget message (Bot API 10.4): TelegramWidget.request(data) in the widget. */
  widget_query?: { id: string; from: TgUser; chat?: { id: number; type: string }; message_id?: number; data?: string; widget_id?: string };
  my_chat_member?: { chat: { id: number; type: string }; from: TgUser; new_chat_member: { status: string } };
}

/** One Bot API call; throws TelegramError on a refusal. Times out so a stuck request never holds a notification. */
export function tg<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  return tgAs<T>(botToken(), method, params, timeoutMs);
}

/** The same call on behalf of a given bot (the admin bot may have a token of its own, TELEGRAM_ADMIN_BOT_TOKEN). */
export async function tgAs<T = unknown>(token: string | null, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  if (!token) throw new TelegramError(0, 'TELEGRAM_BOT_TOKEN is not set');
  const base = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
  const res = await fetch(`${base}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => null)) as { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null;
  if (!body?.ok) throw new TelegramError(body?.error_code ?? res.status, body?.description ?? res.statusText, body?.parameters?.retry_after);
  return body.result as T;
}

/** The chat is gone for good: the user blocked the bot, deleted their account, or the chat no longer exists. */
export const chatGone = (e: unknown) =>
  e instanceof TelegramError && (e.code === 403 || (e.code === 400 && /chat not found|user is deactivated|bot was blocked/i.test(e.description)));

/** A Bot API call with files (multipart/form-data): `fields` as text (objects as JSON), `files` attached by name. */
export async function tgUpload<T = unknown>(method: string, fields: Record<string, string>, files: Record<string, { data: Buffer; name: string; type: string }>, timeoutMs = 30_000): Promise<T> {
  const token = botToken();
  if (!token) throw new TelegramError(0, 'TELEGRAM_BOT_TOKEN is not set');
  const base = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, f] of Object.entries(files)) form.append(k, new Blob([new Uint8Array(f.data)], { type: f.type }), f.name);
  const res = await fetch(`${base}/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json().catch(() => null)) as { ok: boolean; result?: T; error_code?: number; description?: string } | null;
  if (!body?.ok) throw new TelegramError(body?.error_code ?? res.status, body?.description ?? res.statusText);
  return body.result as T;
}
