import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import zlib from 'node:zlib';
import { WIDGET_HTML } from '../../src/telegram/widget-html.js';
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
