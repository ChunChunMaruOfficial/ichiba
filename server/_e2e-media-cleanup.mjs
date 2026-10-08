// E2E for the nightly media cleanup on local storage: unattached photos and videos (abandoned uploads, media of a
// chat message deleted for both) lose their rows and files; attached and fresh ones stay.
// Run against a local API started with CRON_SECRET set (CRON_SECRET=e2e-secret npm run dev): node _e2e-media-cleanup.mjs
import 'dotenv/config';
import { existsSync } from 'fs';
import pg from 'pg';
import sharp from 'sharp';

const API = 'http://127.0.0.1:4000';
const SECRET = process.env.CRON_SECRET || 'e2e-secret';
const MEDIA = process.env.MEDIA_DIR ?? 'storage/media';
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
const png = (w, h, r) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 60 } } }).png().toBuffer();
const photo = async (call, r) => {
  const fd = new FormData();
  fd.append('file', new Blob([await png(500, 400, r)], { type: 'image/png' }), 'p.png');
  return (await call.form('/media/photos?for=chat', fd)).data;
};
const video = async (call) => {
  const fd = new FormData();
  fd.append('file', new Blob([fakeMp4(5)], { type: 'video/mp4' }), 'v.mp4');
  fd.append('poster', new Blob([await png(720, 1280, 10)], { type: 'image/png' }), 'poster.png');
  fd.append('width', '720');
  fd.append('height', '1280');
  return (await call.form('/media/videos?for=chat', fd)).data;
};
const fileOf = (url) => `${MEDIA}/${decodeURIComponent(url.split('/media/')[1])}`;

const buyer = await session('igor@ichiba.test');
const listing = (await buyer('/wardrobes/alex')).data.groups.flatMap((g) => g.items).find((l) => l.status === 'PUBLISHED');
const T = (await buyer('/threads', { body: { listingId: listing.id } })).data.id;

const abandoned = await photo(buyer, 11);
const abandonedVideo = await video(buyer);
const kept = await photo(buyer, 22);
const keptVideo = await video(buyer);
const sent = await buyer(`/threads/${T}/messages`, { body: { body: 'останется', photoIds: [kept.id], videoIds: [keptVideo.id] } });
const gone = await photo(buyer, 33);
const deleted = await buyer(`/threads/${T}/messages`, { body: { photoIds: [gone.id] } });
await buyer(`/threads/${T}/messages/delete`, { body: { ids: [deleted.data.id], forAll: true } });
ok(sent.status === 201 && deleted.status === 201, 'setup: messages sent');
ok([abandoned.urls.l, gone.urls.l, kept.urls.l, abandonedVideo.url, abandonedVideo.poster].every((u) => existsSync(fileOf(u))), 'setup: files are on disk');

// Two days old: due for cleanup if unused.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const old = new Date(Date.now() - 2 * 86400_000);
await db.query(`UPDATE "Photo" SET "createdAt" = $1 WHERE id = ANY($2)`, [old, [abandoned.id, kept.id, gone.id]]);
await db.query(`UPDATE "Video" SET "createdAt" = $1 WHERE id = ANY($2)`, [old, [abandonedVideo.id, keptVideo.id]]);
const fresh = await photo(buyer, 44);

const tick = await fetch(`${API}/cron/tick`, { headers: { authorization: `Bearer ${SECRET}` } }).then((r) => r.json());
ok(tick.ran?.includes('photo-cleanup'), `cleanup ran (${JSON.stringify(tick.ran ?? tick)})`);

const rows = async (table, ids) => (await db.query(`SELECT id FROM "${table}" WHERE id = ANY($1)`, [ids])).rows.map((r) => r.id);
ok((await rows('Photo', [abandoned.id])).length === 0 && !existsSync(fileOf(abandoned.urls.l)) && !existsSync(fileOf(abandoned.urls.s)), 'abandoned photo: row and all sizes deleted');
ok((await rows('Video', [abandonedVideo.id])).length === 0 && !existsSync(fileOf(abandonedVideo.url)) && !existsSync(fileOf(abandonedVideo.poster)), 'abandoned video: row, file and poster deleted');
ok((await rows('Photo', [gone.id])).length === 0 && !existsSync(fileOf(gone.urls.l)), 'photo of a message deleted for both: deleted');
ok((await rows('Photo', [kept.id])).length === 1 && existsSync(fileOf(kept.urls.l)), 'photo in a live message: kept');
ok((await rows('Video', [keptVideo.id])).length === 1 && existsSync(fileOf(keptVideo.url)), 'video in a live message: kept');
ok((await rows('Photo', [fresh.id])).length === 1 && existsSync(fileOf(fresh.urls.l)), 'fresh upload (under a day): kept');
const msg = (await buyer(`/threads/${T}`)).data.messages.find((m) => m.id === sent.data.id);
ok(msg?.media.length === 2, 'the live message still shows its photo and video');
await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
