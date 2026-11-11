// E2E for the shop bot (telegram/shop.ts, interest.ts, telegram.ts): linking, the menu, managing an item, a price,
// interest pings, forged and replayed updates, a password reset voiding the link. Telegram is a stand-in served by
// this script (TELEGRAM_API_URL), so the real bot and its webhook are never touched.
//
// 1. A migrated test database (prisma dev --name ichiba-test --db-port 51300).
// 2. The built server against it, with the stand-in bot:
//    PORT=4100 DATABASE_URL=… DIRECT_URL=… JWT_SECRET=e2e-tg-secret APP_URL=https://ichiba.test TELEGRAM_BOT_TOKEN=1:e2e
//    TELEGRAM_BOT_USERNAME=ichiba_e2e_bot TELEGRAM_API_URL=http://127.0.0.1:4299 node dist/main.js
// 3. E2E_API=http://127.0.0.1:4100 DATABASE_URL=… JWT_SECRET=e2e-tg-secret node _e2e-telegram-shop.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const API = process.env.E2E_API ?? 'http://127.0.0.1:4100';
const SECRET = process.env.JWT_SECRET;
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// ---------- the stand-in Telegram ----------
const calls = [];
let messageId = 100;
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    calls.push({ method, body: body ? JSON.parse(body) : {} });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: method === 'getUpdates' ? [] : { message_id: ++messageId } }));
  });
});
await new Promise((r) => fake.listen(Number(process.env.FAKE_TG_PORT ?? 4299), '127.0.0.1', r));

const textOf = (c) => String(c.body.text ?? c.body.caption ?? c.body.media?.caption ?? '');
const keyboardOf = (c) => (c.body.reply_markup?.inline_keyboard ?? []).flat();
async function waitFor(pred, what, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const hit = calls.find(pred);
    if (hit) return hit;
    await sleep(100);
  }
  ok(false, `waited for: ${what}`);
  return null;
}
const mark = () => calls.length;
const after = (i) => calls.slice(i);
const buttonIn = (from, text) => after(from).flatMap(keyboardOf).find((b) => b.text?.includes(text));

// ---------- updates as Telegram would post them ----------
const CHAT = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const webhookSecret = createHmac('sha256', SECRET).update('telegram-webhook').digest('hex').slice(0, 48);
let updateId = Math.floor(Math.random() * 1e6);
async function post(update, secret = webhookSecret) {
  const r = await fetch(`${API}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) }, body: JSON.stringify(update) });
  return r.json();
}
const say = (text, chat = CHAT) => post({ update_id: ++updateId, message: { message_id: ++messageId, chat: { id: chat, type: 'private' }, from: { id: chat, username: 'e2e_seller' }, text } });
const tap = (data, chat = CHAT, photo = false) =>
  post({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: { id: chat }, data, message: { message_id: messageId, chat: { id: chat, type: 'private' }, ...(photo ? { photo: [{}] } : {}) } } });

// ---------- people and items ----------
const hash = await bcrypt.hash('password123', 10);
const tag = randomUUID().slice(0, 6);
async function user(name) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO "User" (id, username, email, "emailVerifiedAt", "passwordHash", "privacyAcceptedAt", "privacyVersion", "onboardedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, now(), $4, now(), '2026-10', now(), now(), now())`,
    [id, `${name}_${tag}`, `${name}_${tag}@ichiba.test`, hash],
  );
  return { id, username: `${name}_${tag}`, email: `${name}_${tag}@ichiba.test` };
}
async function item(sellerId, title, price) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO "Listing" (id, "sellerId", status, title, category, price, condition, "deliveryOptions", "publishedAt", "liftedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'PUBLISHED', $3, 'outerwear', $4, 'GOOD', '{IN_PERSON}', now() - interval '3 days', now(), now(), now())`,
    [id, sellerId, title, price],
  );
  return id;
}
const seller = await user('tgseller');
const other = await user('tgother');
const buyer = await user('tgbuyer');
const mine = await item(seller.id, `Плащ e2e ${tag}`, 100);
const foreign = await item(other.id, `Чужая куртка ${tag}`, 200);

async function session(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'password123' }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return async (path, { method, body } = {}) => {
    const res = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, data: t ? JSON.parse(t) : null };
  };
}

/** A button as the bot signs it (callbacks.ts) — what a client could only send if the secret leaked. */
const sign = (data, chat = CHAT) => `${data}|${createHmac('sha256', createHmac('sha256', SECRET).update('telegram-callback').digest()).update(`${chat}|${data}`).digest('base64url').slice(0, 11)}`;

const tgRow = async (id) => (await db.query(`SELECT "tgChatId", "tgSessionVersion", "sessionVersion" FROM "User" WHERE id = $1`, [id])).rows[0];
const status = async (id) => (await db.query(`SELECT status, price FROM "Listing" WHERE id = $1`, [id])).rows[0];

// ---------- linking ----------
{
  const me = await session(seller.email);
  const link = await me('/telegram/link', { method: 'POST' });
  ok(link.status === 200 && /^https:\/\/t\.me\/ichiba_e2e_bot\?start=/.test(link.data?.url), 'a one-time link from the settings page');
  const token = link.data.url.split('start=')[1];

  ok((await post({ update_id: ++updateId, message: { message_id: 1, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: `/start ${token}` } }, 'wrong-secret')).ok === false, 'an update without the right secret header is refused');
  ok((await tgRow(seller.id)).tgChatId === null, '…and links nothing');

  let from = mark();
  await say(`/start ${token}`, CHAT);
  await waitFor((c) => calls.indexOf(c) >= from && /Аккаунт @tgseller_.* подключён/.test(textOf(c)), 'the welcome');
  const row = await tgRow(seller.id);
  ok(row.tgChatId === String(CHAT) && row.tgSessionVersion === row.sessionVersion, 'the chat is linked under the current session version');
  const { rows: n } = await db.query(`SELECT 1 FROM "Notification" WHERE "userId" = $1 AND type = 'telegram_linked'`, [seller.id]);
  ok(n.length === 1, 'the owner sees «Подключён Telegram» on the site');

  from = mark();
  await say(`/start ${token}`, CHAT + 1);
  await waitFor((c) => calls.indexOf(c) >= from && /устарела|использована/.test(textOf(c)), 'a used link refused');
  ok((await tgRow(seller.id)).tgChatId === String(CHAT), 'a used link can not move the shop to another chat');
}

// ---------- the menu and an item ----------
let from = mark();
await say('/menu');
await waitFor((c) => calls.indexOf(c) >= from && /Магазин @tgseller_/.test(textOf(c)), 'the shop menu');
ok(/В продаже: <b>1<\/b>/.test(after(from).map(textOf).join('\n')), 'the menu counts the shop’s own items only');

const onSale = buttonIn(from, 'В продаже');
from = mark();
await tap(onSale.callback_data);
await waitFor((c) => calls.indexOf(c) >= from && /В продаже · @tgseller_/.test(textOf(c)), 'the list');
const listButtons = after(from).flatMap(keyboardOf).map((b) => b.text).join(' | ');
ok(listButtons.includes('Плащ e2e') && !listButtons.includes('Чужая куртка'), 'the list shows only the shop’s items');

const card = buttonIn(from, 'Плащ e2e');
from = mark();
await tap(card.callback_data);
await waitFor((c) => calls.indexOf(c) >= from && /Плащ e2e/.test(textOf(c)) && /В продаже/.test(textOf(c)), 'the item card');

// ---------- interest: a ♡ and a follower, without the buyer’s name ----------
{
  const b = await session(buyer.email);
  const f0 = mark();
  ok((await b(`/favorites/${mine}`, { method: 'POST', body: { source: 'product' } })).status < 300, 'the buyer saves the item');
  const ping = await waitFor((c) => calls.indexOf(c) >= f0 && /добавили в избранное/.test(textOf(c)), 'the ♡ ping');
  ok(ping && !textOf(ping).includes(buyer.username), 'the ping never names the buyer');
  await b(`/favorites/${mine}`, { method: 'DELETE' });
  await b(`/favorites/${mine}`, { method: 'POST', body: { source: 'product' } });
  await sleep(1500);
  ok(after(f0).filter((c) => /добавили в избранное/.test(textOf(c))).length === 1, 'one ♡ ping per item an hour');
  const f1 = mark();
  await b(`/follows/${seller.username}`, { method: 'POST' });
  await waitFor((c) => calls.indexOf(c) >= f1 && /Новый подписчик/.test(textOf(c)), 'the follower ping');
}

// ---------- forged buttons ----------
{
  const f0 = mark();
  await tap(`H:${foreign}`);
  await sleep(800);
  ok(after(f0).some((c) => c.method === 'answerCallbackQuery' && /устарела/.test(String(c.body.text))), 'an unsigned button is refused');
  // Even with a valid signature (as if the secret leaked), a foreign item stays untouched.
  await tap(sign(`H:${foreign}`));
  await tap(sign(`S:${foreign}`));
  await sleep(1000);
  ok((await status(foreign)).status === 'PUBLISHED', 'a foreign item is never hidden or sold, signature or not');
  const f1 = mark();
  await tap(sign(`H:${mine}`), CHAT + 5);
  await sleep(800);
  ok(after(f1).some((c) => c.method === 'answerCallbackQuery' && /устарела/.test(String(c.body.text))) && (await status(mine)).status === 'PUBLISHED', 'a button signed for one chat does nothing in another');
}

// ---------- a price, typed and confirmed ----------
{
  const f0 = mark();
  await tap(sign(`p:${mine}`));
  await waitFor((c) => calls.indexOf(c) >= f0 && c.body.reply_markup?.force_reply, 'the price question');
  const f1 = mark();
  await say('85 BYN');
  const confirm = await waitFor((c) => calls.indexOf(c) >= f1 && /цену <b>85 BYN<\/b>/.test(textOf(c)), 'the price confirmation');
  ok((await status(mine)).price === 100, 'not changed before the confirmation');
  const yes = keyboardOf(confirm).find((b) => b.text.includes('Да'));
  await tap(yes.callback_data);
  await sleep(1500);
  ok((await status(mine)).price === 85, 'the price is changed after «Да»');
}

// ---------- hide, with a confirmation ----------
{
  const f0 = mark();
  await tap(sign(`h:${mine}`));
  const ask = await waitFor((c) => calls.indexOf(c) >= f0 && /Снять .* с продажи\?/.test(textOf(c)), 'the hide question');
  ok((await status(mine)).status === 'PUBLISHED', 'one tap only asks');
  await tap(keyboardOf(ask).find((b) => b.text.includes('Да')).callback_data);
  await sleep(1500);
  ok((await status(mine)).status === 'HIDDEN', 'hidden after the second tap');
}

// ---------- replay ----------
{
  const before = mark();
  const update = { update_id: ++updateId, message: { message_id: 7, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '/status' } };
  await post(update);
  await post(update);
  await sleep(1200);
  ok(after(before).filter((c) => /Подключено:/.test(textOf(c))).length === 1, 'a re-delivered update is answered once');
}

// ---------- a group chat gets nothing ----------
{
  const before = mark();
  await post({ update_id: ++updateId, message: { message_id: 8, chat: { id: -CHAT, type: 'group' }, from: { id: CHAT }, text: '/menu' } });
  await sleep(800);
  ok(!after(before).some((c) => /Магазин @/.test(textOf(c))), 'no shop menu in a group chat');
}

// ---------- a password reset voids the link ----------
{
  await db.query(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE id = $1`, [seller.id]);
  const before = mark();
  await tap(sign(`H:${mine}`));
  await sleep(1200);
  ok(after(before).some((c) => c.method === 'answerCallbackQuery' && /не подключён/.test(String(c.body.text))), 'after a password reset the chat can no longer act');
  ok((await tgRow(seller.id)).tgChatId === null, '…and the stale link is cleared');
  ok((await status(mine)).status === 'HIDDEN', 'nothing was changed');
}

fake.close();
await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
