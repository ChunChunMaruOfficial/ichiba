import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { MAX_DATA, signed, verified } from '../../src/telegram/callbacks.js';
import { digestMessage, interestMessage } from '../../src/telegram/interest.js';
import { linkedAccounts, notificationKeyboard } from '../../src/telegram/notifier.js';
import { parsePrice, refusal, TelegramShopService, type Ctx } from '../../src/telegram/shop.js';
import { TelegramBotService } from '../../src/telegram/telegram.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const L = '11111111-2222-4333-8444-555555555555';
const CHAT = 700_000_001;

// ---------- Bot API stand-in: every call is recorded, every answer is ok ----------

let calls: Array<{ method: string; body: Record<string, unknown> }> = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-for-telegram';
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  process.env.TELEGRAM_BOT_USERNAME = 'ichiba_test_bot';
  process.env.APP_URL = 'https://ichiba.by';
  calls = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sentText = () => calls.map((c) => String(c.body.text ?? c.body.caption ?? (c.body.media as { caption?: string })?.caption ?? '')).join('\n');
const buttons = () => calls.flatMap((c) => ((c.body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })?.inline_keyboard ?? []).flat());

// ---------- signatures ----------

test('a button works only in the chat it was signed for, and only unchanged', () => {
  process.env.JWT_SECRET = 'test-secret-for-telegram';
  const raw = signed(CHAT, `H:${L}`);
  assert.equal(verified(CHAT, raw), `H:${L}`);
  assert.equal(verified(CHAT + 1, raw), null, 'another chat');
  assert.equal(verified(CHAT, raw.replace('H:', 'S:')), null, 'another action');
  assert.equal(verified(CHAT, `H:${L}`), null, 'unsigned');
  assert.equal(verified(CHAT, undefined), null);
  assert.equal(verified(CHAT, `${raw}x`), null);
  process.env.JWT_SECRET = 'rotated';
  assert.equal(verified(CHAT, raw), null, 'a new secret voids old buttons');
});

test('the longest button data fits in Telegram’s 64 bytes', () => {
  for (const d of [`P:${L}:100000`, `Y:${L}:14:abcdef`, `l:${A}:s:9999`, `+v:${L}`, `rq:D:${L}`, `N:${A}:7`]) {
    assert.ok(Buffer.byteLength(d) <= MAX_DATA, d);
    assert.ok(Buffer.byteLength(signed(CHAT, d)) <= 64, d);
  }
  assert.throws(() => signed(CHAT, 'x'.repeat(MAX_DATA + 1)));
  assert.throws(() => signed(CHAT, 'a|b'));
});

test('buttons under a notification are signed for the chat they go to', () => {
  const kb = notificationKeyboard('request_new', { requestId: L }, CHAT);
  assert.equal(verified(CHAT, kb[0][0].callback_data), `rq:a:${L}`);
  assert.equal(verified(CHAT + 1, kb[0][0].callback_data), null);
  // Only real ids become buttons.
  assert.deepEqual(notificationKeyboard('request_new', { requestId: 'x:y' }, CHAT).flat().filter((b) => b.callback_data), []);
});

// ---------- input ----------

test('a typed price: digits, spaces and «BYN», within limits', () => {
  assert.equal(parsePrice('95'), 95);
  assert.equal(parsePrice(' 1 200 BYN '), 1200);
  assert.equal(parsePrice('80 р.'), 80);
  assert.equal(parsePrice('1' + String.fromCharCode(160) + '200'), 1200, 'a no-break space inside a number');
  assert.equal(parsePrice('100000'), 100000);
  for (const bad of ['0', '-5', '12.5', '100001', 'abc', '', '95 евро', '1e3', '９５']) assert.equal(parsePrice(bad), null, bad);
});

test('a refusal reads as the site shows it; other errors are not swallowed', () => {
  assert.equal(refusal(new HttpException({ message: 'Идёт сделка' }, 409)), 'Идёт сделка');
  assert.equal(refusal(new HttpException({ message: 'Заполните обязательные поля', fields: { price: 'Укажите цену' } }, 400)), 'Заполните обязательные поля: Укажите цену');
  assert.equal(refusal(new Error('db down')), null);
});

test('interest and the evening summary never name the buyer and escape titles', () => {
  const fav = interestMessage('favorites', 'Куртка <b>x</b>', 7);
  assert.match(fav, /Куртка &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(fav, /у 7/);
  assert.equal(digestMessage('shop', { views: 0, favorites: 0, carts: 0, chats: 0, offers: 0, requests: 0 }, []), null);
  assert.match(digestMessage('sh<op', { views: 12, favorites: 2, carts: 0, chats: 1, offers: 0, requests: 0 }, [{ title: 'Плащ', views: 9 }])!, /@sh&lt;op[\s\S]*👁 12 · ♡ 2 · ✉️ 1[\s\S]*«Плащ» — 👁 9/);
});

// ---------- the shop service: who may do what ----------

function shopWith(listing: Record<string, unknown> | null) {
  const done: string[] = [];
  const row = listing && {
    id: L,
    title: 'Плащ',
    status: 'PUBLISHED',
    price: 120,
    previousPrice: null,
    priceNegotiable: false,
    sizeValue: 'M',
    sizes: [] as string[],
    acceptsOffers: true,
    viewsCount: 3,
    favoritesCount: 1,
    publishedAt: new Date(Date.now() - 3 * 86400_000),
    lastBumpAt: null,
    hiddenByAdmin: false,
    blockedReason: null,
    saleType: 'FIXED',
    ...listing,
  };
  const prisma = {
    listing: { findUnique: async () => row, findUniqueOrThrow: async () => row, groupBy: async () => [] },
    auction: { findFirst: async () => null },
    buyRequest: { count: async () => 0 },
    offer: { count: async () => 0 },
  };
  const record = (name: string) => async (sellerId: string, id: string, input?: unknown) => {
    done.push(`${name} ${sellerId} ${id}${input ? ` ${JSON.stringify(input)}` : ''}`);
    return { ok: true };
  };
  const listings = { hide: record('hide'), markSold: record('sold'), update: record('update'), publish: record('publish'), bump: record('bump') };
  const notifier = {
    send: async (chatId: string, text: string, keyboard: unknown) => calls.push({ method: 'sendMessage', body: { chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } } }),
    coverOf: async () => null,
  };
  const shop = new TelegramShopService(prisma as never, { client: null } as never, listings as never, notifier as never);
  return { shop, done };
}

const ctxOf = (accounts: string[]): Ctx => ({
  chatId: CHAT,
  messageId: 5,
  accounts: accounts.map((id) => ({ id, username: `u${id.slice(0, 2)}`, tgPrefs: null, sessionVersion: 0, tgSessionVersion: 0 })),
});

test('an item of another account is never touched, whatever the button says', async () => {
  const { shop, done } = shopWith({ sellerId: B });
  for (const op of ['H', 'S', 'u', 'b', 'o', 'v', 'p']) assert.equal(await shop.button(ctxOf([A]), `${op}:${L}`), true);
  assert.deepEqual(done, []);
  assert.match(sentText(), /не из ваших магазинов/);
  assert.ok(!sentText().includes('Плащ'), 'the foreign item is not shown either');
});

test('a deleted item is gone for its owner too', async () => {
  const { shop, done } = shopWith({ sellerId: A, status: 'DELETED' });
  await shop.button(ctxOf([A]), `S:${L}`);
  assert.deepEqual(done, []);
});

test('irreversible actions ask first, then go through ListingsService as the seller', async () => {
  const { shop, done } = shopWith({ sellerId: A });
  await shop.button(ctxOf([A]), `s:${L}`);
  assert.deepEqual(done, [], 'the first tap only asks');
  assert.match(sentText(), /Это нельзя отменить/);
  assert.ok(buttons().some((b) => verified(CHAT, b.callback_data) === `S:${L}`), 'the yes button is signed for this chat');
  await shop.button(ctxOf([B, A]), `S:${L}`);
  assert.deepEqual(done, [`sold ${A} ${L}`], 'acts as the item seller among several linked shops');
});

test('a price: typed once, confirmed, applied; out-of-range never reaches the service', async () => {
  const { shop, done } = shopWith({ sellerId: A });
  const ctx = ctxOf([A]);
  assert.equal(await shop.typed(ctx, '95'), false, 'nothing awaited yet');
  await shop.button(ctx, `p:${L}`);
  assert.equal(calls.at(-1)?.method, 'sendMessage');
  assert.equal((calls.at(-1)?.body.reply_markup as { force_reply?: boolean }).force_reply, true);
  calls = [];
  assert.equal(await shop.typed(ctx, '95 BYN'), true);
  const yes = buttons().find((b) => verified(CHAT, b.callback_data)?.startsWith('P:'));
  assert.equal(verified(CHAT, yes?.callback_data), `P:${L}:95`);
  assert.equal(await shop.typed(ctx, '90'), false, 'the slot is used up');
  assert.deepEqual(done, [], 'not applied before the confirmation');
  await shop.button(ctx, `P:${L}:95`);
  assert.deepEqual(done, [`update ${A} ${L} {"price":95}`]);
  await shop.button(ctx, `P:${L}:999999`);
  assert.equal(done.length, 1, 'over the limit');
  assert.equal(await shop.button(ctx, `P:${L}:-5`), false, 'not a shape the bot ever sends');
});

test('a refusal from the service is shown, not thrown', async () => {
  const { shop } = shopWith({ sellerId: A });
  (shop as unknown as { listings: { hide: () => Promise<never> } }).listings.hide = async () => {
    throw new HttpException({ message: 'Скрыть можно только вещь в продаже' }, 409);
  };
  await shop.button(ctxOf([A]), `H:${L}`);
  assert.match(sentText(), /⚠️ Скрыть можно только вещь в продаже/);
});

test('account screens only for the chat own accounts', async () => {
  const { shop } = shopWith(null);
  await shop.button(ctxOf([A]), `K:${B}`);
  assert.ok(!sentText().includes('отключён'));
  assert.match(sentText(), /Магазин @uaa/, 'a foreign account id leads to the chat own shop menu');
  assert.equal(await shop.button(ctxOf([A]), 'drop table'), false);
});

// ---------- the bot: replay, flood, chats, signatures ----------

function botWith() {
  const handled: string[] = [];
  const prisma = {
    user: {
      findMany: async () => [{ id: A, username: 'shop', tgPrefs: null, sessionVersion: 2, tgSessionVersion: 2 }],
      updateMany: async () => ({ count: 0 }),
    },
  };
  const shop = {
    button: async (_ctx: Ctx, data: string) => (handled.push(data), true),
    clearSlot: async () => undefined,
    typed: async () => false,
    accounts: async () => handled.push('menu'),
  };
  const notifier = { unlinkChat: async () => ({ count: 0 }) };
  const bot = new TelegramBotService(prisma as never, notifier as never, {} as never, {} as never, {} as never, shop as never, { client: null } as never, {} as never);
  const tap = (update_id: number, data: string, chat = CHAT, from = CHAT, type = 'private') =>
    bot.handle({ update_id, callback_query: { id: `q${update_id}`, from: { id: from }, data, message: { message_id: 9, chat: { id: chat, type } } } });
  return { bot, handled, tap };
}

test('only signed buttons from the private chat itself are acted on', async () => {
  const { handled, tap } = botWith();
  await tap(1, signed(CHAT, `H:${L}`));
  await tap(2, `H:${L}`);
  await tap(3, signed(CHAT + 1, `H:${L}`));
  await tap(4, signed(CHAT, `H:${L}`), CHAT, CHAT + 1);
  await tap(5, signed(-CHAT, `H:${L}`), -CHAT, CHAT, 'group');
  assert.deepEqual(handled, [`H:${L}`]);
  assert.ok(calls.some((c) => c.method === 'answerCallbackQuery' && /Кнопка устарела/.test(String(c.body.text))));
});

test('a re-delivered update is handled once', async () => {
  const { handled, tap } = botWith();
  await tap(10, signed(CHAT, `v:${L}`));
  await tap(10, signed(CHAT, `v:${L}`));
  assert.equal(handled.length, 1);
});

test('a flood from one user is cut off', async () => {
  const { handled, tap } = botWith();
  for (let i = 0; i < 60; i++) await tap(100 + i, signed(CHAT, `v:${L}`), CHAT + 7, CHAT + 7);
  assert.equal(handled.length, 0, 'signed for another chat: nothing');
  const second = botWith();
  for (let i = 0; i < 60; i++) await second.tap(1000 + i, signed(CHAT, `v:${L}`));
  assert.equal(second.handled.length, 40);
});

test('a link made before the password was reset is void', async () => {
  const unlinked: unknown[] = [];
  const prisma = {
    user: {
      findMany: async () => [
        { id: A, username: 'ok', sessionVersion: 3, tgSessionVersion: 3 },
        { id: B, username: 'reset', sessionVersion: 4, tgSessionVersion: 3 },
      ],
      updateMany: async (q: unknown) => (unlinked.push(q), { count: 1 }),
    },
  };
  const accounts = await linkedAccounts(prisma as never, String(CHAT));
  assert.deepEqual(accounts.map((a) => a.id), [A]);
  assert.deepEqual((unlinked[0] as { where: { id: { in: string[] } } }).where.id.in, [B]);
});

// ---------- the owner gate on /admin, the shared command lists ----------

test('/admin opens only for the owner’s Telegram username, and only narrows access', async () => {
  const { ownerUsername } = await import('../../src/telegram/admin/access.js');
  delete process.env.TELEGRAM_ADMIN_USERNAMES;
  assert.equal(ownerUsername('ChunChunMaruOn'), true);
  assert.equal(ownerUsername('chunchunmaruon'), true, 'Telegram usernames are case-insensitive');
  assert.equal(ownerUsername('ChunChunMaruOff'), false);
  assert.equal(ownerUsername(undefined), false, 'no username: refused');
  assert.equal(ownerUsername(''), false);
  process.env.TELEGRAM_ADMIN_USERNAMES = '@someone, other';
  assert.equal(ownerUsername('someone'), true);
  assert.equal(ownerUsername('ChunChunMaruOn'), false, 'the env list replaces the default');
  delete process.env.TELEGRAM_ADMIN_USERNAMES;
});

test('an admin chat keeps every shop command next to /admin', async () => {
  const { adminChatCommands, SHOP_COMMANDS, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION } = await import('../../src/telegram/profile.js');
  const names = adminChatCommands().map((c) => c.command);
  for (const c of SHOP_COMMANDS) assert.ok(names.includes(c.command), c.command);
  assert.equal(names[0], 'admin');
  assert.equal(new Set(names).size, names.length, 'no duplicates');
  for (const c of adminChatCommands()) assert.match(c.command, /^[a-z0-9_]{1,32}$/);
  assert.ok(BOT_DESCRIPTION.length <= 512 && BOT_SHORT_DESCRIPTION.length <= 120, 'Telegram limits');
});

test('a link made before a password reset is refused, even within its 15 minutes', async () => {
  const writes: unknown[] = [];
  const prisma = {
    user: {
      findFirst: async () => ({ id: A, username: 'shop', sessionVersion: 3, tgChatId: null }),
      findMany: async () => [],
      updateMany: async (q: unknown) => (writes.push(q), { count: 1 }),
    },
  };
  const notifications = { notify: async () => undefined };
  const events = { emit: async () => undefined };
  const bot = new TelegramBotService(prisma as never, { send: async () => null } as never, events as never, {} as never, {} as never, {} as never, { client: null } as never, notifications as never);
  const start = (update_id: number, token: string) => bot.handle({ update_id, message: { message_id: update_id, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: `/start ${token}` } });
  await start(1, `2_${'x'.repeat(24)}`);
  assert.equal(writes.length, 0, 'issued under sessionVersion 2, the account is at 3 now');
  assert.match(sentText(), /устарела/);
  await start(2, 'x'.repeat(24));
  assert.equal(writes.length, 0, 'a token without the version (old format) is refused');
  await start(3, `3_${'x'.repeat(24)}`);
  assert.equal(writes.length, 1, 'the current version links');
});
