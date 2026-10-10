// One-time Gmail API authorisation for sending mail (Railway Hobby blocks SMTP, so mail goes over HTTPS).
// Run from server, with GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET already in .env:
//   node --env-file=.env scripts/gmail-token.mjs
// Opens Google's consent page, receives the code on a local port and writes GMAIL_REFRESH_TOKEN into .env.
// Sign in with the account the mail should come from (SMTP_FROM).
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { OAuth2Client } from 'google-auth-library';

const { GMAIL_CLIENT_ID: id, GMAIL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in server/.env first.');
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}`;
const client = new OAuth2Client(id, secret, redirect);
const url = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // always return a refresh token, even on a repeat run
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

const server = createServer(async (req, res) => {
  const code = new URL(req.url ?? '/', redirect).searchParams.get('code');
  if (!code) return res.writeHead(400).end('No code in the request.');
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google returned no refresh token');
    const env = readFileSync('.env', 'utf8');
    const line = `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`;
    writeFileSync('.env', /^GMAIL_REFRESH_TOKEN=.*$/m.test(env) ? env.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, line) : `${env.trimEnd()}\n${line}\n`);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Готово, окно можно закрыть.');
    console.log('GMAIL_REFRESH_TOKEN saved to server/.env');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`Ошибка: ${e.message}`);
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Opening Google consent page. If it does not open, paste this into the browser:\n\n${url}\n`);
  const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(open);
});
