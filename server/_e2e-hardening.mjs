// E2E for the 2026-11-09 speed and compliance pass: e-mail unsubscribe that a mail scanner can't trigger, the cart
// cap, the item page's view counter written in the background, Apple sign-up through the consent step, and the
// unread-notifications index. Run against the e2e stand (.claude/launch.json → api-e2e, seeded with
// `SEED_DEMO=true npx tsx prisma/seed.ts`): E2E_API=http://127.0.0.1:4100 JWT_SECRET=<the stand's> node _e2e-hardening.mjs
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const API = process.env.E2E_API ?? 'http://127.0.0.1:4000';
const SECRET = process.env.JWT_SECRET;
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function session(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'password123' }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return async (path, { method, body } = {}) => {
    const res = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    let data = t;
    try {
      data = t ? JSON.parse(t) : null;
    } catch {
      /* html */
    }
    return { status: res.status, data };
  };
}

// ---------- unsubscribe: GET asks, POST does ----------
{
  const { rows } = await db.query(`SELECT id FROM "User" WHERE username = 'kate'`);
  const kate = rows[0].id;
  const bind = () => db.query(`UPDATE "User" SET "notifyEmail" = 'kate-notify@ichiba.test' WHERE id = $1`, [kate]);
  const bound = async () => (await db.query(`SELECT "notifyEmail" FROM "User" WHERE id = $1`, [kate])).rows[0].notifyEmail;
  const token = jwt.sign({ sub: kate, purpose: 'unsubscribe' }, SECRET, { expiresIn: '1h' });
  await bind();

  const page = await fetch(`${API}/email/unsubscribe?token=${encodeURIComponent(token)}`);
  const html = await page.text();
  ok(page.status === 200 && html.includes('Отписаться от писем?') && html.includes('<form method="post"'), 'GET from the letter shows a page with the button');
  ok((await bound()) === 'kate-notify@ichiba.test', 'GET alone (a mail scanner opening the link) leaves the address bound');

  const confirm = await fetch(`${API}/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=1' });
  ok(confirm.status === 200 && (await confirm.text()).includes('Вы отписались'), 'the button answers with the «Вы отписались» page');
  ok((await bound()) === null, 'the button unbinds the address');

  await bind();
  const oneClick = await fetch(`${API}/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  const j = await oneClick.json().catch(() => null);
  ok(oneClick.status === 200 && j?.ok === true && (await bound()) === null, 'RFC 8058 one-click still unsubscribes and answers JSON');

  const bad = await fetch(`${API}/email/unsubscribe?token=broken`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=1' });
  ok(bad.status === 400 && (await bad.text()).includes('Ссылка недействительна'), 'a broken token gets the error page');
}

// ---------- the cart holds at most 100 items ----------
{
  const igor = await session('igor@ichiba.test');
  const me = (await igor('/auth/me')).data?.user;
  ok(!!me?.id, 'igor signs in');
  const free = (
    await db.query(
      `SELECT id FROM "Listing" WHERE status = 'PUBLISHED' AND "sellerId" <> $1 AND "saleType" <> 'AUCTION' AND NOT "priceNegotiable" AND cardinality(sizes) <= 1 ORDER BY "publishedAt" DESC LIMIT 2`,
      [me.id],
    )
  ).rows.map((r) => r.id);
  await db.query(`DELETE FROM "CartItem" WHERE "userId" = $1`, [me.id]);
  const add = await igor(`/cart/${free[0]}`, { body: {} });
  ok(add.status === 201 && add.data?.count === 1, `adding to an empty cart answers count 1 (got ${add.status} ${JSON.stringify(add.data)})`);
  const again = await igor(`/cart/${free[0]}`, { body: {} });
  ok(again.status === 201 && again.data?.count === 1, 'adding the same item again keeps count 1');
  // «Добавить образ в корзину» (client looks/[id]) posts with no body at all.
  const bare = await igor(`/cart/${free[1]}`, { method: 'POST' });
  ok(bare.status === 201 && bare.data?.count === 2, `a POST with no body adds too (got ${bare.status} ${JSON.stringify(bare.data).slice(0, 120)})`);
  // Fill the cart to the cap with rows straight in the database (other listings, any status: only the count matters).
  await db.query(`DELETE FROM "CartItem" WHERE "userId" = $1`, [me.id]);
  await db.query(
    `INSERT INTO "CartItem" ("userId", "listingId", "addedAt") SELECT $1, id, now() FROM "Listing" WHERE id <> $2 AND id <> $3 ORDER BY id LIMIT 100`,
    [me.id, free[0], free[1]],
  );
  const held = Number((await db.query(`SELECT count(*) FROM "CartItem" WHERE "userId" = $1`, [me.id])).rows[0].count);
  if (held === 100) {
    const full = await igor(`/cart/${free[0]}`, { body: {} });
    ok(full.status === 400 && full.data?.code === 'CART_FULL', `the 101st item is refused with CART_FULL (got ${full.status} ${full.data?.code})`);
    const list = await igor('/cart');
    ok(list.status === 200, 'a full cart still lists');
  } else {
    console.log(`SKIP cart cap: only ${held} listings in the seed`);
  }
  await db.query(`DELETE FROM "CartItem" WHERE "userId" = $1`, [me.id]);
}

// ---------- item page: the view is counted in the background ----------
{
  const { rows } = await db.query(`SELECT id, "viewsCount" FROM "Listing" WHERE status = 'PUBLISHED' ORDER BY "publishedAt" DESC OFFSET 3 LIMIT 1`);
  const { id, viewsCount } = rows[0];
  const t0 = Date.now();
  const r = await fetch(`${API}/listings/${id}`, { headers: { 'x-real-ip': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const body = await r.json();
  ok(r.status === 200 && body.id === id && Array.isArray(body.photos) && body.seller?.username, `the item page answers with its photos and seller (${Date.now() - t0} ms)`);
  let after = viewsCount;
  for (let i = 0; i < 20 && after === viewsCount; i++) {
    await sleep(150);
    after = (await db.query(`SELECT "viewsCount" FROM "Listing" WHERE id = $1`, [id])).rows[0].viewsCount;
  }
  ok(after === viewsCount + 1, `the view is counted once, after the answer (${viewsCount} → ${after})`);
}

// ---------- Apple: a new person goes through the nickname + consent step ----------
{
  const sub = `apple-e2e-${Date.now()}`;
  const token = jwt.sign({ purpose: 'signup', kind: 'apple', sub, email: `${sub}@privaterelay.appleid.com`, nameHint: 'appler' }, SECRET, { expiresIn: '15m' });
  const username = `ap${Date.now().toString(36)}`.slice(0, 20);
  const noConsent = await fetch(`${API}/auth/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, username }) });
  ok(noConsent.status === 400, 'completing an Apple sign-up without consent is refused');
  const done = await fetch(`${API}/auth/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, username, acceptPrivacy: true }) });
  ok(done.status === 200 && !!done.headers.get('set-cookie'), `completing it with consent starts a session (got ${done.status})`);
  const u = (await db.query(`SELECT "appleSub", "privacyAcceptedAt", "privacyVersion", email FROM "User" WHERE username = $1`, [username])).rows[0];
  ok(u?.appleSub === sub && !!u.privacyAcceptedAt && !!u.privacyVersion, 'the account has the Apple id and a consent timestamp with the policy version');
  const twice = await fetch(`${API}/auth/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, username: `${username}x`, acceptPrivacy: true }) });
  const users = Number((await db.query(`SELECT count(*) FROM "User" WHERE "appleSub" = $1`, [sub])).rows[0].count);
  ok(twice.status === 200 && users === 1, 'a second tab with the same token signs into the same account');
}

// ---------- the unread-notifications index ----------
{
  const { rows } = await db.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'Notification' AND indexname = 'Notification_userId_readAt_idx'`);
  ok(rows.length === 1 && rows[0].indexdef.includes('"userId", "readAt"'), 'Notification has the (userId, readAt) index');
}

await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
