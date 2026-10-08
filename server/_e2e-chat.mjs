// E2E for the chat: replies, edits, deletion for me / for both, pins for me / for both, reactions, photo and video
// messages, paging — and that every change reaches the other side live over the WebSocket.
// Run against a local API (REALTIME_DRIVER=ws, the default) with the seed data: node _e2e-chat.mjs
import 'dotenv/config';
import sharp from 'sharp';
import pg from 'pg';
import WebSocket from 'ws';

const API = 'http://127.0.0.1:4000';
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);

async function session(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'password123' }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  const call = async (path, { method, body } = {}) => {
    const res = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, data: t ? JSON.parse(t) : null };
  };
  call.form = async (path, fd) => {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: { cookie }, body: fd });
    return { status: res.status, data: await res.json() };
  };
  return call;
}

/** A live socket that records events; `next(type, pred)` waits for a matching one. */
async function live(call) {
  const { token } = (await call('/realtime/token')).data;
  const ws = new WebSocket(`ws://127.0.0.1:4000/ws?token=${encodeURIComponent(token)}`);
  const seen = [];
  const waiters = [];
  ws.on('message', (raw) => {
    if (String(raw) === 'pong') return;
    const e = JSON.parse(String(raw));
    seen.push(e);
    for (const w of [...waiters]) if (w.type === e.type && w.pred(e.data)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(e.data));
  });
  await new Promise((resolve, reject) => (ws.once('open', resolve), ws.once('error', reject)));
  return {
    next: (type, pred = () => true, ms = 4000) =>
      new Promise((resolve) => {
        const hit = seen.find((e) => e.type === type && pred(e.data));
        if (hit) return (seen.splice(seen.indexOf(hit), 1), resolve(hit.data));
        const w = { type, pred, resolve };
        waiters.push(w);
        setTimeout(() => (waiters.includes(w) && waiters.splice(waiters.indexOf(w), 1), resolve(null)), ms);
      }),
    close: () => ws.close(),
  };
}

/** Minimal ISO-BMFF file: ftyp + moov/mvhd with the given duration. The server never decodes frames. */
function fakeMp4(seconds) {
  const box = (type, body) => {
    const b = Buffer.alloc(8 + body.length);
    b.writeUInt32BE(8 + body.length, 0);
    b.write(type, 4, 'latin1');
    body.copy(b, 8);
    return b;
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isommp41', 'latin1')), box('moov', box('mvhd', mvhd)), box('mdat', Buffer.alloc(64))]);
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 60 } } }).png().toBuffer();

const buyer = await session('igor@ichiba.test');
const seller = await session('alex@ichiba.test');
const wardrobe = (await buyer('/wardrobes/alex')).data.groups.flatMap((g) => g.items);
const listing = wardrobe.find((l) => l.status === 'PUBLISHED');
const thread = (await buyer('/threads', { body: { listingId: listing.id } })).data;
const T = thread.id;
const sellerLive = await live(seller);
const buyerLive = await live(buyer);

// ---------- send + reply ----------
const first = (await buyer(`/threads/${T}/messages`, { body: { body: 'Здравствуйте! Есть замеры?' } })).data;
const got = await sellerLive.next('message', (d) => d.message.id === first.id);
ok(!!got && got.message.body === first.body && got.message.mine === false && got.message.preview === first.body, 'message arrives live, seen from the recipient');
const answer = (await seller(`/threads/${T}/messages`, { body: { body: 'Да: плечи 46, длина 70', replyToId: first.id } })).data;
ok(answer.replyTo?.id === first.id && answer.replyTo.mine === false && answer.replyTo.text === first.body, 'reply carries the quoted message');
const gotReply = await buyerLive.next('message', (d) => d.message.id === answer.id);
ok(gotReply?.message.replyTo?.mine === true, 'quoted message is "mine" for the buyer');
const foreign = (await buyer(`/threads`)).data.items.find((t) => t.id !== T);
if (foreign) {
  const other = (await buyer(`/threads/${foreign.id}`)).data.messages[0];
  if (other) ok((await buyer(`/threads/${T}/messages`, { body: { body: 'x', replyToId: other.id } })).status === 400, 'cannot reply to a message from another thread');
}
ok((await buyer(`/threads/${T}/messages`, { body: { body: '   ' } })).status === 400, 'empty message rejected');

// ---------- edit ----------
const edited = await buyer(`/threads/${T}/messages/${first.id}`, { method: 'PUT', body: { body: 'Здравствуйте! Есть замеры и фото бирки?' } });
ok(edited.status === 200 && edited.data.editedAt && edited.data.body.includes('бирки'), 'own message edited');
const gotEdit = await sellerLive.next('message_update', (d) => d.message.id === first.id);
ok(gotEdit?.message.body.includes('бирки') && gotEdit.message.editedAt, 'edit arrives live');
ok((await seller(`/threads/${T}/messages/${first.id}`, { method: 'PUT', body: { body: 'чужое' } })).status === 403, "can't edit the other side's message");
const card = await buyer(`/threads/${T}/messages/${first.id}`, { method: 'PUT', body: { body: 'Карта 4111 1111 1111 1111' } });
ok(card.data.notice && !card.data.body.includes('4111 1111 1111 1111'), 'edited text goes through card masking');
const quoted = (await seller(`/threads/${T}`)).data.messages.find((m) => m.id === answer.id);
ok(quoted.replyTo.text.includes('••') || !quoted.replyTo.text.includes('4111 1111 1111 1111'), 'quote shows the edited (masked) text');

// ---------- reactions ----------
const r1 = await seller(`/threads/${T}/messages/${first.id}/reaction`, { method: 'PUT', body: { emoji: '👍' } });
ok(r1.data.reactions?.[0]?.emoji === '👍' && r1.data.reactions[0].mine, 'reaction set');
const gotReact = await buyerLive.next('message_update', (d) => d.message.id === first.id && d.message.reactions.length === 1);
ok(gotReact?.message.reactions[0].mine === false && gotReact.message.reactions[0].count === 1, 'reaction arrives live');
await buyer(`/threads/${T}/messages/${first.id}/reaction`, { method: 'PUT', body: { emoji: '👍' } });
const both = (await seller(`/threads/${T}`)).data.messages.find((m) => m.id === first.id);
ok(both.reactions[0].count === 2, 'two people, same reaction → count 2');
const swapped = await seller(`/threads/${T}/messages/${first.id}/reaction`, { method: 'PUT', body: { emoji: '🔥' } });
ok(swapped.data.reactions.length === 2 && swapped.data.reactions.find((r) => r.emoji === '🔥').mine, 'another emoji replaces mine');
const off = await seller(`/threads/${T}/messages/${first.id}/reaction`, { method: 'PUT', body: { emoji: '🔥' } });
ok(off.data.reactions.length === 1 && !off.data.reactions[0].mine, 'same emoji again removes it');
ok((await seller(`/threads/${T}/messages/${first.id}/reaction`, { method: 'PUT', body: { emoji: '💩' } })).status === 400, 'unknown reaction rejected');

// ---------- pins ----------
const pinMe = await buyer(`/threads/${T}/messages/${answer.id}/pin`, { body: { forAll: false } });
ok(pinMe.data.pins[0].messageId === answer.id && pinMe.data.pins[0].forAll === false, 'pinned for me');
ok(!(await seller(`/threads/${T}`)).data.pins.some((p) => p.messageId === answer.id), "personal pin isn't visible to the other side");
const pinAll = await seller(`/threads/${T}/messages/${first.id}/pin`, { body: { forAll: true } });
ok(pinAll.data.pins[0].messageId === first.id && pinAll.data.pins[0].forAll, 'pinned for both');
ok(!!(await buyerLive.next('thread_pins', (d) => d.threadId === T)), 'shared pin arrives live');
const buyerPins = (await buyer(`/threads/${T}`)).data.pins;
ok(buyerPins[0].messageId === first.id && buyerPins[1].messageId === answer.id, 'buyer sees the shared pin and their own, newest first');
await buyer(`/threads/${T}/messages/${first.id}/pin`, { method: 'DELETE' });
ok(!!(await sellerLive.next('thread_pins', (d) => d.threadId === T)), 'unpinning a shared pin reaches the other side');
ok(!(await seller(`/threads/${T}`)).data.pins.some((p) => p.messageId === first.id), 'shared pin removed for both');

// ---------- photo + video messages ----------
const photoUp = async (call, w, h) => {
  const fd = new FormData();
  fd.append('file', new Blob([await png(w, h)], { type: 'image/png' }), 'p.png');
  return call.form('/media/photos?for=chat', fd);
};
const small = await photoUp(buyer, 200, 150);
ok(small.status === 201, 'chat photos may be small (200×150)');
const fdTiny = new FormData();
fdTiny.append('file', new Blob([await png(200, 150)], { type: 'image/png' }), 'p.png');
ok((await buyer.form('/media/photos', fdTiny)).status === 400, 'listing uploads keep the 400 px minimum');
const big = await photoUp(buyer, 900, 1200);
const vfd = new FormData();
vfd.append('file', new Blob([fakeMp4(95)], { type: 'video/mp4' }), 'v.mp4');
vfd.append('poster', new Blob([await png(720, 1280)], { type: 'image/png' }), 'poster.png');
vfd.append('width', '720');
vfd.append('height', '1280');
const vid = await buyer.form('/media/videos?for=chat', vfd);
ok(vid.status === 201 && vid.data.durationMs === 95000, 'chat video may be longer than 30 s (95 s)');
const albumMsg = await buyer(`/threads/${T}/messages`, { body: { body: 'Вот так она выглядит', photoIds: [small.data.id, big.data.id], videoIds: [vid.data.id], replyToId: answer.id } });
ok(albumMsg.status === 201 && albumMsg.data.kind === 'MEDIA' && albumMsg.data.media.length === 3 && albumMsg.data.media[2].type === 'video', 'album with caption sent');
const gotAlbum = await sellerLive.next('message', (d) => d.message.id === albumMsg.data.id);
ok(gotAlbum?.message.media.length === 3 && gotAlbum.message.preview.startsWith('🖼 3 медиа'), 'album arrives live with a preview line');
const reuse = await buyer(`/threads/${T}/messages`, { body: { photoIds: [small.data.id] } });
ok(reuse.status === 400, 'a photo already sent cannot be attached again');
const stolen = await photoUp(seller, 300, 300);
ok((await buyer(`/threads/${T}/messages`, { body: { photoIds: [stolen.data.id] } })).status === 400, "someone else's upload can't be attached");
const onlyPhoto = await buyer(`/threads/${T}/messages`, { body: { photoIds: [(await photoUp(buyer, 640, 480)).data.id] } });
if (onlyPhoto.status !== 201) console.log('photo send:', onlyPhoto.status, onlyPhoto.data);
ok(onlyPhoto.status === 201 && onlyPhoto.data.body === '', 'photo without caption');
const list = (await seller('/threads')).data.items.find((t) => t.id === T);
ok(list.lastMessage.body === '🖼 Фото', 'thread list shows "🖼 Фото" for a photo');
const captionEdit = await buyer(`/threads/${T}/messages/${albumMsg.data.id}`, { method: 'PUT', body: { body: '' } });
ok(captionEdit.status === 200 && captionEdit.data.body === '' && captionEdit.data.media.length === 3, 'caption can be removed, media stay');

// ---------- delete ----------
const hideMe = await seller(`/threads/${T}/messages/delete`, { body: { ids: [first.id], forAll: false } });
ok(hideMe.status === 200, 'deleted for me');
ok(!(await seller(`/threads/${T}`)).data.messages.some((m) => m.id === first.id), 'hidden for me');
ok((await buyer(`/threads/${T}`)).data.messages.some((m) => m.id === first.id), 'still there for the other side');
ok((await seller(`/threads/${T}`)).data.messages.find((m) => m.id === answer.id).replyTo.deleted, 'a quote of a message I deleted shows as deleted');
ok((await seller(`/threads/${T}/messages/delete`, { body: { ids: [albumMsg.data.id], forAll: true } })).status === 403, "can't delete the other side's message for both");
const gone = await buyer(`/threads/${T}/messages/delete`, { body: { ids: [albumMsg.data.id, onlyPhoto.data.id], forAll: true } });
ok(gone.status === 200 && gone.data.ids.length === 2, 'deleted for both');
const gotDelete = await sellerLive.next('message_delete', (d) => d.ids.includes(albumMsg.data.id));
ok(!!gotDelete, 'deletion arrives live');
ok(!(await seller(`/threads/${T}`)).data.messages.some((m) => m.id === albumMsg.data.id), 'gone for the other side');
const preview = (await seller('/threads')).data.items.find((t) => t.id === T).lastMessage.body;
ok(preview === answer.body, 'thread preview falls back to the previous message');
ok((await buyer(`/threads/${T}/messages/${albumMsg.data.id}/pin`, { body: {} })).status === 404, "a deleted message can't be pinned");

// ---------- typing + read ----------
await buyer(`/threads/${T}/typing`, { method: 'POST' });
ok(!!(await sellerLive.next('typing', (d) => d.threadId === T)), 'typing arrives live');
await buyer(`/threads/${T}/messages`, { body: { body: 'Ещё вопрос' } });
await seller(`/threads/${T}/read`, { method: 'POST' });
ok(!!(await buyerLive.next('thread_read', (d) => d.threadId === T)), 'read receipt arrives live');

// ---------- paging ----------
// Straight into the database: the API rate-limits sending (30 per minute).
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const sellerId = (await seller('/auth/me')).data.user.id;
const base = Date.now() - 3600_000;
for (let i = 0; i < 55; i++) await db.query(`INSERT INTO "Message" (id, "threadId", "senderId", body, "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, $4)`, [T, sellerId, `Сообщение ${i}`, new Date(base + i * 1000)]);
await db.end();
const page1 = (await buyer(`/threads/${T}`)).data;
const page2 = (await buyer(`/threads/${T}?before=${encodeURIComponent(page1.messages[0].createdAt)}`)).data;
ok(page1.messages.length === 50 && page1.hasMore && page2.messages.length > 0 && page2.pins === undefined, 'older pages load with ?before=');
ok(page2.messages.at(-1).createdAt < page1.messages[0].createdAt, 'older page is strictly older');

sellerLive.close();
buyerLive.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
