/**
 * Reads a shop built on Payload CMS (its public REST API: GET /api/products). Only what the importer needs is
 * typed; everything else in a product is ignored. Its product shape is the importer's own: other platforms
 * (tilda.ts) are read into it.
 */

import { hostOrSub, safeFetch, safeFetchText } from '../tg/fetch-safe.js';

const UA = 'Mozilla/5.0 (compatible; ichiba-shop-import/1.0)';

/**
 * Requests for a shop go only to the shop's own host (and its subdomains), or to the CDN its platform keeps photos on:
 * its JSON can't point us elsewhere.
 */
const shopHosts = (origin: string, media: string[] = []) => {
  const hosts = [new URL(origin).hostname.toLowerCase(), ...media].map(hostOrSub);
  return (h: string) => hosts.some((ok) => ok(h));
};

interface PayloadMedia {
  url?: string | null;
  /** Smaller copies the CMS made (some cropped to a frame), by name: product, heroMobile, card… */
  sizes?: Record<string, { url?: string | null; width?: number | null } | null> | null;
}

export interface PayloadProduct {
  id: number | string;
  name_ru: string;
  slug?: string | null;
  category?: { slug?: string | null; name?: string | null } | null;
  price?: number | null;
  oldPrice?: number | null;
  /** Rich text (Lexical JSON). */
  description_ru?: unknown;
  /** The description as plain text, for platforms that give it so (Tilda). */
  descriptionText?: string | null;
  stock?: Array<{ size?: string | null; quantity?: number | null }> | null;
  images?: Array<{ image?: PayloadMedia | null }> | null;
  sizeChart?: PayloadMedia | null;
  inStock?: boolean | null;
  isNew?: boolean | null;
  hidden?: boolean | null;
  order?: number | null;
  shippingText?: string | null;
  createdAt?: string | null;
}

/** Every product, page by page (hidden ones too: the importer decides what to show). */
export async function fetchProducts(origin: string): Promise<PayloadProduct[]> {
  const all: PayloadProduct[] = [];
  for (let page = 1; page <= 50; page++) {
    const text = await safeFetchText(`${origin}/api/products?limit=100&depth=1&page=${page}`, { allow: shopHosts(origin), userAgent: UA, accept: 'application/json' });
    let body: { docs?: PayloadProduct[]; hasNextPage?: boolean };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`${origin}/api/products: not JSON`);
    }
    if (!Array.isArray(body.docs)) throw new Error(`${origin}/api/products: no docs`);
    all.push(...body.docs);
    if (!body.hasNextPage) break;
  }
  return all;
}

/** An image from the shop's own host or its platform's CDN: https, at most 15 MB, 20 s. */
export async function download(origin: string, url: string, media: string[] = []): Promise<Buffer> {
  return safeFetch(url, { allow: shopHosts(origin, media), userAgent: UA, image: true });
}

/**
 * A photo by its candidates in order (the original, then the CMS's own smaller copy): a shop that serves
 * multi-megabyte originals slowly still gives each item all its photos. The original gets a second try.
 */
export async function downloadFirst(origin: string, urls: string[], media: string[] = []): Promise<Buffer> {
  let last: unknown;
  for (const [i, url] of urls.entries()) {
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      try {
        return await download(origin, url, media);
      } catch (e) {
        last = e;
      }
    }
  }
  throw last instanceof Error ? last : new Error('photo not downloaded');
}

/** The original first, then the largest copy that keeps the whole photo (not a fixed-frame crop) or the 800 px one. */
export function photoCandidates(media: PayloadMedia | null | undefined): string[] {
  if (!media?.url) return [];
  const copy = media.sizes?.product?.url ?? media.sizes?.heroMobile?.url;
  return [media.url, ...(copy ? [copy] : [])];
}

/** Plain text of a Lexical rich-text value: paragraphs on their own lines, at most one empty line between them. */
export function lexicalText(value: unknown): string {
  const walk = (n: unknown): string => {
    if (!n || typeof n !== 'object') return '';
    const node = n as { type?: string; text?: string; children?: unknown[] };
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'linebreak') return '\n';
    const inner = (node.children ?? []).map(walk).join('');
    return ['paragraph', 'heading', 'listitem', 'quote'].includes(node.type ?? '') ? `${inner}\n` : inner;
  };
  const root = (value as { root?: unknown } | null)?.root ?? value;
  return walk(root)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
