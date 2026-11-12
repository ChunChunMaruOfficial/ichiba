/**
 * Reads Mechta Streetwear's own shop (mechtastore.by): its site loads the catalogue from a Laravel API,
 * GET /products?limit&offset — each size with its own price, old price and stock status, and the photos with a 600 px
 * copy. Products come out in the importer's shape (payload.ts).
 */

import { hostOrSub, safeFetchText } from '../tg/fetch-safe.js';
import type { PayloadProduct } from './payload.js';

const UA = 'Mozilla/5.0 (compatible; ichiba-shop-import/1.0)';
const PAGE = 100;

interface MechtaSize {
  name?: string | null;
  price?: number | null;
  original_price?: number | null;
  /** «В наличии», «Осталось мало», «Предзаказ». */
  stock_status?: string | null;
  sold_out?: boolean | null;
}

export interface MechtaProduct {
  id: number | string;
  name?: string | null;
  description?: string | null;
  /** «100% нейлон\nПодкладка: …\n\n• ручная стирка…»: the fabric first, then the care. */
  compound?: string | null;
  order?: number | null;
  sizes?: MechtaSize[] | null;
  media?: Array<{ url?: string | null; thumb_600?: string | null }> | null;
  categories?: Array<{ name?: string | null }> | null;
}

/** A size that can be bought now: not sold out and not a pre-order (sewn after the order, weeks later). */
const ready = (s: MechtaSize) => !s.sold_out && !/предзаказ/i.test(s.stock_status ?? '');

const positive = (values: Array<number | null | undefined>) => values.filter((n): n is number => typeof n === 'number' && n > 0);

export function fromMechta(p: MechtaProduct): PayloadProduct {
  const sizes = (p.sizes ?? []).filter((s) => s.name?.trim());
  // Prices of the sizes on sale now (a sold-out size may still carry the old full price).
  const priced = sizes.some(ready) ? sizes.filter(ready) : sizes;
  const prices = positive(priced.map((s) => s.price));
  const olds = positive(priced.map((s) => s.original_price));
  const [fabric, ...care] = (p.compound ?? '').trim().split('\n');
  const description = [p.description?.trim(), fabric?.trim() ? `Состав: ${fabric.trim()}` : '', care.join('\n').trim()].filter(Boolean).join('\n\n');
  const category = (p.categories ?? []).map((c) => c.name?.trim() ?? '').find((n) => n && !/^(все товары|sale)$/i.test(n));
  return {
    id: String(p.id),
    name_ru: (p.name ?? '').trim(),
    category: category ? { name: category } : null,
    price: prices.length ? Math.min(...prices) : null,
    oldPrice: olds.length ? Math.max(...olds) : null,
    descriptionText: description,
    stock: sizes.map((s) => ({ size: s.name!.trim(), quantity: ready(s) ? 1 : 0 })),
    images: (p.media ?? [])
      .filter((m) => m.url)
      .map((m) => ({ image: { url: m.url, sizes: m.thumb_600 ? { product: { url: m.thumb_600 } } : null } })),
    inStock: sizes.some(ready),
    order: p.order ?? null,
  };
}

/** Every product, a page at a time (the API wants both limit and offset). */
export async function fetchMechtaProducts(api: string): Promise<PayloadProduct[]> {
  const allow = hostOrSub(new URL(api).hostname);
  const all: PayloadProduct[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const text = await safeFetchText(`${api}/products?limit=${PAGE}&offset=${offset}`, { allow, userAgent: UA, accept: 'application/json' });
    let body: { data?: MechtaProduct[] };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`${api}/products: not JSON`);
    }
    if (!Array.isArray(body.data)) throw new Error(`${api}/products: no data`);
    all.push(...body.data.map(fromMechta));
    if (body.data.length < PAGE) break;
  }
  return all;
}
