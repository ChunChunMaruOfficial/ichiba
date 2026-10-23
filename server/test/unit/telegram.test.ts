import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationKeyboard } from '../../src/telegram/notifier.js';
import { categoryOf, chatMessage, notificationMessage, notificationPath, tgPrefsOf } from '../../src/telegram/texts.js';

const REQ = '11111111-2222-3333-4444-555555555555';

test('a buy request reads like the site and escapes what users typed', () => {
  const html = notificationMessage('request_new', { buyer: 'anya', title: 'Куртка <b>Carhartt</b> & co', price: 1200, requestId: REQ });
  assert.match(html, /^🛍 <b>Хотят купить<\/b>/);
  assert.match(html, /@anya хочет купить «Куртка &lt;b&gt;Carhartt&lt;\/b&gt; &amp; co» за <b>1\s200 BYN<\/b>/);
  assert.match(chatMessage('x<y', 'Плащ', 'привет <script>'), /@x&lt;y.*привет &lt;script&gt;/s);
});

test('unknown types still make a message', () => {
  assert.match(notificationMessage('something_new', {}), /Новое уведомление/);
});

test('groups and preferences: everything on until switched off', () => {
  assert.equal(categoryOf('request_new'), 'deals');
  assert.equal(categoryOf('review_new'), 'deals');
  assert.equal(categoryOf('offer_likers'), 'offers');
  assert.equal(categoryOf('auction_bid'), 'auctions');
  assert.equal(categoryOf('price_drop'), 'favorites');
  assert.equal(categoryOf('brand_approved'), 'account');
  assert.deepEqual(tgPrefsOf(null), { deals: true, offers: true, auctions: true, chat: true, favorites: true, account: true });
  assert.equal(tgPrefsOf({ chat: false }).chat, false);
});

test('links match the site', () => {
  assert.equal(notificationPath('request_new', { requestId: REQ }), `/deals/${REQ}`);
  assert.equal(notificationPath('auction_won', { requestId: REQ, listingId: 'L' }), `/buy/L?request=${REQ}`);
  assert.equal(notificationPath('offer_new', { listingId: 'L' }), '/sales');
});

test('buttons: answer a request or an offer in Telegram, open the rest on the site', () => {
  process.env.APP_URL = 'https://ichiba.by';
  const request = notificationKeyboard('request_new', { requestId: REQ });
  assert.deepEqual(request[0].map((b) => b.callback_data), [`rq:a:${REQ}`, `rq:d:${REQ}`]);
  assert.equal(request[1][0].url, `https://ichiba.by/deals/${REQ}`);
  // Telegram limits callback data to 64 bytes.
  assert.ok(Buffer.byteLength(request[0][0].callback_data!) <= 64);
  assert.equal(notificationKeyboard('offer_new', { offerId: REQ, listingId: 'L' })[0][0].callback_data, `of:a:${REQ}`);
  assert.deepEqual(notificationKeyboard('price_drop', { listingId: 'L' }), [[{ text: 'Открыть на ichiba', url: 'https://ichiba.by/item/L' }]]);
  // Telegram refuses non-https link buttons (localhost): none are sent then.
  process.env.APP_URL = 'http://localhost:3000';
  assert.deepEqual(notificationKeyboard('price_drop', { listingId: 'L' }), []);
});
