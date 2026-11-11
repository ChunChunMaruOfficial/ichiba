// E2E for the shop widget (telegram/widget.ts): /menu sends the widget, taps arrive as widget_query updates, the bot
// answers with the next state and acts through the same services as the site. Telegram is a stand-in served here.
// Setup as in _e2e-telegram-shop.mjs (built server with TELEGRAM_API_URL=http://127.0.0.1:4299), then:
// E2E_API=http://127.0.0.1:4150 DATABASE_URL=… JWT_SECRET=… node _e2e-telegram-widget.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import zlib from 'node:zlib';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const API = process.env.E2E_API ?? 'http://127.0.0.1:4150';
const SECRET = process.env.JWT_SECRET;
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const calls = [];
let mid = 500;
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    calls.push({ method, body: body ? JSON.parse(body) : {} });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: { message_id: ++mid } }));
  });
});
await new Promise((r) => fake.listen(Number(process.env.FAKE_TG_PORT ?? 4299), '127.0.0.1', r));
async function waitFor(pred, what, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const hit = [...calls].reverse().find(pred);
    if (hit) return hit;
    await sleep(100);
  }
  ok(false, `waited for: ${what}`);
  return null;
}

const CHAT = 910_000_000 + Math.floor(Math.random() * 1_000_000);
const secret = createHmac('sha256', SECRET).update('telegram-webhook').digest('hex').slice(0, 48);
let upd = Math.floor(Math.random() * 1e6);
const post = (u) => fetch(`${API}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(u) });
const say = (text) => post({ update_id: ++upd, message: { message_id: ++mid, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text } });
let qn = 0;
async function tap(data, messageId, chat = { id: CHAT, type: 'private' }, from = CHAT) {
  const id = `wq${++qn}`;
  await post({ update_id: ++upd, widget_query: { id, from: { id: from }, chat, message_id: messageId, chat_instance: '1', type: { type: 'data' }, data } });
  const a = await waitFor((c) => c.method === 'answerWidgetQuery' && c.body.widget_query_id === id, `answer to ${data}`);
  return a ? JSON.parse(a.body.data) : null;
}

// ---------- a shop with one item, linked to the chat ----------
const tag = randomUUID().slice(0, 6);
const sellerId = randomUUID();
const otherId = randomUUID();
const hash = await bcrypt.hash('password123', 10);
for (const [id, name] of [[sellerId, `wseller_${tag}`], [otherId, `wother_${tag}`]]) {
  await db.query(`INSERT INTO "User" (id, username, email, "emailVerifiedAt", "passwordHash", "privacyAcceptedAt", "privacyVersion", "onboardedAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,now(),$4,now(),'2026-10',now(),now(),now())`, [id, name, `${name}@ichiba.test`, hash]);
}
const item = randomUUID();
const foreign = randomUUID();
for (const [id, seller, title] of [[item, sellerId, `Плащ <b>${tag}</b>`], [foreign, otherId, `Чужая ${tag}`]]) {
  await db.query(`INSERT INTO "Listing" (id,"sellerId",status,title,category,price,condition,"deliveryOptions","publishedAt","liftedAt","createdAt","updatedAt") VALUES ($1,$2,'PUBLISHED',$3,'outerwear',100,'GOOD','{IN_PERSON}',now() - interval '3 days',now(),now(),now())`, [id, seller, title]);
}
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: `wseller_${tag}@ichiba.test`, password: 'password123' }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const link = await (await fetch(`${API}/telegram/link`, { method: 'POST', headers: { cookie } })).json();
await say(`/start ${link.url.split('start=')[1]}`);
await waitFor((c) => /подключён/.test(String(c.body.text ?? '')), 'linked');

// ---------- /menu sends the widget ----------
await say('/menu');
const sent = await waitFor((c) => c.method === 'sendWidget', 'sendWidget');
ok(sent && sent.body.allow_queries === true && sent.body.protect_content === true, 'the widget is sent with queries allowed and protected');
ok(sent && zlib.deflateSync(Buffer.from(sent.body.html), { level: 9 }).length <= 4096, 'its HTML fits 4 KB compressed');
const home = sent && JSON.parse(sent.body.chat_data);
ok(home?.s === 'h' && home.n[0] === 1, 'the first screen is the shop with its counts');
const widgetMsg = mid; // the stand-in gave the widget the last message id

// ---------- taps ----------
const list = await tap('l:a:0', widgetMsg);
ok(list?.i?.length === 1 && list.i[0][0].includes('Плащ') && !JSON.stringify(list).includes('Чужая'), 'the list holds only the shop’s own item');
const card = await tap('o:0', widgetMsg);
ok(card?.s === 'i' && card.c === 100, 'an item opens by its position');
const priced = await tap('P:85', widgetMsg);
const price = (await db.query(`SELECT price FROM "Listing" WHERE id=$1`, [item])).rows[0].price;
ok(price === 85 && /85/.test(priced?.t ?? ''), 'the price is changed from the widget');
ok(calls.some((c) => c.method === 'editMessageWidgetData' && c.body.message_id === widgetMsg), 'the message keeps the new state');
await tap('H', widgetMsg);
ok((await db.query(`SELECT status FROM "Listing" WHERE id=$1`, [item])).rows[0].status === 'HIDDEN', 'hidden from the widget');

// ---------- what must not work ----------
const from = await tap('S', widgetMsg, { id: CHAT, type: 'private' }, CHAT + 1);
ok(/личном чате/.test(from?.e ?? ''), 'a query from someone else is refused');
const bogus = await tap(`o:${foreign}`, widgetMsg);
ok(bogus?.s === 'h', 'an id in the data is not a command');
ok((await db.query(`SELECT status FROM "Listing" WHERE id=$1`, [foreign])).rows[0].status === 'PUBLISHED', 'the foreign item is untouched');

await db.query(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE id=$1`, [sellerId]);
const stale = await tap('U', widgetMsg);
ok(/не подключён/.test(stale?.e ?? ''), 'after a password reset the widget stops acting');
ok((await db.query(`SELECT status FROM "Listing" WHERE id=$1`, [item])).rows[0].status === 'HIDDEN', 'nothing was changed');

// ---------- clean up ----------
await db.query(`DELETE FROM "ListingStat" WHERE "listingId" = ANY($1)`, [[item, foreign]]).catch(() => 0);
await db.query(`DELETE FROM "SellerActivity" WHERE "userId" = ANY($1)`, [[sellerId, otherId]]).catch(() => 0);
await db.query(`DELETE FROM "Notification" WHERE "userId" = ANY($1)`, [[sellerId, otherId]]).catch(() => 0);
await db.query(`DELETE FROM "Listing" WHERE id = ANY($1)`, [[item, foreign]]).catch(() => 0);
await db.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[sellerId, otherId]]).catch(() => 0);
fake.close();
await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
