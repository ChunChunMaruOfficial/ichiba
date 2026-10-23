/**
 * Fetching for the importers (Telegram channels, brand web shops). Their URLs come from third-party pages and JSON,
 * so a plain `fetch` would follow anything there: a link into the private network (cloud metadata, the database,
 * Redis — server-side request forgery), a redirect to such a place, or a multi-gigabyte body that fills the memory.
 *
 * Here every request is https only, to a host the caller allows, with redirects followed by hand (each hop checked
 * against the same list), a deadline, and the body read as a stream that is cut off past `maxBytes`.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export interface SafeFetchOptions {
  /** Whether a request may go to this host name (lower case, no port). */
  allow: (host: string) => boolean;
  userAgent: string;
  /** Required for photos: the answer must say it is an image. */
  image?: boolean;
  accept?: string;
  /** Capped at 20 s. */
  timeoutMs?: number;
  /** Capped at 15 MB. */
  maxBytes?: number;
}

/** `host` itself or any subdomain of it. */
export const hostOrSub = (host: string) => (h: string) => h === host || h.endsWith(`.${host}`);

/** Telegram: the channel pages, and the CDNs its photos and avatars are served from. */
export const telegramHost = (h: string) =>
  h === 't.me' || hostOrSub('telegram.org')(h) || hostOrSub('telesco.pe')(h) || /^cdn\d*\.telegram-cdn\.org$/.test(h);

function checkedUrl(raw: string, allow: (host: string) => boolean) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw.slice(0, 200)}`);
  }
  if (url.protocol !== 'https:') throw new Error(`${url.origin}: only https is fetched`);
  if (url.username || url.password) throw new Error(`${url.host}: credentials in the URL`);
  if (!allow(url.hostname.toLowerCase())) throw new Error(`${url.hostname}: host not allowed`);
  return url;
}

/** The response of an allowed URL, redirects followed only to allowed hosts. */
async function open(raw: string, opts: SafeFetchOptions, signal: AbortSignal) {
  let url = checkedUrl(raw, opts.allow);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      headers: { 'user-agent': opts.userAgent, ...(opts.accept ? { accept: opts.accept } : {}) },
      redirect: 'manual',
      signal,
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return { res, url };
    await res.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) throw new Error(`${url.href}: too many redirects`);
    url = checkedUrl(new URL(location, url).href, opts.allow);
  }
}

/** The body of an allowed https URL, at most `maxBytes`. */
export async function safeFetch(raw: string, opts: SafeFetchOptions): Promise<Buffer> {
  const maxBytes = Math.min(opts.maxBytes ?? MAX_BYTES, MAX_BYTES);
  const signal = AbortSignal.timeout(Math.min(opts.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS));
  const { res, url } = await open(raw, opts, signal);
  try {
    if (!res.ok) throw new Error(`${url.href}: HTTP ${res.status}`);
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (opts.image && !type.startsWith('image/')) throw new Error(`${url.href}: not an image (${type || 'no content-type'})`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${url.href}: too large (${declared} bytes)`);
    if (!res.body) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // A missing or lying content-length: the stream itself is cut off.
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${url.href}: too large (over ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    await res.body?.cancel().catch(() => undefined);
    throw e;
  }
}

export async function safeFetchText(raw: string, opts: SafeFetchOptions): Promise<string> {
  return (await safeFetch(raw, opts)).toString('utf8');
}
