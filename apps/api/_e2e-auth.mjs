// Passwordless auth + privacy e2e (dev mode: AUTH_DEV_ANY_CODE=true accepts any code).
const API = 'http://127.0.0.1:4000';
let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);
const jar = { cookie: '' };
const call = async (path, body, method) => {
  const r = await fetch(`${API}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', cookie: jar.cookie }, body: body ? JSON.stringify(body) : undefined });
  const c = r.headers.get('set-cookie');
  if (c) jar.cookie = c.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};
const stamp = Date.now() % 1e7;

for (const [raw, want] of [['8 029 765-43-21', '+375297654321'], ['29 765 43 22', '+375297654322'], ['+375 (44) 765-43-23', '+375447654323']]) {
  const r = await call('/auth/start', { login: raw });
  ok(r.status === 200 && r.data.target === want, `phone "${raw}" → ${r.data?.target ?? r.data?.message}`);
}
ok((await call('/auth/start', { login: '12345' })).status === 400, 'garbage phone rejected');
ok((await call('/auth/start', { login: 'bad@mail' })).status === 400, 'bad email rejected');
const ru = await call('/auth/start', { login: '+7 916 123-45-67' });
ok(ru.status === 400 && /375/.test(ru.data.message), `non-Belarusian number refused (anti SMS pumping): ${ru.data.message}`);
ok((await call('/auth/start', { login: '8 029 765-43-21' })).status === 429, 'second code within a minute → 429');

// New user by phone: code → signup token → nickname + consent.
const phone = `+3752977${String(stamp).padStart(5, '0').slice(-5)}`;
await call('/auth/start', { login: phone });
const c1 = await call('/auth/confirm', { login: phone, code: '000000' });
ok(c1.status === 200 && c1.data.signup?.token && c1.data.signup.suggestion, `new phone → sign-up step (suggested @${c1.data.signup?.suggestion})`);
ok((await call('/auth/complete', { token: c1.data.signup.token, username: `ph${stamp}` })).status === 400, 'no consent → 400');
const done = await call('/auth/complete', { token: c1.data.signup.token, username: `ph${stamp}`, acceptPrivacy: true });
ok(done.status === 200 && done.data.isNew && done.data.user.username === `ph${stamp}`, 'account created after consent, session started');
ok((await call('/auth/me')).data.user?.username === `ph${stamp}`, 'session cookie works');
ok((await call('/auth/complete', { token: 'x'.repeat(30), username: 'zzz_test', acceptPrivacy: true })).data?.code === 'SIGNUP_EXPIRED', 'forged sign-up token refused');

// Existing user by email: straight into the session.
jar.cookie = '';
await call('/auth/start', { login: 'buyer@ichiba.test' });
const c2 = await call('/auth/confirm', { login: 'buyer@ichiba.test', code: '111111' });
ok(c2.status === 200 && c2.data.user?.username === 'buyer' && !c2.data.signup, 'existing account signs in with a code');

// Delete account → personal data gone, session revoked.
jar.cookie = '';
await new Promise((r) => setTimeout(r, 61_000)); // resend cooldown
await call('/auth/start', { login: phone });
const back = await call('/auth/confirm', { login: phone, code: '000000' });
const beforeCookie = jar.cookie;
ok(back.data.user?.username === `ph${stamp}`, 'same phone signs back in');
ok((await call('/users/me', { confirm: 'wrong' }, 'DELETE')).status === 403, 'deletion needs the exact nickname');
const del = await call('/users/me', { confirm: `ph${stamp}` }, 'DELETE');
ok(del.status === 200, 'account deleted');
jar.cookie = beforeCookie;
ok((await call('/auth/me')).data.user === null, 'old session no longer works');
await new Promise((r) => setTimeout(r, 61_000));
jar.cookie = '';
await call('/auth/start', { login: phone });
const again = await call('/auth/confirm', { login: phone, code: '000000' });
ok(!!again.data.signup, 'the phone is free again → new sign-up');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
