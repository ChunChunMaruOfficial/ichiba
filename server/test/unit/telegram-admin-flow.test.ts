import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { RedisService } from '../../src/redis/redis.js';
import { AdminBotService } from '../../src/telegram/admin/admin-bot.js';
import type { TgUpdate } from '../../src/telegram/bot-api.js';

/**
 * The whole way through, with a stand-in Bot API and a stand-in admin API: who gets in, the password, the lockout,
 * signed buttons, and that every API call carries short-lived tokens of the right account.
 */
process.env.JWT_SECRET = 'test-secret-for-admin-bot';
process.env.TELEGRAM_BOT_TOKEN = 'T';
delete process.env.TELEGRAM_ADMIN_BOT_TOKEN;
delete process.env.TELEGRAM_ADMIN_IDS;
delete process.env.TELEGRAM_ADMIN_USERNAMES;
/** The admin panel opens only for the owner's Telegram username (access.ts ownerUsername). */
let OWNER = 'ChunChunMaruOn';
process.env.APP_URL = 'http://localhost:3000';

const CHAT = 777;
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const tgCalls: Array<{ method: string; body: Record<string, unknown> }> = [];
const apiCalls: Array<{ path: string; cookie: string }> = [];
let tgServer: Server;
let apiServer: Server;
let msgId = 100;

const body = (req: IncomingMessage) => new Promise<string>((r) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => r(s));
});

before(async () => {
  tgServer = createServer(async (req, res) => {
    const method = req.url!.split('/').pop()!;
    tgCalls.push({ method, body: JSON.parse((await body(req)) || '{}') });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: ++msgId } : true }));
  }).listen(0);
  apiServer = createServer(async (req, res) => {
    apiCalls.push({ path: req.url!, cookie: req.headers.cookie ?? '' });
    await body(req);
    res.setHeader('content-type', 'application/json');
    if (req.url!.startsWith('/admin/stats')) return res.end(JSON.stringify({ completedWeek: 2, gmvWeek: 300, users: 10, newUsers: 1, publishedWeek: 4, openReports: 1, listingsByStatus: {}, dealsByStatus: {} }));
    if (req.url!.startsWith('/admin/reports')) return res.end(JSON.stringify({ items: [] }));
    if (req.url!.startsWith('/admin/journal')) return res.end(JSON.stringify({ pending: 0, items: [] }));
    res.end(JSON.stringify({ items: [] }));
  }).listen(0);
  process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(tgServer.address() as AddressInfo).port}`;
  process.env.ADMIN_BOT_API_URL = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});
after(() => {
  tgServer.close();
  apiServer.close();
});

const PASSWORD = 'correct horse battery';
let account: { id: string; username: string; role: string; sessionVersion: number; tgSessionVersion: number | null; passwordHash: string | null; tgChatId: string; tgAdmin: unknown; blockedAt: null; deletedAt: null };
const audit: string[] = [];

const prisma = {
  user: {
    findFirst: async ({ where }: { where: { tgChatId: string; role: string } }) =>
      where.tgChatId === account.tgChatId && account.role === where.role ? { ...account } : null,
    findMany: async () => [],
    update: async ({ data }: { data: { tgAdmin: unknown } }) => {
      account.tgAdmin = data.tgAdmin;
      return account;
    },
  },
  moderationAction: { create: async ({ data }: { data: { action: string } }) => audit.push(data.action) },
} as unknown as PrismaService;

let bot: AdminBotService;
let upd = 1;
beforeEach(() => {
  account = { id: 'a1', username: 'boss', role: 'ADMIN', sessionVersion: 2, tgSessionVersion: 2, passwordHash: bcrypt.hashSync(PASSWORD, 4), tgChatId: String(CHAT), tgAdmin: null, blockedAt: null, deletedAt: null };
  bot = new AdminBotService(prisma, { client: null } as unknown as RedisService, jwt);
  tgCalls.length = 0;
  apiCalls.length = 0;
  audit.length = 0;
});

const say = (text: string, chat = CHAT, from = CHAT): TgUpdate => ({ update_id: upd++, message: { message_id: ++msgId, chat: { id: chat, type: chat === from ? 'private' : 'group' }, from: { id: from, username: OWNER }, text } });
const tap = (data: string, from = CHAT): TgUpdate => ({ update_id: upd++, callback_query: { id: `q${upd}`, from: { id: from, username: OWNER }, data, message: { message_id: msgId, chat: { id: from, type: 'private' } } } });
const lastText = () => [...tgCalls].reverse().find((c) => c.method === 'sendMessage' || c.method === 'editMessageText')?.body.text as string;
const buttons = () => {
  const c = [...tgCalls].reverse().find((x) => x.method === 'sendMessage' || x.method === 'editMessageText');
  return ((c?.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> })?.inline_keyboard ?? []).flat();
};
const unlock = async () => {
  await bot.handle(say('/admin'));
  await bot.handle(say(PASSWORD));
};

test('a linked admin is asked for the password first, and the password leaves the chat', async () => {
  assert.equal(await bot.wants(say('/admin')), true);
  await bot.handle(say('/admin'));
  assert.match(lastText(), /Введите пароль/);
  assert.equal(apiCalls.length, 0, 'nothing is read before the password');
  await bot.handle(say(PASSWORD));
  assert.ok(tgCalls.some((c) => c.method === 'deleteMessage'), 'the message with the password is deleted');
  assert.match(lastText(), /Админка открыта/);
  assert.match(lastText(), /Админка ichiba/);
  assert.deepEqual(audit, ['tg_admin_unlock']);
});

test('the same linked ADMIN account from a Telegram with another username gets nothing', async () => {
  OWNER = 'not_the_owner';
  try {
    assert.equal(await bot.wants(say('/admin')), false, 'falls through to the shop menu');
    await bot.handle(say('/admin'));
    await bot.handle(say(PASSWORD));
    assert.ok(!tgCalls.some((c) => /Введите пароль|Админка открыта/.test(String(c.body.text ?? ''))));
    assert.equal(apiCalls.length, 0);
    assert.deepEqual(audit, []);
  } finally {
    OWNER = 'ChunChunMaruOn';
  }
});

test('API calls carry the account’s own short-lived session and admin tokens', async () => {
  await unlock();
  const cookie = apiCalls[0].cookie;
  const session = await jwt.verifyAsync<{ sub: string; sv: number; role: string; exp: number; iat: number }>(/ichiba_token=([^;]+)/.exec(cookie)![1]);
  const admin = await jwt.verifyAsync<{ sub: string; purpose: string }>(/ichiba_admin=([^;]+)/.exec(cookie)![1]);
  assert.equal(session.sub, 'a1');
  assert.equal(session.sv, 2);
  assert.ok(session.exp - session.iat <= 120);
  assert.deepEqual([admin.sub, admin.purpose], ['a1', 'admin']);
});

test('wrong passwords are counted, logged and end in a lockout', async () => {
  await bot.handle(say('/admin'));
  for (let i = 1; i <= 4; i++) {
    await bot.handle(say(`nope${i}`));
    assert.match(lastText(), new RegExp(`Осталось попыток: ${5 - i}`));
  }
  await bot.handle(say('nope5'));
  assert.match(lastText(), /закрыта на 15 минут/);
  await bot.handle(say(PASSWORD));
  assert.match(lastText(), /Слишком много неверных паролей/, 'even the right password waits out the lockout');
  assert.equal(audit.filter((a) => a === 'tg_admin_unlock_failed').length, 5);
});

test('guesses sent all at once still stop at five', async () => {
  await bot.handle(say('/admin'));
  await Promise.all(Array.from({ length: 12 }, (_, i) => bot.handle(say(`guess${i}`))));
  assert.ok(audit.filter((a) => a === 'tg_admin_unlock_failed').length <= 5, 'at most five passwords are ever checked');
  await bot.handle(say(PASSWORD));
  assert.ok(!audit.includes('tg_admin_unlock'), 'the right password waits out the lockout too');
});

test('buttons are signed for this chat; forged or foreign ones do nothing', async () => {
  await unlock();
  const moderation = buttons().find((b) => b.text.startsWith('🛡'))!;
  assert.match(moderation.callback_data!, /^ad:[\w-]{12}:\d+\|[\w-]{11}$/);
  await bot.handle(tap(moderation.callback_data!));
  assert.ok(apiCalls.some((c) => c.path === '/admin/reports?status=OPEN'));
  // The same data unsigned, or signed for another chat.
  assert.equal(await bot.wants(tap(moderation.callback_data!.split('|')[0])), false);
  const before = apiCalls.length;
  await bot.handle(tap(moderation.callback_data!, 999));
  assert.equal(apiCalls.length, before, 'another Telegram account gets nowhere');
});

test('a password reset elsewhere closes the bot, and so does losing the role', async () => {
  await unlock();
  account.sessionVersion = 3;
  account.tgSessionVersion = 3;
  await bot.handle(say('/admin'));
  assert.match(lastText(), /Введите пароль/);
  account.role = 'USER';
  assert.equal(await bot.wants(say('/admin')), false);
  await bot.handle(tap('ad:xxxxxxxxxxxx:0|zzzzzzzzzzz'));
  assert.ok(tgCalls.some((c) => c.method === 'answerCallbackQuery' && c.body.text === 'Нет доступа'));
});

test('a stale Telegram link and group chats are refused', async () => {
  account.tgSessionVersion = 1;
  assert.equal(await bot.wants(say('/admin')), false);
  account.tgSessionVersion = 2;
  const before = tgCalls.length;
  await bot.handle(say('/admin', -100, CHAT));
  assert.equal(tgCalls.length, before, 'nothing is said in a group');
});

test('/lock closes the session', async () => {
  await unlock();
  await bot.handle(say('/lock'));
  assert.match(lastText(), /Админка закрыта/);
  const moderation = buttons();
  assert.equal(moderation.length, 0, 'the password prompt has no buttons');
  await bot.handle(say('/admin'));
  assert.match(lastText(), /Введите пароль/);
});
