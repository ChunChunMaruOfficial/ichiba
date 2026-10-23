/**
 * The few Telegram Bot API calls the notification bot needs (https://core.telegram.org/bots/api), over plain fetch.
 * The bot is the one behind «Войти через Telegram» (TELEGRAM_BOT_TOKEN); TELEGRAM_API_URL points the calls at a
 * stand-in server in tests.
 */

const botToken = () => process.env.TELEGRAM_BOT_TOKEN || null;
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

interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}
export type Keyboard = InlineButton[][];

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  photo?: unknown[];
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string };
  my_chat_member?: { chat: { id: number; type: string }; from: TgUser; new_chat_member: { status: string } };
}

/** One Bot API call; throws TelegramError on a refusal. Times out so a stuck request never holds a notification. */
export async function tg<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  const token = botToken();
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
