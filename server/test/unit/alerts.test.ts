import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlertGate, alertKey, alertText, redact } from '../../src/common/alerts.js';

test('the same error goes out once an hour, all errors at most 20 an hour', () => {
  let now = 0;
  const gate = new AlertGate(60 * 60_000, 20, () => now);
  assert.ok(gate.allow('a'));
  assert.ok(!gate.allow('a'));
  now += 61 * 60_000;
  assert.ok(gate.allow('a'));
  for (let i = 0; i < 19; i++) assert.ok(gate.allow(`k${i}`));
  assert.ok(!gate.allow('one more'), 'the hourly cap');
  now += 61 * 60_000;
  assert.ok(gate.allow('one more'));
});

test('ids and numbers do not make an error new', () => {
  assert.equal(
    alertKey('ShopImport', 'sync failed for 3f0e8a1c-1b2c-4d5e-8f90-1234567890ab: HTTP 404'),
    alertKey('ShopImport', 'sync failed for 77777777-1b2c-4d5e-8f90-1234567890ab: HTTP 502'),
  );
  assert.notEqual(alertKey('ShopImport', 'sync failed'), alertKey('TgImport', 'sync failed'));
});

test('secrets and personal data never reach the chat', () => {
  const text = redact(
    'POST https://api.telegram.org/bot123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw failed; db postgres://admin:hunter2@db:5432/x; ' +
      'Authorization: Bearer abc.def.ghi; password=qwerty; mail anna@example.com, phone +375 29 123-45-67',
  );
  for (const leak of ['AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', 'hunter2', 'abc.def.ghi', 'qwerty', 'anna@example.com', '123-45-67']) assert.ok(!text.includes(leak), leak);
  // Dates and status codes stay readable.
  assert.match(redact('2026-10-28 21:24 HTTP 404'), /2026-10-28 21:24 HTTP 404/);
});

test('the message names the place, escapes HTML and stays short', () => {
  const html = alertText('Shop<Import>', 'x'.repeat(2000), 'Error\n    at a (a.ts:1)\n    at b (b.ts:2)');
  assert.ok(html.startsWith('⚠️ <b>ichiba</b> · Shop&lt;Import&gt;'));
  assert.ok(html.length < 700);
});
