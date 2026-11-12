/**
 * Reads a shop built on Tilda's online store: the catalogue block on the shop's page loads its products from
 * store.tildaapi.com (getproductslist), a public JSON API. Each product comes out in the shape the importer already
 * knows from Payload shops (payload.ts), so the rest of the sync doesn't care which platform a shop is on.
 */

import { hostOrSub, safeFetchText } from '../tg/fetch-safe.js';
import type { PayloadProduct } from './payload.js';

const UA = 'Mozilla/5.0 (compatible; ichiba-shop-import/1.0)';
const API = 'https://store.tildaapi.com/api/getproductslist/';
/** A project on Tilda Business answers the .com API with {"redirectto":"biz"}: its catalogue is on the .biz one. */
const API_BIZ = 'https://store.tildaapi.biz/api/getproductslist/';
const apiHosts = [hostOrSub('tildaapi.com'), hostOrSub('tildaapi.biz')];
const apiHost = (host: string) => apiHosts.some((ok) => ok(host));

/** Where a shop's catalogue lives on Tilda: the store part and the page block that shows it (both in the page HTML). */
export interface TildaCatalog {
  storepartuid: string;
  recid: string;
}

interface TildaEdition {
  price?: string;
  priceold?: string;
  quantity?: string;
  [option: string]: string | undefined;
}

interface TildaProduct {
  uid: number | string;
  title?: string;
  text?: string;
  descr?: string;
  price?: string;
  priceold?: string;
  /** "" = not counted (always in stock), otherwise how many are left. */
  quantity?: string;
  mark?: string;
  /** JSON: [{ img }]. */
  gallery?: string;
  /** JSON: [{ title: "SIZE", values: [...] }]. */
  json_options?: string;
  editions?: TildaEdition[];
}

/** «12 990.00» → 12990; empty or broken → null. */
const amount = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–' };
const decode = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** Plain text of Tilda's description HTML: line breaks kept, tags dropped, at most one empty line between paragraphs. */
export function tildaText(html: string | undefined): string {
  return decode(
    (html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJson<T>(s: string | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** One product in the importer's shape: sizes and stock from the editions, the biggest old price, the gallery. */
export function fromTilda(p: TildaProduct): PayloadProduct {
  const editions = p.editions ?? [];
  // The option editions differ by (SIZE, or whatever the shop called it): the first option's title from json_options.
  const option = parseJson<Array<{ title?: string }>>(p.json_options, [])[0]?.title;
  const count = (q: string | undefined) => (q === undefined || q === '' ? 1 : Number(q) || 0);
  const stock = option ? editions.map((e) => ({ size: e[option] ?? null, quantity: count(e.quantity) })) : [];
  const prices = [p.price, ...editions.map((e) => e.price)].map(amount).filter((n): n is number => n !== null);
  const olds = [p.priceold, ...editions.map((e) => e.priceold)].map(amount).filter((n): n is number => n !== null);
  const inStock = stock.length ? stock.some((s) => s.quantity > 0) : count(p.quantity) > 0;
  return {
    id: String(p.uid),
    name_ru: decode(p.title ?? '').trim(),
    price: prices.length ? Math.min(...prices) : null,
    oldPrice: olds.length ? Math.max(...olds) : null,
    descriptionText: tildaText(p.text),
    stock,
    images: parseJson<Array<{ img?: string }>>(p.gallery, [])
      .map((g) => g.img)
      .filter((u): u is string => !!u)
      .map((url) => ({ image: { url } })),
    inStock,
    isNew: /new|нов/i.test(p.mark ?? ''),
    shippingText: tildaText(p.descr) || null,
  };
}

/** Every product of the store part, 100 at a time (Tilda's slices). */
export async function fetchTildaProducts(catalog: TildaCatalog): Promise<PayloadProduct[]> {
  const all: PayloadProduct[] = [];
  let api = API;
  for (let slice = 1; slice <= 50; slice++) {
    const query = new URLSearchParams({ storepartuid: catalog.storepartuid, recid: catalog.recid, c: String(Date.now()), getparts: 'true', getoptions: 'true', slice: String(slice), size: '100' });
    const text = await safeFetchText(`${api}?${query}`, { allow: apiHost, userAgent: UA, accept: 'application/json' });
    let body: { products?: TildaProduct[]; nextslice?: number; redirectto?: string };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error('store.tildaapi: not JSON');
    }
    if (body.redirectto === 'biz' && api === API) {
      api = API_BIZ;
      slice--;
      continue;
    }
    if (!Array.isArray(body.products)) throw new Error(`store.tildaapi: no products in store part ${catalog.storepartuid}`);
    all.push(...body.products.map(fromTilda));
    if (!body.nextslice) break;
  }
  return all;
}

/**
 * Several store parts (a shop that keeps each category in its own): every product once, in the parts' order — a
 * product shown in two parts («Футболки» and «SALE») is the same uid. A part that fails fails the whole read: a
 * catalogue read in part would take the missing products' listings down.
 */
export async function fetchTildaCatalogs(catalogs: TildaCatalog[]): Promise<PayloadProduct[]> {
  const seen = new Set<string>();
  const all: PayloadProduct[] = [];
  for (const catalog of catalogs) {
    for (const p of await fetchTildaProducts(catalog)) {
      if (seen.has(String(p.id))) continue;
      seen.add(String(p.id));
      all.push(p);
    }
  }
  return all;
}
