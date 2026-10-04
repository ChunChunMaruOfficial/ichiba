// E2E for reviews, auction auto-bids + buy-now, bundle discount, fit hints, bump + stats, SEO sitemap and email.
// Needs the API started with SMTP_HOST=127.0.0.1 SMTP_PORT=2525 and `node _smtp-capture.mjs` running.
import { readFileSync } from 'fs';
const API = 'http://127.0.0.1:4000';
const only = process.argv[2];
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () => readFileSync('_mails.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const waitMail = async (pred, ms = 6000) => {
  for (let t = 0; t < ms; t += 300) {
    const m = mails().find(pred);
    if (m) return m;
    await sleep(300);
  }
  return null;
};

async function session(login, password = 'password123') {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return async (path, { method, body } = {}) => {
    const res = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, data: t ? JSON.parse(t) : null };
  };
}
const guest = async (path) => {
  const r = await fetch(`${API}${path}`);
  return { status: r.status, data: await r.json().catch(() => null) };
};

const alex = await session('alex@ichiba.test');
const sveta = await session('sveta@ichiba.test');
const igor = await session('igor@ichiba.test');
const nastya = await session('nastya@ichiba.test');
const admin = await session('admin@ichiba.test');

// ---------- email: verification code ----------
if (!only || only === 'email') {
  const email = `e2e_${Date.now()}@example.com`;
  const r = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: email, password: 'password123', username: `e2e${Date.now() % 1e8}`, acceptTerms: true }) });
  ok(r.status < 300, `register by email (${r.status})`);
  const m = await waitMail((x) => x.to?.includes(email));
  ok(!!m && /^\d{6} — /.test(m.subject) && m.html.includes('Подтвердите почту') && m.text.includes('Код:'), `verification code email delivered: «${m?.subject}»`);
}

// ---------- bundle discount + deal emails + reviews ----------
let dealId;
if (!only || only === 'deal') {
  // A seller with at least three items that share "в руки" (the combined request needs a common method).
  const home = (await guest('/home')).data;
  let sellerName = null;
  let items = [];
  for (const w0 of home.wardrobes) {
    const w = (await guest(`/wardrobes/${w0.username}`)).data;
    const all = w.groups.flatMap((g) => g.items).filter((i) => i.status === 'PUBLISHED' && i.saleType !== 'AUCTION');
    const details = await Promise.all(all.map((i) => guest(`/listings/${i.id}`).then((r) => r.data)));
    const fit = details.filter((d) => d.deliveryOptions.includes('IN_PERSON'));
    if (fit.length >= 3) {
      sellerName = w0.username;
      items = fit.slice(0, 3);
      break;
    }
  }
  const alex = await session(`${sellerName}@ichiba.test`);
  console.log(`  seller: @${sellerName}`);
  const tiers = await alex('/users/me', { method: 'PATCH', body: { bundleDiscounts: [{ minItems: 2, percent: 10 }, { minItems: 3, percent: 15 }] } });
  ok(tiers.status === 200 && tiers.data.bundleDiscounts.length === 2, 'seller sets bundle tiers');
  ok((await alex('/users/me', { method: 'PATCH', body: { bundleDiscounts: [{ minItems: 3, percent: 10 }, { minItems: 2, percent: 15 }] } })).status === 400, 'invalid tier order rejected');
  await alex('/users/me', { method: 'PATCH', body: { emailPrefs: { deals: true } } });
  await sveta('/users/me', { method: 'PATCH', body: { emailPrefs: { deals: true } } });

  for (const c of (await sveta('/cart')).data.groups.flatMap((g) => g.items)) await sveta(`/cart/${c.id}`, { method: 'DELETE' });
  for (const i of items) await sveta(`/cart/${i.id}`, { method: 'POST' });
  const cart = (await sveta('/cart')).data.groups.find((g) => g.seller.username === sellerName);
  const sum = items.reduce((s, i) => s + i.price, 0);
  ok(cart.discountPercent === 15 && cart.subtotal === sum && cart.total === Math.floor(sum * 0.85), `cart: 3 items → −15% (${cart.subtotal} → ${cart.total})`);
  await sveta(`/cart/${items[2].id}`, { method: 'DELETE' });
  const cart2 = (await sveta('/cart')).data.groups.find((g) => g.seller.username === sellerName);
  ok(cart2.discountPercent === 10 && cart2.nextTier?.needItems === 1 && cart2.nextTier.percent === 15, 'cart: 2 items → −10%, hint "ещё 1 вещь — −15%"');
  await sveta(`/cart/${items[2].id}`, { method: 'POST' });

  const method = cart.deliveryOptions[0];
  const req = await sveta('/requests', { body: { listingIds: items.map((i) => i.id), deliveryMethod: method, deliveryPoint: method === 'DELIVERY' ? 'Минск, ул. Тестовая, 1' : undefined } });
  if (req.status !== 201) console.log('  request:', req.status, req.data?.message);
  ok(req.status === 201 && req.data.discountPercent === 15 && req.data.priceTotal === Math.floor(sum * 0.85) && req.data.items.reduce((s, i) => s + i.dealPrice, 0) === req.data.priceTotal, 'request keeps the discount; item prices add up to the total');
  dealId = req.data.id;

  const m1 = await waitMail((x) => x.to?.includes(`${sellerName}@ichiba.test`) && x.subject.startsWith('Новый запрос'));
  ok(!!m1 && m1.html.includes(`/deals/${dealId}`) && !!m1.listUnsubscribe && m1.listUnsubscribePost === 'List-Unsubscribe=One-Click', 'seller gets "Новый запрос" email with deal link + one-click unsubscribe headers');

  await alex(`/requests/${dealId}/accept`, { method: 'POST' });
  ok(!!(await waitMail((x) => x.to?.includes('sveta@ichiba.test') && x.subject.startsWith('Продавец подтвердил'))), 'buyer gets "Продавец подтвердил" email');
  await alex(`/requests/${dealId}/handed-over`, { method: 'POST' });
  const rec = await sveta(`/requests/${dealId}/received`, { method: 'POST' });
  ok(rec.data.status === 'COMPLETED' && rec.data.canReview, 'deal completed → buyer can review');
  ok(!!(await waitMail((x) => x.to?.includes(`${sellerName}@ichiba.test`) && x.subject.startsWith('Сделка завершена'))), 'seller gets "Сделка завершена" email');
  const notes = (await sveta('/notifications?limit=5')).data.items.map((n) => n.type);
  ok(notes.includes('review_request'), 'buyer asked to leave a review');

  ok((await sveta(`/requests/${dealId}/review`, { body: { rating: 5, text: 'Пишите в телеграм @x' } })).status === 400, 'review with contacts rejected');
  ok((await alex(`/requests/${dealId}/review`, { body: { rating: 5 } })).status === 403, 'seller cannot review own deal');
  const rv = await sveta(`/requests/${dealId}/review`, { body: { rating: 5, tags: ['as_described', 'fast'], text: 'Всё отлично, вещи как на фото' } });
  ok(rv.status === 201 && rv.data.rating === 5 && rv.data.tags.length === 2, 'buyer leaves a review');
  ok((await sveta(`/requests/${dealId}/review`, { body: { rating: 4 } })).status === 409, 'second review on the same deal → 409');
  const reply = await alex(`/reviews/${rv.data.id}/reply`, { body: { text: 'Спасибо, приходите ещё!' } });
  ok(reply.status === 201 && reply.data.reply, 'seller replies publicly');
  const list = (await guest(`/users/${sellerName}/reviews`)).data;
  ok(list.summary.count >= 1 && list.items[0].reply && list.summary.distribution.length === 5, `public reviews: ${list.summary.count}, avg ${list.summary.avg}`);
  const l = (await guest(`/listings/${items[0].id}`)).data;
  ok(l.seller.rating?.count >= 1, `seller rating on product page: ${l.seller.rating?.avg}★ (${l.seller.rating?.count})`);
  ok(l.seller.bundleDiscounts?.length === 2, 'bundle tiers shown on product page');

  // Report a review → admin hides it → rating recalculated.
  await nastya('/reports', { body: { targetType: 'REVIEW', targetId: rv.data.id, reason: 'Спам' } });
  const rep = (await admin('/admin/reports')).data.items.find((x) => x.targetType === 'REVIEW' && x.targetId === rv.data.id);
  ok(!!rep?.review, 'review report in the moderation queue');
  await admin(`/admin/reports/${rep.id}/resolve`, { body: { action: 'block', reason: 'тест' } });
  const after = (await guest(`/users/${sellerName}/reviews`)).data;
  ok(!after.items.some((x) => x.id === rv.data.id), 'hidden review disappears from the public list');
  await admin(`/admin/reports/${rep.id}/resolve`, { body: { action: 'unblock' } }).catch(() => null);

  // Unsubscribe from the link in the email.
  const unsub = m1.listUnsubscribe.match(/<([^>]+)>/)[1].replace(/^https?:\/\/[^/]+\/api/, API);
  const page = await fetch(unsub);
  ok(page.status === 200 && (await page.text()).includes('Вы отписались'), 'unsubscribe link works');
  ok((await alex('/auth/me')).data.user.emailPrefs.deals === false, 'deal emails switched off for the seller');
  await alex('/users/me', { method: 'PATCH', body: { emailPrefs: { deals: true } } });
}

// ---------- auction: auto-bids and buy-now ----------
if (!only || only === 'auction') {
  const photo = (await guest('/wardrobes/alex')).data.groups[0].items[0];
  const src = (await alex(`/listings/${photo.id}`)).data;
  const mk = async (title, extra) => {
    const d = await alex('/listings', { body: { photos: [{ id: src.photos[0].id, isDefect: false }], title, category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', condition: 'GOOD', defectsPresent: false, price: 50, deliveryOptions: ['IN_PERSON'], saleType: 'AUCTION', auctionHours: 24, auctionStep: 5, ...extra } });
    const p = await alex(`/listings/${d.data.id}/publish`, { method: 'POST' });
    if (p.status !== 200) console.log('  publish:', p.status, JSON.stringify(p.data).slice(0, 200));
    return { id: d.data.id, auction: p.data.auction };
  };
  const bad = await alex('/listings', { body: { photos: [{ id: src.photos[0].id, isDefect: false }], title: 'Кожаная куртка тест', category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', condition: 'GOOD', defectsPresent: false, price: 50, deliveryOptions: ['IN_PERSON'], saleType: 'AUCTION', auctionHours: 24, auctionBuyNow: 40 } });
  const badPub = await alex(`/listings/${bad.data.id}/publish`, { method: 'POST' });
  ok(badPub.status === 400 && badPub.data.fields?.auctionBuyNow, 'buy-now below start price rejected');
  await alex(`/listings/${bad.data.id}`, { method: 'DELETE' });

  const A = await mk('Чёрная куртка аукцион автоставки', { auctionBuyNow: 120 });
  ok(A.auction?.buyNowPrice === 120 && A.auction.buyNowAvailable, 'auction with buy-now 120 BYN');
  const aid = A.auction.id;
  const r1 = await igor(`/auctions/${aid}/bids`, { body: { maxAmount: 80 } });
  ok(r1.status === 200 && r1.data.auction.currentBid === 50 && r1.data.auction.leaderIsMe && r1.data.auction.myAutoMax === 80, 'igor sets auto-bid 80 → bids 50, leads');
  const r2 = await nastya(`/auctions/${aid}/bids`, { body: { amount: 60 } });
  ok(r2.data.auction.currentBid === 65 && !r2.data.auction.leaderIsMe, 'nastya bids 60 → igor auto-answers 65');
  const r3 = await nastya(`/auctions/${aid}/bids`, { body: { maxAmount: 78 } });
  ok(r3.data.auction.currentBid === 80 && !r3.data.auction.leaderIsMe, 'nastya auto 78 vs igor 80 → igor leads at 80');
  const igorNotes = (await nastya('/notifications?limit=5')).data.items;
  ok(igorNotes.some((n) => n.type === 'auction_outbid' && n.payload.auto), 'nastya notified: her auto-bid ran out');
  ok(r3.data.auction.bids.some((b) => b.auto), 'auto bids are marked in the history');
  const big = await sveta(`/auctions/${aid}/bids`, { body: { maxAmount: 130 } });
  ok(big.status === 400 && big.data.code === 'USE_BUY_NOW', 'auto limit above buy-now → suggest buying out');
  const bn = await sveta(`/auctions/${aid}/buy-now`, { method: 'POST' });
  ok(bn.status === 200 && bn.data.requestId && bn.data.auction.status === 'SOLD' && bn.data.auction.boughtOut, 'sveta buys out at 120 → auction SOLD');
  const deal = (await sveta(`/requests/${bn.data.requestId}`)).data;
  ok(deal.status === 'ACCEPTED' && deal.priceTotal === 120 && deal.source === 'AUCTION', 'buy-now deal ACCEPTED at 120 BYN');
  ok((await igor('/notifications?limit=5')).data.items.some((n) => n.type === 'auction_bought_out'), 'other bidders told the item was bought out');
  ok(!!(await waitMail((x) => x.to?.includes('sveta@ichiba.test') && x.subject.startsWith('Вы выиграли аукцион'))), 'buyer gets the deal email');
  await sveta(`/requests/${bn.data.requestId}/cancel`, { method: 'POST', body: { reason: 'тест' } });

  const B = await mk('Серая куртка аукцион порог выкупа', { auctionBuyNow: 100 });
  await igor(`/auctions/${B.auction.id}/bids`, { body: { amount: 75 } });
  const b2 = (await guest(`/listings/${B.id}`)).data.auction;
  ok(!b2.buyNowAvailable, 'bid at 75% of buy-now hides "Купить сейчас"');
  ok((await nastya(`/auctions/${B.auction.id}/buy-now`, { method: 'POST' })).status === 409, 'buy-now after the threshold → 409');
  const s = await igor(`/auctions/${B.auction.id}/bids`, { body: { maxAmount: 95 } });
  ok(s.status === 200 && s.data.auction.currentBid === 75 && s.data.auction.myAutoMax === 95, 'leader raises auto limit without bidding against himself');
  // Clean up: cancel is impossible with bids, so the test auctions end via hide → 409; delete the drafts we can.
}

// ---------- fit hints + my size ----------
if (!only || only === 'fit') {
  await sveta('/users/me', { method: 'PATCH', body: { sizes: { clothing: ['M'], shoes: ['39'] }, bodyMeasurements: { chest: 92 } } });
  const feed = (await sveta('/search?category=outerwear,knitwear,tshirts,shirts&limit=48')).data.items;
  let withChest = null;
  for (const c of feed) {
    const d = (await sveta(`/listings/${c.id}`)).data;
    if (d.measurements?.chest && !d.isOwner) {
      withChest = d;
      break;
    }
  }
  ok(withChest?.fit?.basis === 'measurements' && withChest.fit.details[0].includes('груди'), `fit by measurements: «${withChest?.fit?.title}» — ${withChest?.fit?.details?.[0]}`);
  const noMeas = (await sveta('/search?size=L&category=outerwear&limit=5')).data.items[0];
  const d2 = noMeas && (await sveta(`/listings/${noMeas.id}`)).data;
  if (d2 && !d2.measurements?.chest) ok(d2.fit?.basis === 'size' && /больше/.test(d2.fit.title), `fit by size label: L vs M → «${d2.fit?.title}»`);
  const mine = (await sveta('/search?my_size=1&limit=24')).data;
  ok(mine.items.length > 0 && mine.items.every((i) => ['M', '39'].includes(i.size)), `"Мой размер" filter: ${mine.total} items`);
  ok((await guest(`/listings/${feed[0].id}`)).data.fit === null, 'guests get no fit hint');
}

// ---------- bump + stats ----------
if (!only || only === 'stats') {
  const w = (await alex('/wardrobes/alex')).data;
  const pub = w.groups.flatMap((g) => g.items).filter((i) => i.status === 'PUBLISHED');
  let target = null;
  for (const c of pub.slice().reverse()) {
    const d = (await alex(`/listings/${c.id}`)).data;
    if (d.owner?.bump?.available) {
      target = d;
      break;
    }
  }
  const b = await alex(`/listings/${target.id}/bump`, { method: 'POST' });
  ok(b.status === 200 && b.data.nextAt, 'bump: listing lifted, next bump scheduled');
  ok((await alex(`/listings/${target.id}/bump`, { method: 'POST' })).status === 409, 'second bump within 72 h → 409');
  const fresh = (await guest('/feed?chip=new&limit=3')).data.items;
  ok(fresh[0].id === target.id, 'bumped listing is first in «Новинки»');
  ok((await sveta(`/listings/${target.id}/bump`, { method: 'POST' })).status === 403, 'only the owner can bump');

  await sveta(`/listings/${target.id}`);
  await igor(`/listings/${target.id}`);
  await igor(`/favorites/${target.id}`, { method: 'POST', body: { source: 'product' } });
  await sleep(500);
  const st = (await alex(`/stats/listings/${target.id}`)).data;
  ok(st.last30.views >= 2 && st.last30.favorites >= 1 && st.series.length === 30, `listing stats: ${st.last30.views} views, ${st.last30.favorites} ♡ in 30 days`);
  const ov = (await alex('/stats/overview?days=7')).data;
  ok(ov.totals.views >= 2 && ov.series.length === 7 && ov.funnel.length === 5 && ov.listings.length > 0, `overview 7d: ${ov.totals.views} views, ${ov.totals.sales} sales, ${ov.listings.length} listings`);
  ok((await igor(`/stats/listings/${target.id}`)).status === 404, 'stats are private to the owner');
  await igor(`/favorites/${target.id}`, { method: 'DELETE' });
}

// ---------- SEO ----------
if (!only || only === 'seo') {
  const s = await guest('/seo/sitemap');
  ok(s.status === 200 && s.data.listings.length > 50 && s.data.wardrobes.length > 5, `sitemap source: ${s.data.listings.length} listings, ${s.data.wardrobes.length} wardrobes`);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
