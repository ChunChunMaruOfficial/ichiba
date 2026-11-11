import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import zlib from 'node:zlib';
import { signed } from '../../src/telegram/callbacks.js';
import { htmlToCard } from '../../src/telegram/cards.js';
import { TelegramNotifier } from '../../src/telegram/notifier.js';
import { TelegramBotService } from '../../src/telegram/telegram.js';
import { CARD_HTML, NOTICE_HTML, WIDGET_HTML } from '../../src/telegram/widget-html.js';
import { noticeFor } from '../../src/telegram/widget-notice.js';
import { saveWidgetCtx } from '../../src/telegram/widget-store.js';
import { packState, parseCommand, TelegramWidgetService } from '../../src/telegram/widget.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const L1 = '11111111-2222-4333-8444-555555555555';
const L2 = '99999999-2222-4333-8444-555555555555';
const CHAT = 700_000_001;

// ---------- the widget itself ----------

test('the widget fits Telegram’s limits: 32 KB raw, 4 KB after zlib -9, no NUL', () => {
  assert.ok(Buffer.byteLength(WIDGET_HTML) <= 32768);
  assert.ok(zlib.deflateSync(Buffer.from(WIDGET_HTML), { level: 9 }).length <= 4096, 'compressed size');
  assert.ok(!WIDGET_HTML.includes('\0'));
  for (const banned of ['<input', '<select', '<textarea', '@font-face', 'fetch(', 'XMLHttpRequest', ' vh', 'position:sticky', 'src="http']) assert.ok(!WIDGET_HTML.includes(banned), banned);
});

/** Runs the widget's script against a stand-in TelegramWidget and returns what it draws for a state. */
function render(state: Record<string, unknown> | null) {
  const out = { innerHTML: '' };
  const handlers: Record<string, () => void> = {};
  const W = {
    chatData: state ? JSON.stringify(state) : null,
    onEvent: (t: string, fn: () => void) => (handlers[t] = fn),
    request: () => new Promise(() => undefined),
    ready: () => undefined,
    HapticFeedback: { impactOccurred: () => undefined, selectionChanged: () => undefined },
  };
  const document = { getElementById: () => out };
  const js = WIDGET_HTML.split('<script>')[1].split('</script>')[0];
  new Function('TelegramWidget', 'document', js)(W, document);
  return out.innerHTML;
}

test('every screen draws from its state, and users’ text is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>"\'';
  assert.match(render(null), /Магазин ichiba/);
  assert.match(render({ e: 'Не подключён' }), /Не подключён/);
  assert.match(render({ s: 'h', u: 'shop', n: [3, 1, 0, 7], w: 2, k: 1 }), /Ждут вашего ответа: 2[\s\S]*Другой магазин/);
  const list = render({ s: 'l', u: 'shop', f: 'a', p: 0, P: 3, i: [[evil, 120, 'P'], ['Плащ', null, 'R']] });
  assert.ok(!list.includes('<img'), 'a title is text, never markup');
  assert.match(list, /&#60;img/);
  assert.match(list, /договорная/);
  assert.match(list, /1 \/ 3/);
  const item = render({ s: 'i', u: 'shop', T: evil, c: 120, st: 'P', v: 5, fv: 2, of: 1, fx: 1, bu: 0, z: ['S', 'M'], f: 'a' });
  assert.ok(!item.includes('<img'));
  assert.match(item, /Сохранить · 120/);
  assert.match(item, /Поднять/);
  assert.match(item, /Продано/);
  assert.match(item, /M ✕/);
  assert.match(render({ s: 'i', T: 'x', c: 50, o: 80, st: 'S' }), /<s[^>]*>80/);
  assert.match(render({ s: 'd', u: 'shop', w: 1, i: [['r', evil, 'Плащ', 90]] }), /Принять[\s\S]*Отклонить/);
  assert.match(render({ s: 't', u: 'shop', d: [1, 2, 3, 4, 5, 6, 7], v: 28, f: 3, c: 1, m: 0, o: 0, r: 1 }), /class="bars"/);
  assert.match(render({ s: 'n', u: 'shop', q: [1, 0, 1, 1, 1, 1, 1, 1] }), /⬜️ Предложения цены/);
  assert.match(render({ s: 'x', a: ['one', 'two'] }), /@two/);
});

test('handlers carry only the app’s own commands, never users’ text', () => {
  const html = render({ s: 'l', u: 'shop', f: 'a', p: 0, P: 1, i: [["');alert(1);('", 1, 'P']] });
  for (const h of html.match(/onclick="[^"]*"/g) ?? []) assert.match(h, /^onclick="(q\('[\w:]*'\)|loc\('\w',-?\d+\)|)"$/, h);
});

// ---------- commands and state ----------

test('only the widget’s own command shapes are accepted', () => {
  assert.deepEqual(parseCommand('h'), { op: 'h', f: '', n: 0 });
  assert.deepEqual(parseCommand('l:s:3'), { op: 'l', f: 's', n: 3 });
  assert.deepEqual(parseCommand('o:5'), { op: 'o', f: '', n: 5 });
  assert.deepEqual(parseCommand('P:95'), { op: 'P', f: '', n: 95 });
  for (const bad of ['', 'P:-1', 'P:1234567', 'o:x', `o:${L1}`, 'l:z:0', 'H H', 'hh', 'P:95;drop', undefined]) assert.equal(parseCommand(bad), null, String(bad));
});

test('a state never exceeds the 1024 bytes a widget holds', () => {
  const long = 'Очень длинное название вещи на кириллице, которое занимает много байт '.repeat(3);
  const json = packState({ s: 'l', u: 'shop', f: 'a', p: 0, P: 9, i: Array.from({ length: 6 }, () => [long, 99999, 'P']) });
  assert.ok(Buffer.byteLength(json) <= 1024, String(Buffer.byteLength(json)));
  assert.equal(JSON.parse(json).i.length, 6, 'titles are cut, items are kept');
});

// ---------- the service: who may do what ----------

let calls: Array<{ method: string; body: Record<string, unknown> }> = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  calls = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 50 } }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serviceWith(linked: string[] = [A]) {
  const done: string[] = [];
  const listings = new Map<string, Record<string, unknown>>([
    [L1, { id: L1, sellerId: A, title: 'Плащ', status: 'PUBLISHED', price: 100, previousPrice: null, priceNegotiable: false, sizes: [], acceptsOffers: true, viewsCount: 1, favoritesCount: 0, publishedAt: new Date(Date.now() - 3 * 86400_000), lastBumpAt: null, hiddenByAdmin: false, saleType: 'FIXED' }],
    [L2, { id: L2, sellerId: B, title: 'Чужая куртка', status: 'PUBLISHED', price: 200, priceNegotiable: false, sizes: [], acceptsOffers: true }],
  ]);
  const prisma = {
    user: { findMany: async () => linked.map((id) => ({ id, username: `u_${id.slice(0, 2)}`, tgPrefs: null, sessionVersion: 1, tgSessionVersion: 1 })), updateMany: async () => ({ count: 0 }) },
    listing: {
      findUnique: async ({ where }: { where: { id: string } }) => listings.get(where.id) ?? null,
      findMany: async ({ where }: { where: { sellerId: string } }) => [...listings.values()].filter((l) => l.sellerId === where.sellerId),
      count: async ({ where }: { where: { sellerId: string } }) => [...listings.values()].filter((l) => l.sellerId === where.sellerId).length,
      groupBy: async () => [{ status: 'PUBLISHED', _count: 1 }],
    },
    auction: { findFirst: async () => null },
    buyRequest: { count: async () => 0, findMany: async () => [], findUnique: async () => ({ sellerId: B }) },
    offer: { count: async () => 0, findMany: async () => [], findUnique: async () => ({ sellerId: B }) },
  };
  const rec = (name: string) => async (seller: string, id: string, input?: unknown) => void done.push(`${name} ${seller} ${id}${input ? ` ${JSON.stringify(input)}` : ''}`);
  const svc = new TelegramWidgetService(
    prisma as never,
    { client: null } as never,
    { update: rec('update'), hide: rec('hide'), publish: rec('publish'), markSold: rec('sold'), bump: rec('bump') } as never,
    { accept: rec('accept'), decline: rec('decline') } as never,
    { accept: rec('accept-offer'), decline: rec('decline-offer') } as never,
    { askPrice: async () => undefined } as never,
  );
  let n = 0;
  const tap = (data: string, chat: { id: number; type: string } = { id: CHAT, type: 'private' }, from = CHAT) =>
    svc.query({ id: `w${++n}`, from: { id: from }, chat, message_id: 50, data });
  const lastState = () => {
    const a = [...calls].reverse().find((c) => c.method === 'answerWidgetQuery');
    return a ? JSON.parse(String(a.body.data)) : null;
  };
  return { svc, done, tap, lastState };
}

test('/menu sends the widget with queries allowed, protected, with a caption for older apps', async () => {
  const { svc } = serviceWith();
  assert.equal(await svc.open(CHAT, [{ id: A, username: 'shop', tgPrefs: null, sessionVersion: 1, tgSessionVersion: 1 }]), true);
  const send = calls.find((c) => c.method === 'sendWidget')!;
  assert.equal(send.body.allow_queries, true);
  assert.equal(send.body.protect_content, true);
  assert.match(String(send.body.caption), /\/list/);
  assert.equal(JSON.parse(String(send.body.chat_data)).s, 'h');
});

test('a tap opens only the shop’s own items, by position in the list the bot showed', async () => {
  const { tap, lastState, done } = serviceWith();
  await tap('l:a:0');
  const list = lastState();
  assert.deepEqual(list.i.map((x: unknown[]) => x[0]), ['Плащ'], 'a foreign item is never listed');
  await tap('o:0');
  assert.equal(lastState().T, 'Плащ');
  await tap('o:7');
  assert.equal(lastState().s, 'l', 'a position the bot never showed reopens the list');
  await tap('l:a:0');
  await tap('o:0');
  await tap('P:85');
  assert.deepEqual(done, [`update ${A} ${L1} {"price":85}`]);
  assert.match(lastState().t, /85 BYN/);
  assert.ok(calls.some((c) => c.method === 'editMessageWidgetData'), 'the message keeps the new state');
});

test('nothing happens from a group, from someone else, or from an unlinked Telegram', async () => {
  const s1 = serviceWith();
  await s1.tap('H', { id: -5, type: 'group' });
  await s1.tap('H', { id: CHAT, type: 'private' }, CHAT + 1);
  assert.deepEqual(s1.done, []);
  assert.match(s1.lastState().e, /личном чате/);
  const s2 = serviceWith([]);
  await s2.tap('l:a:0');
  assert.match(s2.lastState().e, /не подключён/);
});

test('a deal of another shop is never answered', async () => {
  const { tap, done } = serviceWith();
  await tap('d');
  await tap('da:0');
  await tap('dx:0');
  assert.deepEqual(done, []);
});

test('garbage commands just show the shop', async () => {
  const { tap, lastState, done } = serviceWith();
  await tap('<script>');
  assert.equal(lastState().s, 'h');
  assert.deepEqual(done, []);
});

// ---------- «Покупки», deal cards ----------

function renderWith(html: string, state: Record<string, unknown> | null) {
  const out = { innerHTML: '' };
  const W = { chatData: state ? JSON.stringify(state) : null, onEvent: () => 0, request: () => new Promise(() => 0), ready: () => 0, openLink: () => 0, HapticFeedback: {} };
  new Function('TelegramWidget', 'document', html.split('<script>')[1].split('</script>')[0])(W, { getElementById: () => out });
  return out.innerHTML;
}

test('«Покупки» lists counter-offers to answer and purchases on their way', () => {
  const html = render({ s: 'b', u: 'me', i: [['c', '<b>Плащ</b>', 90, 'Продавец предлагает свою цену', 0], ['p', 'Кеды', 50, 'В пути', 0]] });
  assert.match(html, /&#60;b&#62;Плащ/);
  assert.match(html, /q\('ba:0'\)/);
  assert.match(html, /В пути/);
  assert.equal((html.match(/✅ Принять/g) ?? []).length, 1, 'only the counter-offer has buttons');
});

test('the deal card fits, draws its state escaped, and its handlers are fixed', () => {
  assert.ok(zlib.deflateSync(Buffer.from(NOTICE_HTML), { level: 9 }).length <= 4096);
  const html = renderWith(NOTICE_HTML, { h: '🛍 Хотят купить', w: '@x<y', t: '<script>t</script>', p: 120, m: 'Ответьте в течение 48 часов', a: 1, u: 'https://ichiba.by/deals/1' });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /@x&#60;y/);
  assert.match(html, /120/);
  for (const h of html.match(/onclick="[^"]*"/g) ?? []) assert.match(h, /^onclick="(q\('n[ax]'\)|no\(\)|go\(\d+\)|cq\(\d+\))"$/, h);
  assert.match(renderWith(NOTICE_HTML, { h: 'x', t: 't', d: '✅ Принято' }), /✅ Принято/);
  assert.ok(!renderWith(NOTICE_HTML, { h: 'x', t: 't', d: '✅ Принято', a: 1 }).includes('Отклонить'), 'answered: no more buttons');
});

test('deal cards only for the three types that wait for an answer, with https links only', () => {
  process.env.APP_URL = 'https://ichiba.by';
  const req = noticeFor('request_new', { requestId: L1, buyer: 'anya', title: 'Плащ', price: 120 })!;
  assert.deepEqual(req.ctx, { k: 'r', id: L1 });
  assert.equal(req.state.u, `https://ichiba.by/deals/${L1}`);
  assert.match(req.caption, /@anya хочет купить «Плащ» за 120 BYN/);
  assert.equal(noticeFor('offer_countered', { offerId: L1, by: 'shop', amount: 90, title: 'x', listingId: L2 })!.state.u, `https://ichiba.by/item/${L2}`);
  assert.equal(noticeFor('request_new', { requestId: 'nope' }), null);
  assert.equal(noticeFor('price_drop', { listingId: L1 }), null);
  process.env.APP_URL = 'http://localhost:3000';
  assert.equal(noticeFor('request_new', { requestId: L1 })!.state.u, undefined, 'no http links in a card');
});

test('a deal card answers its own request once, as the party linked to this chat', async () => {
  const done: string[] = [];
  const prisma = {
    user: { findMany: async () => [{ id: A, username: 'shop', tgPrefs: null, sessionVersion: 1, tgSessionVersion: 1 }], updateMany: async () => ({ count: 0 }) },
    buyRequest: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === L1 ? { sellerId: A } : { sellerId: B }) },
  };
  const requests = { accept: async (s: string, id: string) => void done.push(`accept ${s} ${id}`), decline: async () => void done.push('decline') };
  const svc = new TelegramWidgetService(prisma as never, { client: null } as never, {} as never, requests as never, {} as never, {} as never);
  await saveWidgetCtx({ client: null } as never, CHAT, 71, { notice: { k: 'r', id: L1, ns: { h: 'x', t: 'Плащ', a: 1 } } });
  await svc.query({ id: 'n1', from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, message_id: 71, data: 'na' });
  await svc.query({ id: 'n2', from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, message_id: 71, data: 'nx' });
  assert.deepEqual(done, [`accept ${A} ${L1}`], 'the second tap finds it answered');
  const last = JSON.parse(String([...calls].reverse().find((c) => c.method === 'answerWidgetQuery')!.body.data));
  assert.match(last.d, /Принято/);
  assert.equal(last.a, 0);
  // A card about a request of another seller (not this chat's) does nothing.
  await saveWidgetCtx({ client: null } as never, CHAT, 72, { notice: { k: 'r', id: L2, ns: { a: 1 } } });
  await svc.query({ id: 'n3', from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, message_id: 72, data: 'na' });
  assert.equal(done.length, 1);
});

test('a counter-offer is answered only by its buyer', async () => {
  const done: string[] = [];
  const prisma = {
    user: { findMany: async () => [{ id: A, username: 'me', tgPrefs: null, sessionVersion: 1, tgSessionVersion: 1 }], updateMany: async () => ({ count: 0 }) },
    offer: { findMany: async () => [{ id: L1, amount: 90, listing: { title: 'Плащ' } }], findUnique: async () => ({ buyerId: A }) },
    buyRequest: { findMany: async () => [] },
  };
  const offers = { accept: async (a: string, id: string) => void done.push(`accept ${a} ${id}`), decline: async () => void done.push('decline') };
  const svc = new TelegramWidgetService(prisma as never, { client: null } as never, {} as never, {} as never, offers as never, {} as never);
  const tap = (data: string) => svc.query({ id: data, from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, message_id: 80, data });
  await tap('b');
  await tap('ba:0');
  await tap('ba:5');
  assert.deepEqual(done, [`accept ${A} ${L1}`]);
});

test('notifications that wait for an answer go out as deal cards, else as before', async () => {
  process.env.TELEGRAM_BOT_USERNAME = 'ichiba_bot';
  const prisma = {
    user: {
      findUnique: async () => ({ username: 'shop', tgChatId: String(CHAT), tgPrefs: null, deletedAt: null, blockedAt: null, sessionVersion: 1, tgSessionVersion: 1 }),
      count: async () => 1,
    },
    buyRequestItem: { findFirst: async () => null },
  };
  const notifier = new TelegramNotifier(prisma as never, { client: null } as never);
  await notifier.notification(A, 'request_new', { requestId: L1, buyer: 'anya', title: 'Плащ', price: 120 });
  const card = calls.find((c) => c.method === 'sendWidget');
  assert.ok(card, 'a card');
  assert.equal(card!.body.allow_queries, true);
  assert.equal(card!.body.parse_mode, undefined, 'the caption is plain text');
  calls = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const method = String(url).split('/').pop()!;
    calls.push({ method, body: JSON.parse(init.body) });
    const body = method === 'sendWidget' ? { ok: false, error_code: 400, description: 'Bad Request: method not found' } : { ok: true, result: { message_id: 9 } };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  await notifier.notification(A, 'request_new', { requestId: L1, buyer: 'anya', title: 'Плащ', price: 120 });
  assert.ok(calls.some((c) => c.method === 'sendMessage' && /Хотят купить/.test(String(c.body.text))), 'falls back to the classic message');
});

// ---------- every reply is a card; sign-up from the bot ----------

test('the bot’s text and keyboards become a card: heading, lines, links; only «Мой магазин» commands survive', () => {
  process.env.JWT_SECRET = 'test-secret-for-cards';
  const kb = [[{ text: 'Открыть', url: 'https://ichiba.by/deals/1' }], [{ text: '✨ Мой магазин', callback_data: signed(CHAT, 'W') }], [{ text: 'old', callback_data: signed(CHAT, `H:${L1}`) }], [{ text: 'local', url: 'http://localhost/x' }]];
  const { state } = htmlToCard(CHAT, '🛍 <b>Хотят купить</b>\n\n@anya &lt;3 хочет купить «Плащ» за <b>120 BYN</b>', kb);
  assert.equal(state.h, '🛍 Хотят купить');
  assert.deepEqual(state.x, ['@anya <3 хочет купить «Плащ» за 120 BYN']);
  assert.deepEqual(state.l, [['Открыть', 'https://ichiba.by/deals/1']]);
  assert.deepEqual(state.c, [['✨ Мой магазин', 'W']]);
  const item = htmlToCard(CHAT, 'x', [[{ text: '✨ Открыть вещь', callback_data: signed(CHAT, `W:${L1}`) }]]);
  assert.equal(item.item, L1);
  assert.deepEqual(item.state.c, [['✨ Открыть вещь', 'Wv']]);
  assert.equal(htmlToCard(CHAT + 1, 'x', [[{ text: 'forged', callback_data: signed(CHAT, 'W') }]]).state.c, undefined, 'a button signed for another chat is dropped');
  const html = renderWith(CARD_HTML, htmlToCard(CHAT, '🏮 <b>Ichiba</b>\n\n<script>x</script>', kb).state);
  assert.ok(!html.includes('<script>'));
  for (const h of html.match(/onclick="[^"]*"/g) ?? []) assert.match(h, /^onclick="(go|cq)\(\d+\)"$/, h);
});

test('sign-up from the bot: creates the account once, links the chat, opens the menu', async () => {
  const users: Array<Record<string, unknown>> = [];
  const prisma = {
    user: {
      findMany: async ({ where }: { where: { tgChatId: string } }) => users.filter((u) => u.tgChatId === where.tgChatId).map((u) => ({ ...u, tgPrefs: null })),
      findFirst: async ({ where }: { where: { telegramId: string } }) => users.find((u) => u.telegramId === where.telegramId) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id)!,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(users.find((u) => u.id === where.id)!, data),
      updateMany: async () => ({ count: 0 }),
    },
    listing: { groupBy: async () => [] },
    buyRequest: { count: async () => 0, findMany: async () => [] },
    offer: { count: async () => 0, findMany: async () => [] },
  };
  let created = 0;
  const auth = {
    signupFromTelegram: async (telegramId: string, hint: string) => {
      created++;
      const u = { id: A, username: hint || 'tg', telegramId, sessionVersion: 0, blockedAt: null, tgSessionVersion: null, tgChatId: null };
      users.push(u);
      return { user: u, isNew: true };
    },
  };
  const svc = new TelegramWidgetService(prisma as never, { client: null } as never, {} as never, {} as never, {} as never, {} as never, auth as never);
  await saveWidgetCtx({ client: null } as never, CHAT, 90, { card: { ns: { h: 'Ichiba', c: [['✨ Принимаю и создаю аккаунт', 'RC']] } } });
  const tap = (id: string, data: string, from = CHAT) => svc.query({ id, from: { id: from, username: 'new_seller' }, chat: { id: from, type: 'private' }, message_id: 90, data });
  await tap('r1', 'RC');
  await tap('r2', 'RC');
  assert.equal(created, 1, 'one account, however many taps');
  assert.equal(users[0].tgChatId, String(CHAT), 'the chat is linked');
  assert.equal(users[0].tgSessionVersion, 0, 'under the account’s current session version');
  const card = JSON.parse(String([...calls].reverse().find((c) => c.method === 'answerWidgetQuery')!.body.data));
  assert.match(card.d, /создан и подключён/);
  assert.deepEqual(card.c, [], 'the button is gone');
  assert.ok(calls.some((c) => c.method === 'sendWidget'), 'the menu opens');
});

test('/start from a Telegram not linked yet answers with a card that offers to sign up', async () => {
  const prisma = { user: { findMany: async () => [], findFirst: async () => null, updateMany: async () => ({ count: 0 }) } };
  const notifier = { unlinkChat: async () => ({ count: 0 }), send: async () => null };
  const bot = new TelegramBotService(prisma as never, notifier as never, {} as never, {} as never, {} as never, { clearSlot: async () => undefined } as never, { client: null } as never, {} as never);
  process.env.APP_URL = 'https://ichiba.by';
  await bot.handle({ update_id: 99_001, message: { message_id: 1, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '/start' } });
  const card = calls.find((c) => c.method === 'sendWidget' && c.body.chat_id === CHAT && String(c.body.caption).startsWith('🏮 Ichiba'));
  assert.ok(card, 'a card, not a text message');
  const state = JSON.parse(String(card!.body.chat_data));
  assert.deepEqual(state.c, [['✨ Принимаю и создаю аккаунт', 'RC']]);
  assert.ok(state.l.some((l: string[]) => l[1] === 'https://ichiba.by/?auth=1'), 'and the site’s sign-up');
  assert.ok(state.l.some((l: string[]) => l[1] === 'https://ichiba.by/privacy'), 'with the policy');
});

test('every notification the bot sends fits a card whole (1 KB of state, Cyrillic included)', async () => {
  const { notificationMessage, notificationPath, openLabel } = await import('../../src/telegram/texts.js');
  const { packState } = await import('../../src/telegram/widget-store.js');
  process.env.APP_URL = 'https://ichiba.by';
  const types = ['request_new', 'request_accepted', 'request_declined', 'request_cancelled', 'request_expired', 'dispute_opened', 'dispute_resolved', 'deal_handed_over', 'deal_in_transit', 'deal_completed', 'brand_approved', 'brand_rejected', 'journal_published', 'journal_rejected', 'catalog_approved', 'catalog_rejected', 'price_drop', 'item_reserved', 'item_sold', 'item_available', 'offer_new', 'offer_countered', 'offer_accepted', 'offer_declined', 'offer_expired', 'offer_likers', 'offer_auto_accepted', 'follow_new_item', 'listing_blocked', 'listing_unblocked', 'listing_scheduled_published', 'listing_schedule_failed', 'auction_bid', 'auction_outbid', 'auction_won', 'auction_runner_up', 'auction_sold', 'auction_bought_out', 'auction_no_sale', 'review_new', 'review_reply', 'review_request', 'telegram_linked'];
  const p = { title: 'Длинное название вещи на кириллице, примерно на шестьдесят символов', buyer: 'buyer_name', seller: 'seller_name', by: 'someone', price: 1200, amount: 950, newPrice: 900, oldPrice: 1200, reason: 'Причина, объяснённая модератором подробно, в несколько десятков слов, чтобы проверить длинный текст', requestId: L1, listingId: L2, rating: 5, brand: 'Бренд', note: 'Комментарий администратора к решению', trackingNumber: 'RB123456789BY' };
  for (const type of types) {
    const { state } = htmlToCard(CHAT, notificationMessage(type, p), [[{ text: openLabel(type), url: `https://ichiba.by${notificationPath(type, p)}` }]]);
    const json = packState(state);
    assert.ok(Buffer.byteLength(json) <= 1024, type);
    assert.ok(!json.includes('Слишком много данных'), `${type} fits`);
  }
});
