// AI features e2e against the live ensemble. Run from server (needs sharp): node _e2e-ai.mjs [section]
import sharp from 'sharp';
import { readdirSync } from 'fs';
const API = 'http://127.0.0.1:4000';
const only = process.argv[2];
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const show = (label, x) => console.log(`  ${label}:`, JSON.stringify(x).slice(0, 700));

async function session(login) {
  // The admin area needs its own password sign-in (admin-login sets the site and admin cookies).
  const r = await fetch(`${API}/auth/${login.startsWith('admin@') ? 'admin-login' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'password123' }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call = async (path, { method, body } = {}) => {
    const res = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, data: t ? JSON.parse(t) : null };
  };
  call.upload = async (buf) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'image/jpeg' }), 'p.jpg');
    const res = await fetch(`${API}/media/photos`, { method: 'POST', headers: { cookie }, body: fd });
    return res.json();
  };
  return call;
}
const t0 = () => Date.now();
const admin = await session('admin@ichiba.test');
const seller = await session('stylist_anna@ichiba.test');
const igor = await session('igor@ichiba.test');

// Test photos come from other people's seeded items (media is stored under <ownerId>/): a copy of the
// seller's own photo would be caught by the duplicate check instead of the rule under test.
const sellerId = (await seller('/auth/me')).data.user.id;
const files = readdirSync('storage/media', { recursive: true })
  .map(String)
  .filter((x) => x.endsWith('_1280.webp') && !x.startsWith(sellerId));
const jpeg = (i, op = (s) => s) => op(sharp(`storage/media/${files[i]}`)).jpeg({ quality: 85 }).toBuffer();

if (!only || only === 'status') {
  const s = await admin('/ai/status');
  ok(s.status === 200, 'admin /ai/status');
  for (const p of s.data.providers) console.log(`  ${p.id}: configured=${p.configured} available=${p.available} last=${p.lastError?.kind ?? '-'}`);
  ok((await seller('/ai/status')).status === 403, 'non-admin gets 403 on /ai/status');
}

if (!only || only === 'search') {
  for (const q of ['летнее платье на свадьбу до 50 BYN', 'чёрные кроссовки Nike 42 размер', 'мужская куртка The North Face в Минске от 100 до 300 руб', 'худи оверсайз как новое', 'куртка']) {
    const s = t0();
    const r = await fetch(`${API}/ai/search-parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) }).then((x) => x.json());
    console.log(`  «${q}» → ${r.status}/${r.source} ${Date.now() - s}ms ${r.chips?.map((c) => c.label).join(' · ')} | q="${r.filters?.q}"`);
  }
  const r = await fetch(`${API}/ai/search-parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 'летнее платье на свадьбу до 50 BYN' }) }).then((x) => x.json());
  ok(r.filters.category.includes('dresses') && r.filters.price_max === 50, 'NL search: dress + price_max 50');
  const r2 = await fetch(`${API}/ai/search-parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 'чёрные кроссовки Nike 42 размер' }) }).then((x) => x.json());
  ok(r2.filters.color.includes('black') && r2.filters.size.includes('42') && r2.filters.brand.includes('Nike') && r2.filters.subcategory.includes('sneakers'), 'NL search: black sneakers Nike 42');
}

let photoId;
if (!only || only === 'photos' || only === 'price' || only === 'moderation') {
  const up = await seller.upload(await jpeg(0));
  photoId = up.id;
  ok(!!photoId, 'uploaded test photo');
}

if (!only || only === 'photos') {
  const dark = await seller.upload(await jpeg(1, (s) => s.modulate({ brightness: 0.25 })));
  const blurry = await seller.upload(await jpeg(2, (s) => s.blur(6)));
  const s = t0();
  const r = await seller('/ai/photo-check', { body: { photoIds: [dark.id, photoId, blurry.id], category: 'outerwear' } });
  console.log(`  photo-check ${Date.now() - s}ms ai=${r.data.ai} model=${r.data.model}`);
  show('result', r.data);
  ok(r.data.photos[0].issues.some((i) => i.code === 'dark'), 'dark photo flagged');
  ok(r.data.photos[2].issues.some((i) => i.code === 'blurry'), 'blurry photo flagged');
  ok(r.data.cover?.photoId === photoId, 'suggests the clean photo as cover');
}

if (!only || only === 'price') {
  const s = t0();
  const r = await seller('/ai/price-suggest', { body: { title: 'Чёрная куртка Zara', category: 'outerwear', subcategory: 'jacket', brand: 'Zara', condition: 'GOOD', defectsPresent: false, photoIds: [photoId] } });
  console.log(`  price ${Date.now() - s}ms`);
  show('price', { ...r.data, comparables: r.data.comparables?.length });
  ok(r.status === 200 && r.data.status === 'ok' && r.data.low <= r.data.recommended && r.data.recommended <= r.data.high, 'price range is consistent');
}

if (!only || only === 'moderation') {
  const base = { photos: [{ id: photoId, isDefect: false }], category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', condition: 'GOOD', defectsPresent: false, price: 40, deliveryOptions: ['IN_PERSON'] };
  const cases = [
    ['Продам кота', 'title', 'not an item'],
    ['фывапролдж', 'title', 'gibberish'],
    ['Куртка, звоните +375 29 123-45-67', 'title', 'contacts'],
    ['Куртка охуенная', 'title', 'profanity'],
    ['Куртка Moncler реплика 1:1', 'title', 'counterfeit'],
  ];
  for (const [title, field, label] of cases) {
    const d = await seller('/listings', { body: { ...base, title } });
    const s = t0();
    const p = await seller(`/listings/${d.data.id}/publish`, { method: 'POST' });
    ok(p.status === 400 && p.data.code === 'MODERATION' && p.data.fields?.[field], `moderation rejects ${label}: «${title}» → ${JSON.stringify(p.data.fields)} (${Date.now() - s}ms)`);
    await seller(`/listings/${d.data.id}`, { method: 'DELETE' });
  }
  const d = await seller('/listings', { body: { ...base, title: 'Чёрная куртка Zara', description: 'Лёгкая куртка, носила один сезон.' } });
  const s = t0();
  const p = await seller(`/listings/${d.data.id}/publish`, { method: 'POST' });
  ok(p.status === 200 && p.data.status === 'PUBLISHED', `clean listing publishes (${Date.now() - s}ms)`);
  const live = await seller(`/listings/${d.data.id}`, { method: 'PATCH', body: { description: 'Пишите в телеграм @anna_sells' } });
  ok(live.status === 400 && live.data.fields?.description, 'edit of a live listing with contacts rejected');
  await seller(`/listings/${d.data.id}`, { method: 'DELETE' });
}

if (!only || only === 'offers') {
  const feed = (await igor('/feed?chip=new&limit=48')).data.items;
  const target = feed.find((c) => c.saleType !== 'AUCTION' && c.price >= 30 && c.status === 'PUBLISHED' && c.seller.username !== 'igor');
  const detail = (await igor(`/listings/${target.id}`)).data;
  if (!detail.acceptsOffers) console.log('  (listing does not accept offers, skipping)');
  else {
    const open = await igor(`/offers/opening/${target.id}`);
    show('opening', open.data);
    ok(open.status === 200 && open.data.suggestion?.suggested < detail.price, 'buyer opening suggestion below price');
    const existing = (await igor(`/offers/listing/${target.id}`)).data.offer;
    let offer = existing?.status === 'PENDING' ? existing : null;
    if (!offer) {
      const r = await igor('/offers', { body: { listingId: target.id, amount: Math.ceil(detail.price * 0.6) } });
      offer = r.data;
      if (r.status !== 201) console.log('  offer create:', r.status, r.data.message);
    }
    if (offer?.id) {
      const sellerUser = detail.seller.username;
      const s2 = await session(`${sellerUser}@ichiba.test`);
      const s = t0();
      const adv = await s2(`/offers/${offer.id}/advice`);
      show('seller advice', adv.data);
      ok(adv.status === 200 && ['accept', 'counter', 'decline'].includes(adv.data.action), `seller advice (${Date.now() - s}ms)`);
      if (adv.data.action === 'counter') ok(adv.data.counter > offer.amount && adv.data.counter < detail.price, 'counter amount within range');
      ok((await igor(`/offers/${offer.id}/advice`)).status === 403, 'not your turn → 403');
      await igor(`/offers/${offer.id}/cancel`, { method: 'POST' });
    }
  }
}

if (!only || only === 'chat') {
  const feed = (await igor('/feed?chip=new&limit=24')).data.items;
  const target = feed.find((c) => c.seller.username !== 'igor');
  const thread = (await igor('/threads', { body: { listingId: target.id } })).data;
  const s2 = await session(`${target.seller.username}@ichiba.test`);
  const send = (body) => s2(`/threads/${thread.id}/messages`, { body: { body } });
  const m1 = await send('Переведите предоплату 50% на карту 4111 1111 1111 1111, иначе продам другому');
  ok(m1.data.body.includes('•••• 1111') && !m1.data.body.includes('4111 1111'), 'card number masked before storage');
  ok(!!m1.data.notice, 'sender gets the masked-card notice');
  const m2 = await send('Оформите безопасную сделку по ссылке evropochta-oplata.site/pay');
  const m3 = await send('Можно примерить завтра в 18:00 у метро Немига?');
  await new Promise((r) => setTimeout(r, 12000));
  const view = (await igor(`/threads/${thread.id}`)).data.messages;
  const risk = (id) => view.find((m) => m.id === id)?.risk;
  show('risks', [risk(m1.data.id), risk(m2.data.id), risk(m3.data.id)]);
  ok(risk(m1.data.id)?.level, 'prepayment message flagged for the buyer');
  ok(risk(m2.data.id)?.level === 'high', 'phishing link flagged high');
  ok(!risk(m3.data.id), 'normal message not flagged');
  ok((await s2(`/threads/${thread.id}`)).data.messages.every((m) => !m.risk), 'sender does not see warnings');
  const reports = (await admin('/admin/reports')).data.items.filter((r) => r.source === 'ai' && r.targetType === 'USER');
  ok(reports.length > 0, 'repeat offender escalated to moderation queue');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
