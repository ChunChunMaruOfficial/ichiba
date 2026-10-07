// E2E for Cloudinary photos: signed ticket → direct upload to Cloudinary → register → listing → card → item page →
// edit (add/remove/reorder photos) → delete. Needs CLOUDINARY_* in .env and a local API with the
// seed data: node _e2e-cloudinary.mjs
import 'dotenv/config';
import sharp from 'sharp';

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
const guest = async (path) => (await fetch(`${API}${path}`)).json();

const alex = await session('alex@ichiba.test');
const igor = await session('igor@ichiba.test');

// Real outerwear photos of another seller from the seed (AI moderation checks the photos match the title; alex's
// own photos would be caught as duplicates). EXIF is added to check it's gone after upload.
const kate = (await alex('/wardrobes/kate')).data.groups.flatMap((g) => g.items).filter((c) => c.category === 'outerwear');
const sources = [];
for (const c of kate.slice(0, 6)) sources.push((await alex(`/listings/${c.id}`)).data);
const picture = async (i, w, h) => {
  const src = sources[i % sources.length].photos[0].urls.l;
  const img = sharp(`storage/media/${src.split('/media/')[1]}`);
  return (w ? img.resize(w, h) : img).jpeg({ quality: 88 }).withMetadata({ exif: { IFD0: { Make: 'TestCam' } } }).toBuffer();
};
const sourceTitle = sources[0].title;

/** What the browser does: ticket, then a multipart POST straight to Cloudinary. */
async function toCloudinary(call, bytes) {
  const t = await call('/media/photos/ticket', { method: 'POST' });
  const fd = new FormData();
  for (const [k, v] of Object.entries(t.data.fields)) fd.append(k, String(v));
  fd.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'p.jpg');
  const res = await fetch(t.data.uploadUrl, { method: 'POST', body: fd });
  return { ticket: t, status: res.status, body: await res.json() };
}
const upload = async (call, bytes) => {
  const up = await toCloudinary(call, bytes);
  return call('/media/photos/cloudinary', { body: { publicId: up.body.public_id, version: up.body.version, signature: up.body.signature } });
};

// ---------- ticket ----------
const t = await alex('/media/photos/ticket', { method: 'POST' });
ok(t.status === 200 && t.data.provider === 'cloudinary' && t.data.uploadUrl.includes(process.env.CLOUDINARY_CLOUD_NAME), 'ticket points at our Cloudinary cloud');
ok(!JSON.stringify(t.data).includes(process.env.CLOUDINARY_API_SECRET), 'ticket does not contain the API secret');
ok((await fetch(`${API}/media/photos/ticket`, { method: 'POST' })).status === 401, 'ticket needs sign-in');

// ---------- direct upload + register ----------
const up = await toCloudinary(alex, await picture(0));
ok(up.status === 200 && up.body.public_id?.startsWith(`${process.env.CLOUDINARY_FOLDER ?? 'ichiba'}/`), 'browser-style upload lands in Cloudinary');
ok(Math.max(up.body.width, up.body.height) <= 2560, 'stored original is size-capped');
const reg = await alex('/media/photos/cloudinary', { body: { publicId: up.body.public_id, version: up.body.version, signature: up.body.signature } });
ok(reg.status === 201 && reg.data.urls.m.startsWith('https://res.cloudinary.com/') && reg.data.width >= 400, 'API registers the photo with Cloudinary URLs');
const again = await alex('/media/photos/cloudinary', { body: { publicId: up.body.public_id, version: up.body.version, signature: up.body.signature } });
ok(again.data?.id === reg.data.id, 'registering twice returns the same photo');
const img = await fetch(reg.data.urls.m);
ok(img.ok && /image\//.test(img.headers.get('content-type') ?? ''), 'display URL serves an image');
const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
ok(!meta.exif, 'delivered photo has no EXIF');

// ---------- forgery ----------
const forged = await alex('/media/photos/cloudinary', { body: { publicId: up.body.public_id.replace(/.$/, '0'), version: up.body.version, signature: up.body.signature } });
ok(forged.status === 403, 'tampered public id is refused');
const stolen = await igor('/media/photos/cloudinary', { body: { publicId: up.body.public_id, version: up.body.version, signature: up.body.signature } });
ok(stolen.status === 403, "another user can't claim someone's upload");
const tiny = await upload(alex, await picture(1, 300, 300));
ok(tiny.status === 400 && tiny.data.code === 'TOO_SMALL', 'too small a photo is refused (and removed from Cloudinary)');

// ---------- create → publish ----------
const p2 = (await upload(alex, await picture(0, 1000, 1250))).data;
const p3 = (await upload(alex, await picture(0, 900, 1125))).data;
const title = `${sourceTitle} ${Date.now() % 100000}`;
const draft = await alex('/listings', {
  body: {
    photos: [{ id: reg.data.id, isDefect: false }, { id: p2.id, isDefect: false }, { id: p3.id, isDefect: true }],
    title,
    category: 'outerwear',
    subcategory: sources[0].subcategory,
    sizeSystem: 'ALPHA',
    sizeValue: 'M',
    condition: 'LIKE_NEW',
    defectsPresent: false,
    price: 75,
    deliveryOptions: ['IN_PERSON'],
  },
});
ok(draft.status === 201, `draft created (${draft.status} ${draft.data?.message ?? ''})`);
const id = draft.data.id;
const pub = await alex(`/listings/${id}/publish`, { method: 'POST' });
ok(pub.status === 201 || pub.status === 200, `published (${pub.status} ${pub.data?.message ?? ''})`);

// ---------- card in catalogue + item page ----------
const feed = await guest(`/search?q=${encodeURIComponent(title)}`);
const card = (feed.items ?? []).find((c) => c.id === id);
ok(card?.cover?.urls.s.startsWith('https://res.cloudinary.com/'), 'catalogue card uses the Cloudinary cover');
const item = await guest(`/listings/${id}`);
ok(item.photos?.length === 3 && item.photos.every((p) => p.urls.l.includes('res.cloudinary.com')), 'item page has all 3 photos from Cloudinary');
ok(item.photos[0].id === reg.data.id && item.photos[2].isDefect, 'photo order and defect mark kept');

// ---------- edit: reorder, drop one, add one ----------
const p4 = (await upload(alex, await picture(0, 800, 1000))).data;
const edit = await alex(`/listings/${id}`, { method: 'PATCH', body: { photos: [{ id: p3.id, isDefect: false }, { id: p4.id, isDefect: false }, { id: reg.data.id, isDefect: false }], price: 70 } });
ok(edit.status === 200, `edited (${edit.status} ${edit.data?.message ?? ''})`);
const after = await guest(`/listings/${id}`);
ok(after.photos.map((p) => p.id).join() === [p3.id, p4.id, reg.data.id].join() && after.price === 70, 'new order, added photo and price saved; removed photo gone');
const intrude = await igor(`/listings/${id}`, { method: 'PATCH', body: { price: 1 } });
ok(intrude.status === 403 || intrude.status === 404, "someone else can't edit the listing");

// ---------- delete ----------
ok((await igor(`/listings/${id}`, { method: 'DELETE' })).status >= 403, "someone else can't delete the listing");
const del = await alex(`/listings/${id}`, { method: 'DELETE' });
ok(del.status === 200, 'owner deletes the listing');
const gone = await fetch(`${API}/listings/${id}`);
ok(gone.status === 404 || (await gone.json()).status === 'DELETED', 'deleted listing is not shown');
const feed2 = await guest(`/search?q=${encodeURIComponent(title)}`);
ok(!(feed2.items ?? []).some((c) => c.id === id), 'deleted listing left the catalogue');

// ---------- the photo removed while editing is now an orphan (purged nightly by MediaService.purgeOrphans) ----------
console.log(`ORPHAN ${p2.id} ${p2.urls.m}`);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
