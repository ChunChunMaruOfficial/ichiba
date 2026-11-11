/**
 * Buttons the bot puts under its own messages carry a short HMAC of «chat id | data»: a button only works in the chat
 * it was sent to, and a modified client can't invent one (an action on someone else's item, a price nobody typed).
 * Every action is still authorised again on the server — the signature is a second lock, not the only one.
 *
 * Telegram limits callback_data to 64 bytes: data up to 52 bytes + «|» + 11 characters of signature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIG_LEN = 11;
export const MAX_DATA = 64 - SIG_LEN - 1;

const key = () => createHmac('sha256', process.env.JWT_SECRET ?? '').update('telegram-callback').digest();
const mac = (chatId: string | number, data: string) => createHmac('sha256', key()).update(`${chatId}|${data}`).digest('base64url').slice(0, SIG_LEN);

/** callback_data for a button in this chat. */
export function signed(chatId: string | number, data: string) {
  if (data.includes('|') || Buffer.byteLength(data) > MAX_DATA) throw new Error(`callback data too long or malformed: ${data}`);
  return `${data}|${mac(chatId, data)}`;
}

/** The data of a button signed for this chat, or null (unsigned, signed for another chat, tampered with). */
export function verified(chatId: string | number, raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf('|');
  if (i < 1) return null;
  const data = raw.slice(0, i);
  const got = Buffer.from(raw.slice(i + 1));
  const want = Buffer.from(mac(chatId, data));
  return got.length === want.length && timingSafeEqual(got, want) ? data : null;
}
