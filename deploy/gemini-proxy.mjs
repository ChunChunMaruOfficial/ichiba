// Gemini is not served in Belarus («User location is not supported»), so the API's calls to it go through this
// small relay: GEMINI_BASE_URL=http://gemini-proxy:8787/v1beta (docker-compose.yml). It forwards each request to
// generativelanguage.googleapis.com through one of the upstream HTTP proxies listed in PROXIES_FILE, one per line
// as `user:pass@host:port`. The connection to Google is a TLS tunnel (CONNECT): a proxy sees the host name only,
// never the API key or the content.
//
// The proxies are rotating residential sessions: an exit address changes every few minutes and may land in a
// country Google refuses. So nothing is «the working one»: the relay stays on a proxy while it answers and moves
// to the next on a connection error, a timeout or a location refusal, a few times per request.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const TARGET = process.env.GEMINI_TARGET ?? 'generativelanguage.googleapis.com';
const PORT = Number(process.env.PORT ?? 8787);
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 4);
const CONNECT_MS = Number(process.env.CONNECT_MS ?? 10_000);
const REQUEST_MS = Number(process.env.REQUEST_MS ?? 60_000);

const proxies = readFileSync(process.env.PROXIES_FILE ?? '/app/proxies.txt', 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const at = l.lastIndexOf('@');
    const [host, port] = l.slice(at + 1).split(':');
    return { auth: at < 0 ? '' : l.slice(0, at), host, port: Number(port) };
  });
if (!proxies.length) throw new Error('no proxies in PROXIES_FILE');
let current = 0;
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

/** A TLS socket to Google through proxy `p`. */
function tunnel(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: p.host,
      port: p.port,
      method: 'CONNECT',
      path: `${TARGET}:443`,
      headers: { Host: `${TARGET}:443`, ...(p.auth ? { 'Proxy-Authorization': `Basic ${Buffer.from(p.auth).toString('base64')}` } : {}) },
      timeout: CONNECT_MS,
    });
    req.on('timeout', () => req.destroy(new Error('proxy connect timeout')));
    req.on('error', reject);
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`proxy answered ${res.statusCode}`));
      }
      const secure = tls.connect({ socket, servername: TARGET }, () => resolve(secure));
      secure.on('error', reject);
    });
    req.end();
  });
}

/** One try through proxy `p`: resolves with the upstream response, or rejects when another proxy should be tried. */
async function attempt(p, method, path, headers, body) {
  const socket = await tunnel(p);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: TARGET, method, path, headers, createConnection: () => socket, timeout: REQUEST_MS }, (res) => {
      // A refusal by location comes as a small 400: read it before deciding; everything else is passed on as is.
      if (res.statusCode !== 400) return resolve({ res });
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (/location is not supported/i.test(buf.toString('utf8'))) reject(new Error('location refused'));
        else resolve({ res, buf });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

http
  .createServer((req, res) => {
    if (req.url === '/healthz') return res.end(`ok, ${proxies.length} proxies, on #${current + 1}\n`);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers, host: TARGET, connection: 'close' };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      if (body.length) headers['content-length'] = String(body.length);
      let last = '';
      for (let i = 0; i < Math.min(ATTEMPTS, proxies.length); i++) {
        const n = current;
        try {
          const out = await attempt(proxies[n], req.method, req.url, headers, body);
          res.writeHead(out.res.statusCode, out.res.headers);
          if (out.buf) return res.end(out.buf);
          return out.res.pipe(res);
        } catch (e) {
          last = e.message;
          // Only the proxy this request used is given up on: another request may already have moved on.
          if (current === n) current = (n + 1) % proxies.length;
          log(`proxy #${n + 1} failed (${last}), next is #${current + 1}`);
        }
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 502, message: `gemini relay: no proxy got through (${last})`, status: 'UNAVAILABLE' } }));
    });
  })
  .listen(PORT, () => log(`gemini relay on :${PORT}, ${proxies.length} proxies`));
