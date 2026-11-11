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
// The text panel by default here; the widget tests switch it on.
process.env.TELEGRAM_ADMIN_WIDGETS = 'false';

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
    res.end(JSON.stringify({ ok: true, result: method === 'sendMessage' || method === 'sendWidget' ? { message_id: ++msgId } : true }));
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
    findUniqueOrThrow: async () => ({ tgAdmin: account.tgAdmin }),
    update: async ({ data }: { data: { tgAdmin: unknown } }) => {
      account.tgAdmin = data.tgAdmin;
      return account;
    },
  },
  moderationAction: { create: async ({ data }: { data: { action: string } }) => audit.push(data.action) },
  /** patchTgAdmin's in-place jsonb_set: values are [key, json, id] or, merging, [key, key, json, id]. */
  $executeRaw: async (_: TemplateStringsArray, ...v: unknown[]) => {
    const merge = v.length === 4;
    const key = v[0] as string;
    const value = JSON.parse((merge ? v[2] : v[1]) as string) as unknown;
    const s = { ...((account.tgAdmin as Record<string, unknown> | null) ?? {}) };
    s[key] = merge ? { ...((s[key] as object | undefined) ?? {}), ...(value as object) } : value;
    account.tgAdmin = s;
    return 1;
  },
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

test('/lock wins over a concurrent write of the 🔔 settings (keys are written in place)', async () => {
  await unlock();
  const notify = buttons().find((b) => b.text.startsWith('🔔'))!;
  await bot.handle(tap(notify.callback_data!));
  const hourly = buttons().find((b) => b.text.includes('Раз в час'))!;
  await bot.handle(say('/lock'));
  // The tap was on screen before /lock; the session must stay closed after it lands.
  await bot.handle(tap(hourly.callback_data!));
  assert.equal((account.tgAdmin as { session: unknown }).session, null);
});

test('a password typed after a shop button still goes to the panel, never to the shop', async () => {
  await bot.handle(say('/admin'));
  await bot.forget(CHAT, { keepUnlock: true });
  assert.equal(await bot.wants(say('some text')), true, 'the password prompt survives other buttons');
  await bot.forget(CHAT);
  assert.equal(await bot.wants(say('some text')), false, '/cancel or a new shop input drops it');
});

test('the panel asking for text drops the shop’s pending input', async () => {
  const asked: string[] = [];
  bot.onAsk = async (c) => asked.push(c);
  await bot.handle(say('/admin'));
  assert.deepEqual(asked, [String(CHAT)]);
});

test('a one-time screen is hidden by the sweep, not by a timer in the process', async () => {
  await unlock();
  // Stand-in for the new-password screen: put an expiry on the panel as present() does.
  const panel = (await bot.store.state(String(CHAT))).panel!;
  await bot.store.addExpiry(String(CHAT), panel, Date.now() - 1);
  await bot.sweepExpired();
  assert.ok(tgCalls.some((c) => c.method === 'editMessageText' && c.body.message_id === panel && /Скрыто/.test(String(c.body.text))));
  const n = tgCalls.length;
  await bot.sweepExpired();
  assert.equal(tgCalls.length, n, 'hidden once');
  // Replaced by the next screen before its time: nothing left to hide.
  await bot.store.addExpiry(String(CHAT), panel, Date.now() + 60_000);
  await bot.handle(say('/admin'));
  assert.equal(await bot.store.takeExpiry(String(CHAT)), null);
});

test('the interactive panel: a widget after the password, taps redraw it, foreign or stale taps do nothing', async () => {
  process.env.TELEGRAM_ADMIN_WIDGETS = 'true';
  try {
    await unlock();
    const sent = [...tgCalls].reverse().find((c) => c.method === 'sendWidget')!;
    assert.ok(sent, 'the panel is a widget');
    assert.equal(sent.body.allow_queries, true);
    assert.equal(sent.body.protect_content, true);
    const model = (c: Record<string, unknown>) => {
      const a = String(c.chat_data);
      const b = String(c.public_data);
      return JSON.parse(a.slice(a.indexOf('|') + 1) + b.slice(b.indexOf('|') + 1)) as { r: number; h: string; a: Array<Array<[string, number]>> };
    };
    const home = model(sent.body);
    assert.match(home.h, /Админка ichiba/);
    const state = await bot.store.state(String(CHAT));
    const mid = state.widget!.mid;
    const n = home.a.flat().find(([l]) => l.startsWith('🛡'))![1];
    const q = (data: string, extra: Partial<{ message_id: number; from: number }> = {}) =>
      bot.handle({ update_id: upd++, widget_query: { id: `w${upd}`, from: { id: extra.from ?? CHAT, username: OWNER }, chat: { id: extra.from ?? CHAT, type: 'private' }, message_id: extra.message_id ?? mid, data } } as never);

    await q(`b${home.r}.${n}`);
    const edit = [...tgCalls].reverse().find((c) => c.method === 'editMessageWidgetData')!;
    assert.equal(edit.body.message_id, mid);
    assert.match(model(edit.body).h, /Модерация/);
    assert.ok(apiCalls.some((c) => c.path === '/admin/reports?status=OPEN'));
    const answers = tgCalls.filter((c) => c.method === 'answerWidgetQuery');
    assert.deepEqual(JSON.parse(String(answers.at(-1)!.body.data)), { o: 1 });

    // A tap on an older revision, on another message, or from another Telegram: refused, nothing read.
    const before = apiCalls.length;
    await q(`b${home.r}.${n}`);
    assert.match(String(tgCalls.at(-1)!.body.data), /обновился/);
    await q(`b${home.r + 1}.0`, { message_id: mid + 1000 });
    assert.match(String(tgCalls.at(-1)!.body.data), /устарела/);
    await q(`b${home.r + 1}.0`, { from: 999 });
    await q('<script>');
    assert.equal(apiCalls.length, before);

    // Locked from elsewhere: the widget says so and the password prompt is a message under it.
    await bot.handle(say('/lock'));
    await q(`r${(await bot.store.state(String(CHAT))).widget!.rev}`);
    assert.match(String(tgCalls.filter((c) => c.method === 'answerWidgetQuery').at(-1)!.body.data), /пароль/);
  } finally {
    process.env.TELEGRAM_ADMIN_WIDGETS = 'false';
  }
});
