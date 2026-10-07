// E2E for listing extras: gender, multi-size copies, video, shop price, auto-accept/decline, offer to likers,
// scheduled publication and "similar" data. Run against a local API with the seed data: node _e2e-v4.mjs
import 'dotenv/config';
import pg from 'pg';
import sharp from 'sharp';

const API = 'http://127.0.0.1:4000';
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const guest = async (path) => (await fetch(`${API}${path}`)).json();

/** Minimal ISO-BMFF file: ftyp + moov/mvhd with the given duration. The server never decodes frames. */
function fakeMp4(seconds) {
  const box = (type, body) => {
    const b = Buffer.alloc(8 + body.length);
    b.writeUInt32BE(8 + body.length, 0);
    b.write(type, 4, 'latin1');
    body.copy(b, 8);
    return b;
  };
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isommp41', 'latin1'));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(seconds * 1000, 16); // duration
  return Buffer.concat([ftyp, box('moov', box('mvhd', mvhd)), box('mdat', Buffer.alloc(64))]);
}

const alex = await session('alex@ichiba.test');
// Real seed photos of outerwear, so AI moderation sees the item the title names.
// Another seller's photos: re-uploading alex's own photos would (rightly) be caught as a duplicate.
const wardrobe = (await alex('/wardrobes/kate')).data.groups.flatMap((g) => g.items);
const sources = [];
for (const c of wardrobe.filter((c) => c.category === 'outerwear').slice(0, 6)) sources.push((await alex(`/listings/${c.id}`)).data);
const fileOf = (l) => `storage/media/${l.photos[0].urls.l.split('/media/')[1]}`;
const jpeg = (i) => sharp(fileOf(sources[i % sources.length])).jpeg({ quality: 85 }).toBuffer();
const igor = await session('igor@ichiba.test');
const nastya = await session('nastya@ichiba.test');
const created = [];

const uploadPhoto = async (i) => {
  const fd = new FormData();
  fd.append('file', new Blob([await jpeg(i)], { type: 'image/jpeg' }), 'p.jpg');
  return (await alex.form('/media/photos', fd)).data;
};
const uploadVideo = async (seconds, bytes = fakeMp4(seconds)) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'video/mp4' }), 'v.mp4');
  fd.append('poster', new Blob([await jpeg(0)], { type: 'image/jpeg' }), 'poster.jpg');
  fd.append('width', '720');
  fd.append('height', '1280');
  return alex.form('/media/videos', fd);
};

// ---------- video upload ----------
const video = await uploadVideo(12);
ok(video.status === 201 && video.data.durationMs === 12000 && video.data.url.endsWith('.mp4') && video.data.poster.endsWith('_640.webp'), 'video uploads, duration read from the file');
const long = await uploadVideo(45);
ok(long.status === 400 && long.data.code === 'TOO_LONG', 'video over 30 s rejected');
const junk = await uploadVideo(0, Buffer.from('definitely not a video file at all'));
ok(junk.status === 400, 'non-video bytes rejected');
const served = await fetch(video.data.url, { headers: { range: 'bytes=0-15' } });
ok(served.status === 206, 'video is served with range requests');

// ---------- multi-size + gender + shop price + video ----------
const photo = await uploadPhoto(0);
const src = sources[0];
const base = {
  photos: [{ id: photo.id, isDefect: false }],
  title: src.title,
  category: 'outerwear',
  subcategory: src.subcategory,
  sizeSystem: 'ALPHA',
  sizeValue: 'M',
  condition: 'LIKE_NEW',
  defectsPresent: false,
  price: 60,
  deliveryOptions: ['IN_PERSON'],
  gender: 'FEMALE',
};
const badShop = await alex('/listings', { body: { ...base, originalPrice: 50 } });
created.push(badShop.data.id);
const badPub = await alex(`/listings/${badShop.data.id}/publish`, { method: 'POST' });
ok(badPub.status === 400 && badPub.data.fields?.originalPrice, 'shop price below the price is rejected');

const draft = await alex('/listings', { body: { ...base, originalPrice: 240, extraSizes: ['S', 'L', 'M'], minOfferPrice: 30, autoAcceptPrice: 50, videoId: video.data.id } });
created.push(draft.data.id);
const pub = await alex(`/listings/${draft.data.id}/publish`, { method: 'POST' });
if (pub.status !== 200) console.log('  publish:', pub.status, JSON.stringify(pub.data).slice(0, 300));
ok(pub.status === 200 && pub.data.sizes?.length === 3, `published in 3 sizes: ${pub.data.sizes?.map((s) => s.size).join(', ')}`);
ok(pub.data.originalPrice === 240 && pub.data.gender === 'FEMALE' && pub.data.video?.id === video.data.id, 'shop price, gender and video saved');
ok(pub.data.owner?.extraSizes?.length === 0, 'extra sizes cleared after publishing');
const sizeS = pub.data.sizes.find((s) => s.size === 'S');
const sizeL = pub.data.sizes.find((s) => s.size === 'L');
created.push(sizeS.id, sizeL.id);
const copy = await guest(`/listings/${sizeS.id}`);
ok(copy.status === 'PUBLISHED' && copy.title === base.title && copy.photos.length === 1 && copy.video?.url === video.data.url, 'size copy shares photos, text and video');
ok(copy.sizes?.find((s) => s.current)?.size === 'S', 'copy shows the size switcher with itself current');

const card = (await guest(`/search?seller=alex&limit=48`)).items.find((c) => c.id === draft.data.id);
ok(card?.originalPrice === 240 && card?.hasVideo === true, 'search card has shop price and video mark');
const female = (await guest('/search?gender=FEMALE&category=outerwear&limit=48')).items.map((c) => c.id);
const male = (await guest('/search?gender=MALE&category=outerwear&limit=48')).items.map((c) => c.id);
ok(female.includes(draft.data.id) && !male.includes(draft.data.id), 'women-only item: in «Женщинам», not in «Мужчинам»');
const neutral = (await guest('/search?gender=MALE&category=outerwear&limit=48')).items.length;
ok(neutral > 0, `items without a gender show up for men too (${neutral})`);
const menDresses = (await guest('/search?gender=MALE&category=dresses')).items.length;
ok(menDresses === 0, 'no ungendered dresses under «Мужчинам»');

// ---------- auto-decline / pending / auto-accept ----------
const low = await igor('/offers', { body: { listingId: sizeS.id, amount: 25 } });
ok(low.status === 201 && low.data.status === 'DECLINED', 'offer below the floor auto-declined');
const mid = await nastya('/offers', { body: { listingId: sizeS.id, amount: 40 } });
ok(mid.status === 201 && mid.data.status === 'PENDING', 'offer between floor and auto-accept waits for the seller');
const high = await igor('/offers', { body: { listingId: draft.data.id, amount: 55 } });
ok(high.status === 201 && high.data.status === 'ACCEPTED' && high.data.requestId, 'offer at the auto-accept price accepted, deal opened');
const notes = (await alex('/notifications?limit=5')).data.items;
ok(notes.some((n) => n.type === 'offer_auto_accepted'), 'seller notified about the auto-accepted offer');
if (high.data.requestId) await igor(`/requests/${high.data.requestId}/cancel`, { body: { reason: 'тест' } });
await nastya(`/offers/${mid.data.id}/cancel`, { method: 'POST' });

// ---------- offer to likers ----------
await nastya(`/favorites/${sizeL.id}`, { body: { source: 'product' } });
await igor(`/favorites/${sizeL.id}`, { body: { source: 'product' } });
const info = await alex(`/offers/likers/${sizeL.id}`);
ok(info.data.count === 2 && !info.data.nextAt, 'likers count shown to the seller');
const tooDeep = await alex(`/offers/likers/${sizeL.id}`, { body: { amount: 20 } });
ok(tooDeep.status === 400, 'discount over 50% rejected');
const sent = await alex(`/offers/likers/${sizeL.id}`, { body: { amount: 51 } });
ok(sent.status === 201 && sent.data.sent === 2, 'discount sent to both likers');
const again = await alex(`/offers/likers/${sizeL.id}`, { body: { amount: 50 } });
ok(again.status === 409, `second mailing blocked by the cooldown (${again.status} ${again.data?.message})`);
const mine = (await nastya(`/offers/listing/${sizeL.id}`)).data.offer;
ok(mine?.from === 'SELLER' && mine.amount === 51 && mine.myTurn && mine.fromLikers && !mine.canCounter, 'liker sees a take-it-or-leave-it offer');
const counter = await nastya(`/offers/${mine?.id}/counter`, { body: { amount: 45 } });
ok(counter.status === 400, 'liker cannot haggle over the discount');
ok((await nastya('/notifications?limit=5')).data.items.some((n) => n.type === 'offer_likers'), 'liker got a notification');
if (mine) await nastya(`/offers/${mine.id}/decline`, { method: 'POST' });
const igorOffer = (await igor(`/offers/listing/${sizeL.id}`)).data.offer;
if (igorOffer) await igor(`/offers/${igorOffer.id}/decline`, { method: 'POST' });
await nastya(`/favorites/${sizeL.id}`, { method: 'DELETE' });
await igor(`/favorites/${sizeL.id}`, { method: 'DELETE' });

// ---------- auction can't be multi-size ----------
const auctionDraft = await alex('/listings', { body: { ...base, photos: [{ id: (await uploadPhoto(0)).id, isDefect: false }], saleType: 'AUCTION', auctionHours: 24, extraSizes: ['L'] } });
created.push(auctionDraft.data.id);
const auctionPub = await alex(`/listings/${auctionDraft.data.id}/publish`, { method: 'POST' });
ok(auctionPub.status === 400 && auctionPub.data.fields?.extraSizes, 'multi-size auction rejected');

// ---------- scheduled publication ----------
// A different item (photo and title), or the duplicate check would rightly stop it.
const schedSrc = sources[2 % sources.length];
const sched = await alex('/listings', { body: { ...base, photos: [{ id: (await uploadPhoto(2)).id, isDefect: false }], title: schedSrc.title, subcategory: schedSrc.subcategory, sizeValue: 'XL', gender: null } });
created.push(sched.data.id);
const soon = await alex(`/listings/${sched.data.id}/schedule`, { body: { at: new Date(Date.now() + 60_000).toISOString() } });
ok(soon.status === 400, 'scheduling less than 5 minutes ahead rejected');
const at = new Date(Date.now() + 3600_000);
const s1 = await alex(`/listings/${sched.data.id}/schedule`, { body: { at: at.toISOString() } });
ok(s1.status === 200 && s1.data.owner.scheduledAt && s1.data.status === 'DRAFT', 'draft scheduled');
const drafts = (await alex('/wardrobes/alex')).data.drafts;
ok(drafts.find((d) => d.id === sched.data.id)?.scheduledAt, 'wardrobe draft card shows the schedule');
// Pretend the time has come and wait for the minute cron.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query('UPDATE "Listing" SET "scheduledAt" = now() - interval \'1 second\' WHERE id = $1', [sched.data.id]);
let live = null;
for (let i = 0; i < 40 && live?.status !== 'PUBLISHED'; i++) {
  await sleep(2000);
  live = (await alex(`/listings/${sched.data.id}`)).data;
}
ok(live?.status === 'PUBLISHED' && !live.owner.scheduledAt, 'cron published the scheduled draft');
// The notification is written right after the status flips: give it a moment.
let told = false;
for (let i = 0; i < 5 && !told; i++, await sleep(1000)) told = (await alex('/notifications?limit=20')).data.items.some((n) => n.type === 'listing_scheduled_published');
ok(told, 'seller told it went live');

// ---------- duplicates ----------
const dupPhoto = await alex('/listings', { body: { ...base, photos: [{ id: (await uploadPhoto(0)).id, isDefect: false }], title: 'Совсем другое название', sizeValue: 'XS' } });
created.push(dupPhoto.data.id);
const dupPhotoPub = await alex(`/listings/${dupPhoto.data.id}/publish`, { method: 'POST' });
ok(dupPhotoPub.status === 400 && dupPhotoPub.data.code === 'DUPLICATE' && dupPhotoPub.data.fields?.photos, `same photo again → duplicate (${dupPhotoPub.data.message} ${JSON.stringify(dupPhotoPub.data.fields)})`);
const dupText = await alex('/listings', { body: { ...base, photos: [{ id: (await uploadPhoto(1)).id, isDefect: false }] } });
created.push(dupText.data.id);
const dupTextPub = await alex(`/listings/${dupText.data.id}/publish`, { method: 'POST' });
ok(dupTextPub.status === 400 && dupTextPub.data.code === 'DUPLICATE' && dupTextPub.data.duplicateOf, 'same title, category and size → duplicate');

// ---------- similar ----------
const sim = await guest(`/listings/${src.id}/similar?limit=12`);
ok(sim.items?.length > 0 && !sim.items.some((c) => c.id === src.id) && sim.items.every((c) => c.category === src.category), `similar: ${sim.items?.length} of ${sim.total}, same category, without the item itself`);
const page2 = await guest(`/listings/${src.id}/similar?offset=12&limit=12`);
ok(!page2.items?.some((c) => sim.items.some((x) => x.id === c.id)), 'similar pages do not overlap');

// ---------- cleanup ----------
for (const id of created) {
  const l = (await alex(`/listings/${id}`)).data;
  if (l?.status === 'PUBLISHED') await alex(`/listings/${id}/hide`, { method: 'POST' });
  await alex(`/listings/${id}`, { method: 'DELETE' });
}
await db.query('DELETE FROM "Video" WHERE id = $1 OR key = $2', [video.data.id, video.data.url.split('/media/')[1].replace(/\.mp4$/, '')]);
await db.end();

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
