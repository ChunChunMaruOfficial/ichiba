import { COLOR_VALUES } from '../catalog/catalog.js';
import type { PayloadProduct } from './payload.js';
import type { TildaCatalog } from './tilda.js';

/**
 * Brands whose own web shops are mirrored as seller accounts (nick = key). The catalogue is read from the shop's
 * API every few hours: new products are listed, sold-out or hidden ones are hidden, price and size changes are
 * copied, products gone from the shop take their listings down.
 */

/** What a product becomes on ichiba: catalogue place and the Russian name of the kind of thing. */
export interface ShopKind {
  category: string;
  subcategory: string;
  /** «Шапка», «Бомбер»… — the start of the listing's title. */
  noun: string;
  gender?: 'FEMALE' | 'MALE';
}

export interface ShopSourceConfig {
  /** The seller's nick and the source's key. */
  key: string;
  brandName: string;
  origin: string;
  /** The shop's prices are in this currency; listings are in BYN at the National Bank rate. */
  currency: 'RUB' | 'BYN';
  bio: string;
  /** Appended to every listing's description. */
  footer: string;
  /** Square-ish logo for the profile photo (SVG or raster). */
  logoUrl?: string;
  /** Where the catalogue is read from: the shop's own Payload API (default) or a Tilda store. */
  tilda?: TildaCatalog;
  /** Hosts besides the shop's own that its photos may come from (a platform's CDN). */
  mediaHosts?: string[];
  /** The brand's own name in every spelling the shop uses, lower case: products renamed without it are still matched. */
  brandPattern?: RegExp;
  /** The kind of a product by its name and the shop's category; null = not a thing to list (a mystery box). */
  kind(product: PayloadProduct): ShopKind | null;
}

/** Kinds by the English word the shop starts (or ends) a product's name with; the first match wins. */
const REDHEAD_KINDS: Array<[RegExp, ShopKind | null]> = [
  [/^big zip ?hoodie\b/i, { category: 'knitwear', subcategory: 'zip-hoodie', noun: 'Зип-худи оверсайз' }],
  [/^zip ?hoodie\b/i, { category: 'knitwear', subcategory: 'zip-hoodie', noun: 'Зип-худи' }],
  [/^hoodie\b/i, { category: 'knitwear', subcategory: 'hoodie', noun: 'Худи' }],
  [/^bomber\b/i, { category: 'outerwear', subcategory: 'bomber', noun: 'Бомбер' }],
  [/^fur coat\b/i, { category: 'outerwear', subcategory: 'fur', noun: 'Шуба' }],
  [/^t-?shirt\b/i, { category: 'tshirts', subcategory: 'tshirt', noun: 'Футболка' }],
  [/^tank-?top\b/i, { category: 'tshirts', subcategory: 'tank', noun: 'Майка', gender: 'FEMALE' }],
  [/^top\b/i, { category: 'tshirts', subcategory: 'top', noun: 'Топ', gender: 'FEMALE' }],
  [/^jersey shorts\b/i, { category: 'shorts', subcategory: 'sport-shorts', noun: 'Шорты' }],
  [/^shorts\b/i, { category: 'shorts', subcategory: 'shorts', noun: 'Шорты', gender: 'FEMALE' }],
  [/^s[cс]arf\b/i, { category: 'accessories', subcategory: 'scarf', noun: 'Шарф' }],
  [/^hat\b/i, { category: 'accessories', subcategory: 'beanie', noun: 'Шапка' }],
  [/\bcap$/i, { category: 'accessories', subcategory: 'cap', noun: 'Кепка' }],
  [/\btote bag$/i, { category: 'bags', subcategory: 'tote', noun: 'Шоппер' }],
  [/\bbag$/i, { category: 'bags', subcategory: 'backpack', noun: 'Рюкзак' }],
  [/^keychain\b/i, { category: 'accessories', subcategory: 'other', noun: 'Брелок' }],
  [/^glasses\b/i, { category: 'accessories', subcategory: 'glasses', noun: 'Очки' }],
  [/\bbox$/i, null],
];

const iloveredhead: ShopSourceConfig = {
  key: 'iloveredhead',
  brandName: 'I LOVE REDHEAD',
  origin: 'https://iloverh.com',
  currency: 'RUB',
  bio: 'I LOVE REDHEAD — одежда для тех, кто не хочет выглядеть нормально. Уличная одежда и лимитированные коллекции: шапки, худи, бомберы, футболки. Быть заметным без усилия.',
  footer: 'I LOVE REDHEAD — свой бренд уличной одежды. Наличие размеров и сроки отправки уточняйте в чате.',
  logoUrl: 'https://iloverh.com/images/logo_redhead_compoundBLACK.svg',
  // Moved from Payload to Tilda in October 2026: the store part and block of https://iloverh.com/katalog.
  tilda: { storepartuid: '483668660622', recid: '5037016001' },
  mediaHosts: ['tildacdn.com'],
  brandPattern: /i\s*(love|<3)\s*redhead|redhead/g,
  kind(product) {
    const name = product.name_ru.trim();
    for (const [re, kind] of REDHEAD_KINDS) if (re.test(name)) return kind;
    return null;
  },
};

export const SHOP_SOURCES: ShopSourceConfig[] = [iloveredhead];

/** Shop names use “”, „“ and "" in any mix; ichiba titles use «». */
export function tidyName(name: string) {
  return name
    .replace(/[“”„"«»]\s*([^“”„"«»]+?)\s*[“”„"«»]/g, '«$1»')
    .replace(/\bBLANCK\b/g, 'BLANK')
    .replace(/(?<=[A-Z])С|С(?=[A-Z])/g, 'C') // a Cyrillic С typed among Latin letters (SСARF)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The listing title: the kind in Russian, the brand when the name doesn't carry it, then the shop's name. */
export function listingTitle(cfg: ShopSourceConfig, product: PayloadProduct, kind: ShopKind) {
  const name = tidyName(product.name_ru);
  const pattern = REDHEAD_KINDS.find(([re, k]) => k === kind && re.test(name))?.[0];
  let rest = pattern ? name.replace(pattern, '').trim() : name;
  if (!rest) rest = name;
  const brand = /redhead/i.test(rest) ? '' : `${cfg.brandName} `;
  return `${kind.noun} ${brand}${rest}`.replace(/\s+/g, ' ').trim().slice(0, 80);
}

const COLOR_WORDS: Record<string, string> = {
  BLACK: 'black', WHITE: 'white', GREY: 'gray', GRAY: 'gray', RED: 'red', PINK: 'pink', BROWN: 'brown',
  BLUE: 'blue', TIFFANY: 'lightblue', GREEN: 'green', BEIGE: 'beige', YELLOW: 'yellow', ORANGE: 'orange', PURPLE: 'purple',
  ЧЁРНЫЙ: 'black', ЧЕРНЫЙ: 'black', БЕЛЫЙ: 'white', СЕРЫЙ: 'gray', КРАСНЫЙ: 'red', РОЗОВЫЙ: 'pink',
};

/** The colour named in the product's name, when exactly one is; otherwise the AI looks at the photo. */
export function colorFromName(name: string): string | undefined {
  const found = new Set((name.toUpperCase().match(/[A-ZА-ЯЁ]+/g) ?? []).map((w) => COLOR_WORDS[w]).filter(Boolean));
  const [only] = [...found];
  return found.size === 1 && COLOR_VALUES.includes(only) ? only : undefined;
}

/** «Материал: хлопок, акрил» from the description, for the listing's material field. */
export function materialFrom(text: string): string | undefined {
  const m = text.match(/(?:материал|состав)\s*:\s*([^\n]+)/i)?.[1]?.trim().replace(/[.;\s]+$/, '');
  if (!m) return undefined;
  return (m.charAt(0).toUpperCase() + m.slice(1)).slice(0, 40);
}

/** Sizes as the shop writes them («S-М» with a Cyrillic М, « XL») in one spelling. */
export function tidySize(size: string) {
  const latin: Record<string, string> = { М: 'M', С: 'C', Х: 'X' };
  return size
    .trim()
    .toUpperCase()
    .replace(/[МСХ]/g, (c) => latin[c])
    .replace(/\s+/g, ' ');
}
