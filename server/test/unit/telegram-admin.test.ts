import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { allowlisted, lockedOutFor, logPrefsOf, sessionMs, unlocked } from '../../src/telegram/admin/access.js';
import { groupOf, logLine } from '../../src/telegram/admin/activity-labels.js';
import { AdminApi } from '../../src/telegram/admin/api.js';
import { parseValue } from '../../src/telegram/admin/db.js';
import { ROUTES } from '../../src/telegram/admin/routes.js';
import { AdminStore } from '../../src/telegram/admin/store.js';
import { fit, pager } from '../../src/telegram/admin/ui.js';
import type { RedisService } from '../../src/redis/redis.js';

const H = 3600_000;

test('a bot session holds only until it expires or the account’s sessions are reset', () => {
  const now = Date.now();
  const s = { session: { until: new Date(now + H).toISOString(), sv: 3, chat: '42' } };
  assert.equal(unlocked(s, 3, '42', now), true);
  assert.equal(unlocked(s, 4, '42', now), false, 'a password reset / block bumps sessionVersion and closes the bot');
  assert.equal(unlocked(s, 3, '42', now + 2 * H), false);
  assert.equal(unlocked(s, 3, '43', now), false, 'a re-link to another Telegram does not carry the unlock');
  assert.equal(unlocked({ session: { until: new Date(now + H).toISOString(), sv: 3 } }, 3, '42', now), false, 'an unlock from before the chat binding is void');
  assert.equal(unlocked({}, 0, '42', now), false);
  assert.equal(unlocked({ session: null }, 0, '42', now), false);
});

test('wrong passwords lock the bot for a while', () => {
  const now = Date.now();
  assert.equal(lockedOutFor({ failed: { n: 4, until: null } }, now), 0);
  assert.ok(lockedOutFor({ failed: { n: 0, until: new Date(now + 60_000).toISOString() } }, now) > 0);
  assert.equal(lockedOutFor({ failed: { n: 0, until: new Date(now - 1).toISOString() } }, now), 0);
});

test('session length is bounded and the Telegram allowlist is a second gate', () => {
  process.env.TELEGRAM_ADMIN_SESSION_HOURS = '1000';
  assert.equal(sessionMs(), 72 * H);
  process.env.TELEGRAM_ADMIN_SESSION_HOURS = '';
  assert.equal(sessionMs(), 12 * H);
  process.env.TELEGRAM_ADMIN_IDS = '';
  assert.equal(allowlisted(5), true);
  process.env.TELEGRAM_ADMIN_IDS = '111, 222';
  assert.equal(allowlisted(222), true);
  assert.equal(allowlisted(5), false);
  process.env.TELEGRAM_ADMIN_IDS = '';
});

test('journal notifications: on for everything until changed', () => {
  assert.deepEqual(logPrefsOf({}), { mode: 'instant', off: [], digestAt: null });
  assert.equal(logPrefsOf({ log: { mode: 'bogus' as 'off', off: [] } }).mode, 'instant');
  assert.equal(groupOf('listing_published'), 'listings');
  assert.equal(groupOf('deal_completed'), 'sales');
  assert.equal(groupOf('listing_sold'), 'sales');
  assert.equal(groupOf('price_changed'), 'prices');
  assert.equal(groupOf('offer_accepted'), 'offers');
  assert.equal(groupOf('profile_edited'), 'account');
});

test('a journal line escapes what sellers typed', () => {
  const line = logLine({ at: new Date(), action: 'listing_published', detail: '<script>', market: 'resale', seller: { username: 'a<b', brand: null }, listing: { id: 'x', title: 'Куртка <b>' } });
  assert.doesNotMatch(line, /<script>|<b>'|a<b/);
  assert.match(line, /&lt;script&gt;/);
  assert.match(line, /Выставил/);
});

test('DB values are parsed by the column type', () => {
  const col = (type: string, extra: object = {}) => ({ name: 'c', type, nullable: true, enumValues: null, pk: false, secret: false, ...extra });
  assert.deepEqual(parseValue(col('text'), 'NULL'), { ok: true, value: null });
  assert.equal(parseValue(col('text', { nullable: false }), 'null').ok, false);
  assert.deepEqual(parseValue(col('text[]'), '["a","b"]'), { ok: true, value: ['a', 'b'] });
  assert.equal(parseValue(col('text[]'), 'a,b').ok, false);
  assert.deepEqual(parseValue(col('boolean'), 'да'), { ok: true, value: 'true' });
  assert.equal(parseValue(col('jsonb'), '{oops').ok, false);
  assert.equal(parseValue(col('"Role"', { enumValues: ['USER', 'ADMIN'] }), 'ROOT').ok, false);
  assert.deepEqual(parseValue(col('text'), ' hi '), { ok: true, value: ' hi ' });
});

test('screens stay within Telegram’s limits', () => {
  const long = `<b>${'я'.repeat(5000)}</b> &amp;`;
  const out = fit(long);
  assert.ok(out.length <= 4096);
  assert.doesNotMatch(out, /<b>|<\/b>/, 'a cut never leaves a tag open');
  assert.deepEqual(pager('x', {}, 'i', 0, 1), []);
  assert.equal(pager('x', {}, 'i', 1, 3)[1].text, '2 / 3');
});

test('every button leads to a route that exists', () => {
  for (const r of ['home', 'overview', 'reports', 'disputes', 'complaints', 'listings', 'users', 'user', 'brands', 'articles', 'log', 'imports', 'db', 'db.table', 'db.row']) assert.ok(ROUTES[r], r);
});

test('button routes are per chat and refuse anything malformed', async () => {
  const store = new AdminStore({ client: null } as unknown as RedisService);
  const id = await store.saveScreen('1', [{ r: 'home' }, { r: 'users', p: { q: 'x' } }]);
  assert.deepEqual(await store.route('1', `ad:${id}:1`), { r: 'users', p: { q: 'x' } });
  assert.equal(await store.route('2', `ad:${id}:1`), null, 'another chat finds nothing');
  assert.equal(await store.route('1', `ad:${id}:9`), null);
  assert.equal(await store.route('1', `ad:../x:1`), null);
  assert.equal(await store.once('k', 60), true);
  assert.equal(await store.once('k', 60), false);
});

test('the bot’s API client reaches only the admin API', async () => {
  const api = new AdminApi(new JwtService({ secret: 'x' }));
  const admin = { id: 'a', username: 'a', role: 'ADMIN' as const, sessionVersion: 0 };
  await assert.rejects(api.call(admin, 'GET', '/auth/me'), /Недоступно/);
  await assert.rejects(api.call(admin, 'POST', '/listings'), /Недоступно/);
  await assert.rejects(api.call(admin, 'GET', '/admin/../auth/me'), /Недоступно/);
  await assert.rejects(api.call(admin, 'GET', '/admin/db/%2e%2e'), /Недоступно/);
  await assert.rejects(api.call(admin, 'GET', '//evil.example/admin/x'), /Недоступно/);
});

test('the bot’s tokens open a session only from loopback and only on the admin API', async () => {
  const { AuthGuard, TG_ADMIN_TYP } = await import('../../src/auth/auth.guard.js');
  const jwt = new JwtService({ secret: 'x' });
  const prisma = { user: { findUnique: async () => ({ deletedAt: null, blockedAt: null, sessionVersion: 0 }) } };
  const guard = new AuthGuard(jwt, { getAllAndOverride: () => true } as never, prisma as never);
  const token = await jwt.signAsync({ sub: 'u-tg', username: 'a', role: 'ADMIN', sv: 0, typ: TG_ADMIN_TYP });
  const run = async (remote: string, url: string) => {
    const req = { cookies: { ichiba_token: token }, headers: {}, socket: { remoteAddress: remote }, originalUrl: url } as Record<string, unknown>;
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as never);
    return (req.user as { id: string } | undefined)?.id ?? null;
  };
  assert.equal(await run('127.0.0.1', '/admin/stats'), 'u-tg');
  assert.equal(await run('::ffff:127.0.0.1', '/ai/status'), 'u-tg');
  assert.equal(await run('10.0.0.5', '/admin/stats'), null, 'from the network: not a session');
  assert.equal(await run('127.0.0.1', '/auth/me'), null, 'outside the admin API: not a session');
  assert.equal(await run('127.0.0.1', '/admin/../auth/me'), null);
});

test('ADMIN_BOT_API_URL may only point at this machine', async () => {
  const api = new AdminApi(new JwtService({ secret: 'x' }));
  const admin = { id: 'a', username: 'a', role: 'ADMIN' as const, sessionVersion: 0 };
  for (const bad of ['https://evil.example', 'http://10.0.0.1:4000', 'http://u:p@127.0.0.1:1']) {
    process.env.ADMIN_BOT_API_URL = bad;
    await assert.rejects(api.call(admin, 'GET', '/admin/stats'), /должен указывать/);
  }
  delete process.env.ADMIN_BOT_API_URL;
});

test('the panel widget fits Telegram’s size limits and its script parses', async () => {
  const { deflateSync } = await import('node:zlib');
  const { ADMIN_WIDGET_HTML: html } = await import('../../src/telegram/admin/widget-html.js');
  assert.ok(Buffer.byteLength(html) <= 32768);
  assert.ok(deflateSync(Buffer.from(html), { level: 9 }).length <= 4096, 'zlib level 9 ≤ 4096 bytes');
  assert.ok(!html.includes('\u0000'));
  assert.doesNotThrow(() => new Function(html.split('<script>')[1].split('</script>')[0]));
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|eval\(/, 'data never becomes markup');
});

test('a screen becomes a widget model within chat_data + public_data', async () => {
  const { toModel, split } = await import('../../src/telegram/admin/widget-model.js');
  const { btn, tabs, pager } = await import('../../src/telegram/admin/ui.js');
  const text = [
    '📊 <b>Обзор</b>',
    '',
    '👥 Пользователи: <b>1 204</b> (+31 за неделю)',
    '🛡 Открытые жалобы: <b>3</b> ⚠️',
    '',
    '<b>Вещи по статусам</b>',
    '<code>▰▰▰▰▰▰▰▰</code> 812 · В продаже',
    '<code>▰▰▱▱▱▱▱▱</code> 120 · Продана',
    '',
    `«${'очень длинная строка <script>alert(1)</script> '.repeat(60)}»`,
    '<a href="https://ichiba.by/u/x">@x</a> пароль <tg-spoiler>secret</tg-spoiler>',
  ].join('\n');
  const rows = [...tabs([['OPEN', 'Открытые'], ['DONE', 'Решённые']] as const, 'OPEN', 'reports'), [btn('✅ Разблокировать', 'a'), btn('🚫 Заблокировать', 'b')], pager('reports', {}, 'i', 1, 3), [{ text: 'Сайт', url: 'https://ichiba.by/admin' }], [btn('🔄', 'reports'), btn('🏠 Меню', 'home')]];
  const { model, routes } = toModel({ text, rows }, 7, '⚠️ Не получилось');
  assert.equal(model.h, '📊 Обзор');
  assert.equal(model.ne, 1);
  assert.deepEqual(model.t, [['Открытые', 0, 1], ['Решённые', 1, 0]]);
  const tiles = model.b.find((b) => b[0] === 'k')![1] as unknown[][];
  assert.deepEqual(tiles[0].slice(0, 3), ['Пользователи', '1 204', '(+31 за неделю)']);
  assert.equal(tiles[1][3], 1, 'a warning tile');
  assert.deepEqual(model.b.find((b) => b[0] === 'r')![1], [['В продаже', 812], ['Продана', 120]]);
  assert.deepEqual(model.p!.map((x) => x[1] === null), [false, true, false]);
  assert.ok(model.a.some((row) => row.some(([, t]) => t === 'https://ichiba.by/admin')));
  assert.ok(!model.a.flat().some(([l]) => l === '🔄'), 'the footer has ↻');
  assert.equal(model.a[0][0][2], 'ok');
  assert.equal(model.a[0][1][2], 'd');
  assert.equal(model.u, 1, 'the long text was cut: «Целиком» is offered');
  assert.ok(routes.length >= 6);
  const json = JSON.stringify(model);
  assert.doesNotMatch(json, /<script>|<a /, 'only the widget’s own tags survive');
  const [c, p] = split(model);
  assert.ok(Buffer.byteLength(c) <= 1024 && Buffer.byteLength(p) <= 1024);
  assert.ok(c.startsWith('7|') && p.startsWith('7|'));
  assert.deepEqual(JSON.parse(c.slice(2) + p.slice(2)), model);
});

test('every panel screen fits the widget whatever its text', async () => {
  const { toModel, split } = await import('../../src/telegram/admin/widget-model.js');
  const { btn } = await import('../../src/telegram/admin/ui.js');
  const rows = Array.from({ length: 12 }, (_, i) => [btn(`Очень длинная кнопка номер ${i} с названием вещи и ником продавца`, 'x', { i })]);
  const { model } = toModel({ text: `Заголовок\n${'Ж'.repeat(4000)}\n${'<b>Ключ</b>: значение\n'.repeat(80)}`, rows }, 123456789);
  assert.doesNotThrow(() => split(model));
});
