// E2E for deals living in the chat: the buyer's comment becomes the first message, pickup is no longer offered,
// purchases/sales without a filter list every deal, and the deal's chat opens from the request.
// Run against a local API with the seed data: node _e2e-deals-chat.mjs
import 'dotenv/config';
import pg from 'pg';
import WebSocket from 'ws';

const API = 'http://127.0.0.1:4000';
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);

async function session(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'password123' }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return async (path, { method, body } = {}) => {
    const res = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, data: t ? JSON.parse(t) : null };
  };
}

const buyer = await session('nastya@ichiba.test');
const seller = await session('kate@ichiba.test');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// The seller's socket: the comment must reach them live as a chat message.
const { token } = (await seller('/realtime/token')).data;
const ws = new WebSocket(`ws://127.0.0.1:4000/ws?token=${encodeURIComponent(token)}`);
const events = [];
ws.on('message', (raw) => String(raw) !== 'pong' && events.push(JSON.parse(String(raw))));
await new Promise((resolve) => ws.once('open', resolve));

// ---------- pickup is gone ----------
const pickupLeft = (await db.query(`SELECT count(*)::int AS n FROM "Listing" WHERE 'PICKUP' = ANY("deliveryOptions")`)).rows[0].n;
ok(pickupLeft === 0, 'no listing offers pickup any more (migration)');

const items = (await seller('/wardrobes/kate')).data.groups.flatMap((g) => g.items).filter((l) => l.status === 'PUBLISHED' && l.saleType !== 'AUCTION');
const free = [];
for (const l of items) {
  const busy = (await db.query(`SELECT 1 FROM "BuyRequestItem" i JOIN "BuyRequest" r ON r.id = i."requestId" WHERE i."listingId" = $1 AND r."buyerId" = (SELECT id FROM "User" WHERE email = 'nastya@ichiba.test') AND r.status NOT IN ('CANCELLED','DECLINED','COMPLETED')`, [l.id])).rowCount;
  if (!busy) free.push(l);
  if (free.length === 2) break;
}
const [one, two] = free;
const detail = (await buyer(`/listings/${one.id}`)).data;
ok(!detail.deliveryOptions.includes('PICKUP'), `listing options: ${detail.deliveryOptions.join(', ')}`);
const pickup = await buyer('/requests', { body: { listingId: one.id, deliveryMethod: 'PICKUP' } });
ok(pickup.status === 400, 'a request with pickup is rejected');

// ---------- comment → first chat message ----------
const comment = `Могу забрать сегодня после 18:00 (${Date.now().toString(36)})`;
const method = detail.deliveryOptions[0];
const req = await buyer('/requests', { body: { listingId: one.id, deliveryMethod: method, deliveryPoint: method === 'DELIVERY' ? 'Минск, ул. Тестовая, 1' : null, buyerComment: comment } });
ok(req.status === 201 && req.data.threadId, 'request created and its conversation opened');
const thread = (await buyer(`/threads/${req.data.threadId}`)).data;
ok(thread.messages.at(-1)?.body === comment && thread.messages.at(-1).mine, 'the comment is the buyer’s message in the chat');
ok(thread.thread.request?.id === req.data.id, 'the conversation is tied to the deal');
await new Promise((r) => setTimeout(r, 500));
ok(events.some((e) => e.type === 'message' && e.data.message.body === comment), 'the seller gets the comment live');
const sellerThread = (await seller(`/threads/${req.data.threadId}`)).data;
ok(sellerThread.messages.some((m) => m.body === comment && !m.mine), 'the seller sees it in the same conversation');

const twoMethod = (await buyer(`/listings/${two.id}`)).data.deliveryOptions[0];
const silent = await buyer('/requests', { body: { listingId: two.id, deliveryMethod: twoMethod, deliveryPoint: 'Минск, ул. Тестовая, 1' } });
const silentMessages = silent.data?.threadId ? (await buyer(`/threads/${silent.data.threadId}`)).data.messages.length : 0;
ok(silent.status === 201 && silentMessages === 0, `no comment → no message is sent (${silent.status} ${silent.data?.message ?? ''})`);
const opened = await buyer('/threads', { body: { requestId: silent.data.id } });
ok(opened.status === 201 && opened.data.request?.id === silent.data.id, 'the deal’s conversation opens from the request (what /deals/:id redirects to)');

// ---------- lists without a filter ----------
const all = (await buyer('/purchases')).data;
const active = (await buyer('/purchases?tab=active')).data;
const done = (await buyer('/purchases?tab=completed')).data;
const cancelled = (await buyer('/purchases?tab=cancelled')).data;
ok(all.items.length === active.items.length + done.items.length + cancelled.items.length, `purchases without a filter: all ${all.items.length} deals`);
ok(all.items.some((d) => d.id === req.data.id), 'the new deal is in the full list');
const firstPassive = all.items.findIndex((d) => !d.needsMyAction);
ok(firstPassive === -1 || all.items.slice(firstPassive).every((d) => !d.needsMyAction), 'deals waiting for me come first');
const salesAll = (await seller('/sales')).data;
ok(salesAll.items.length >= (await seller('/sales?tab=deals')).data.items.length && salesAll.items.some((d) => d.id === req.data.id), 'sales without a filter: every deal');

// ---------- the seller answers from the chat's deal panel (same API) ----------
const accepted = await seller(`/requests/${req.data.id}/accept`, { method: 'POST' });
ok(accepted.status === 201 || accepted.status === 200, 'seller accepts');
await new Promise((r) => setTimeout(r, 500));
const deal = (await buyer(`/requests/${req.data.id}`)).data;
ok(deal.status === 'WAITING_HANDOVER' || deal.status === 'ACCEPTED', `buyer sees the new status (${deal.status})`);

// Clean up so the run can be repeated.
for (const id of [req.data.id, silent.data.id]) await buyer(`/requests/${id}/cancel`, { body: { reason: 'e2e' } });
ws.close();
await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
