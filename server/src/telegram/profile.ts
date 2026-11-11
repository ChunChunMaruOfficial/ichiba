/**
 * The bot's public face in one place: its name, the texts Telegram shows before the first /start and on the
 * profile, and the command lists. One bot serves sign-in on the site, sellers' notifications and shops, and (for
 * admins) the admin panel, so the shop and admin parts take their commands from here and never drift apart.
 *
 * Telegram keeps these per bot; they are written on boot only when they differ (setMyName is rate limited), so
 * restarts and the overlap of two containers during a deploy cost nothing. The @username is not here: Telegram
 * changes it only through @BotFather, and the site's sign-in widget and links need TELEGRAM_BOT_USERNAME updated.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { RedisService } from '../redis/redis.js';
import { tg, tgUpload } from './bot-api.js';

export const BOT_NAME = 'Ichiba';

/** Up to 512 characters: shown in an empty chat, before /start. */
export const BOT_DESCRIPTION = [
  'Ichiba — маркетплейс одежды в Беларуси.',
  '',
  'Бот присылает продавцам запросы на покупку, предложения цены и сообщения — ответить можно прямо здесь.',
  'Здесь же управляют магазином: цены, «снять с продажи», «продано», статистика.',
  '',
  'Подключение: ichiba.by → Настройки → Telegram.',
].join('\n');

/** Up to 120 characters: the profile page and link previews. */
export const BOT_SHORT_DESCRIPTION = 'Уведомления и управление магазином на ichiba.by';

export interface BotCommand {
  command: string;
  description: string;
}

/** Everyone's menu (the «/» list). */
export const SHOP_COMMANDS: BotCommand[] = [
  { command: 'menu', description: 'Мой магазин и покупки' },
  { command: 'items', description: 'Вещи в продаже' },
  { command: 'deals', description: 'Ждут ответа' },
  { command: 'purchases', description: 'Мои покупки' },
  { command: 'stats', description: 'Статистика за неделю' },
  { command: 'settings', description: 'Какие уведомления присылать' },
  { command: 'status', description: 'Какой аккаунт подключён' },
  { command: 'help', description: 'Что умеет бот' },
  { command: 'stop', description: 'Отключить бота от всех аккаунтов' },
];

/** Admins' extra commands, first in their list. */
export const ADMIN_COMMANDS: BotCommand[] = [
  { command: 'admin', description: 'Админка' },
  { command: 'lock', description: 'Закрыть админку' },
];

/** An admin's chat in the shared bot: the admin panel first, then everything a shop owner has. */
export const adminChatCommands = (): BotCommand[] => [...ADMIN_COMMANDS, ...SHOP_COMMANDS];

const logger = new Logger('TelegramProfile');

/** Writes the name, descriptions and the default command list where Telegram has something else. */
export async function applyProfile() {
  const step = async (what: string, current: () => Promise<string>, set: () => Promise<unknown>, want: string) => {
    try {
      if ((await current()) === want) return;
      await set();
      logger.log(`${what} updated`);
    } catch (e) {
      // A rate limit on setMyName (Telegram allows a few a day) must not stop the bot: it retries on the next boot.
      logger.warn(`${what}: ${(e as Error).message}`);
    }
  };
  await step('name', () => tg<{ name: string }>('getMyName').then((r) => r.name), () => tg('setMyName', { name: BOT_NAME }), BOT_NAME);
  await step('description', () => tg<{ description: string }>('getMyDescription').then((r) => r.description), () => tg('setMyDescription', { description: BOT_DESCRIPTION }), BOT_DESCRIPTION);
  await step(
    'short description',
    () => tg<{ short_description: string }>('getMyShortDescription').then((r) => r.short_description),
    () => tg('setMyShortDescription', { short_description: BOT_SHORT_DESCRIPTION }),
    BOT_SHORT_DESCRIPTION,
  );
  const want = JSON.stringify(SHOP_COMMANDS);
  await step('commands', () => tg<BotCommand[]>('getMyCommands').then((r) => JSON.stringify(r.map(({ command, description }) => ({ command, description })))), () => tg('setMyCommands', { commands: SHOP_COMMANDS }), want);
}

/** The bot's picture: the ichiba seal (design/brand/export/ichiba-logo-1024.png cropped to the circle), a JPG. */
export const AVATAR_PATH = join(process.cwd(), 'assets', 'bot-avatar.jpg');

/**
 * Sets the bot's profile photo (Bot API setMyProfilePhoto) once per picture: the file's fingerprint is kept in
 * Redis, so restarts don't upload it again; a new picture (another file) is uploaded on the next boot. Without Redis
 * it is uploaded on every boot, which is harmless. Never fails the setup.
 */
export async function applyAvatar(redis: RedisService) {
  let data: Buffer;
  try {
    data = await readFile(AVATAR_PATH);
  } catch {
    return;
  }
  const key = `ichiba:tg:avatar:${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
  try {
    if (redis.client && (await redis.client.get(key))) return;
  } catch {
    // Redis down: upload anyway.
  }
  try {
    await tgUpload('setMyProfilePhoto', { photo: JSON.stringify({ type: 'static', photo: 'attach://avatar' }) }, { avatar: { data, name: 'avatar.jpg', type: 'image/jpeg' } });
    await redis.client?.set(key, '1').catch(() => undefined);
    logger.log('profile photo updated');
  } catch (e) {
    logger.warn(`profile photo: ${(e as Error).message}`);
  }
}
