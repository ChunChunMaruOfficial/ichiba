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
  /**
   * Where the catalogue is read from: the shop's own Payload API (default), a Tilda store (one store part, or several
   * for a shop that keeps each category in its own), or Mechta's own API (`mechtaApi`, mechta.ts).
   */
  tilda?: TildaCatalog | TildaCatalog[];
  mechtaApi?: string;
  /** The brand as listing titles name it, when shorter than `brandName` («KLTR» for «КУЛЬТУРА (KLTR)»). */
  titleBrand?: string;
  /** The shop's product name tidied for a title (an all-caps name in normal case). */
  tidy?(name: string): string;
  /** Kinds by the word a product's name starts with; also what the title drops from the name (its noun replaces it). */
  kinds: KindRule[];
  /** Hosts besides the shop's own that its photos may come from (a platform's CDN). */
  mediaHosts?: string[];
  /** The brand's own name in every spelling the shop uses, lower case: products renamed without it are still matched. */
  brandPattern?: RegExp;
  /** The kind of a product by its name and the shop's category; null = not a thing to list (a mystery box). */
  kind(product: PayloadProduct): ShopKind | null;
}

/** A kind by a pattern of the product's name: the first match wins; null = matched but not a thing to list. */
export type KindRule = [RegExp, ShopKind | null];

/** The kind by the source's rules alone. */
export const kindByName = (rules: KindRule[], name: string) => rules.find(([re]) => re.test(name.trim()))?.[1] ?? null;

/** A Russian word at the start of a name: `\b` doesn't work for Cyrillic, so «the next character is not a letter». */
const ru = (words: string) => new RegExp(`^(?:${words})(?![а-яёa-z])`, 'i');

/** Kinds by the English word the shop starts (or ends) a product's name with; the first match wins. */
const REDHEAD_KINDS: KindRule[] = [
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
  kinds: REDHEAD_KINDS,
  kind: (product) => kindByName(REDHEAD_KINDS, product.name_ru),
};

/** Jeans by their cut when the description names it, otherwise straight. */
const jeansCut = (product: PayloadProduct) => (/широк|wide|baggy|багги|свободн/i.test(product.descriptionText ?? '') ? 'wide' : 'straight');

/** Mechta names its products in Russian, the model after the kind: «Бомбер Haze black», «Zip-худи Base logo pink». */
const MECHTA_KINDS: KindRule[] = [
  [/^zip-?худи(?![а-яё])/i, { category: 'knitwear', subcategory: 'zip-hoodie', noun: 'Зип-худи' }],
  [ru('худи\\s+zip'), { category: 'knitwear', subcategory: 'zip-hoodie', noun: 'Зип-худи' }],
  [ru('худи'), { category: 'knitwear', subcategory: 'hoodie', noun: 'Худи' }],
  [ru('свитшот'), { category: 'knitwear', subcategory: 'sweatshirt', noun: 'Свитшот' }],
  [ru('олимпийка'), { category: 'outerwear', subcategory: 'windbreaker', noun: 'Олимпийка' }],
  [ru('бомбер'), { category: 'outerwear', subcategory: 'bomber', noun: 'Бомбер' }],
  [ru('футболка'), { category: 'tshirts', subcategory: 'tshirt', noun: 'Футболка' }],
  [ru('лонгслив'), { category: 'tshirts', subcategory: 'longsleeve', noun: 'Лонгслив' }],
  [ru('рубашка'), { category: 'shirts', subcategory: 'shirt', noun: 'Рубашка' }],
  [ru('джоггеры'), { category: 'trousers', subcategory: 'joggers', noun: 'Джоггеры' }],
  [ru('брюки'), { category: 'trousers', subcategory: 'trousers', noun: 'Брюки' }],
  [ru('джинсы'), { category: 'jeans', subcategory: 'straight', noun: 'Джинсы' }],
  [ru('шорты'), { category: 'shorts', subcategory: 'shorts', noun: 'Шорты' }],
];

const withCut = (kind: ShopKind | null, product: PayloadProduct) => (kind?.category === 'jeans' ? { ...kind, subcategory: jeansCut(product) } : kind);

const mechta: ShopSourceConfig = {
  key: 'mechtastreetwear',
  brandName: 'Mechta Streetwear',
  titleBrand: 'Mechta',
  origin: 'https://mechtastore.by',
  mechtaApi: 'https://api.mechtastore.by/api',
  currency: 'BYN',
  bio: 'Mechta Streetwear — независимый бренд уличной одежды из Гродно. Худи, бомберы, джоггеры, футболки и лонгсливы своего дизайна. Либо качественно, либо никак.',
  footer: 'Mechta Streetwear — свой бренд уличной одежды из Гродно. Наличие размеров и доставку уточняйте в чате.',
  logoUrl: 'https://mechtastore.by/img/logo.png',
  brandPattern: /mechta/g,
  kinds: MECHTA_KINDS,
  kind: (product) => withCut(kindByName(MECHTA_KINDS, product.name_ru), product),
};

/** КУЛЬТУРА (KLTR) writes names in capitals, the kind first: «ФУТБОЛКА "BLOOM" БЕЛАЯ», «КРОП ЗИП-ХУДИ "FRAME" ЧЕРНЫЙ». */
const KLTR_KINDS: KindRule[] = [
  [ru('кроп\\s+зип-?худи'), { category: 'knitwear', subcategory: 'zip-hoodie', noun: 'Кроп зип-худи' }],
  [ru('зип-?худи'), { category: 'knitwear', subcategory: 'zip-hoodie', noun: 'Зип-худи' }],
  [ru('худи'), { category: 'knitwear', subcategory: 'hoodie', noun: 'Худи' }],
  [ru('свитшот'), { category: 'knitwear', subcategory: 'sweatshirt', noun: 'Свитшот' }],
  [ru('футболка\\s+кроп'), { category: 'tshirts', subcategory: 'tshirt', noun: 'Кроп-футболка' }],
  [ru('футболка'), { category: 'tshirts', subcategory: 'tshirt', noun: 'Футболка' }],
  [ru('лонгслив'), { category: 'tshirts', subcategory: 'longsleeve', noun: 'Лонгслив' }],
  [ru('рубашка'), { category: 'shirts', subcategory: 'shirt', noun: 'Рубашка' }],
  [ru('жилет'), { category: 'outerwear', subcategory: 'vest', noun: 'Жилет' }],
  [ru('рабочая\\s+куртка'), { category: 'outerwear', subcategory: 'jacket', noun: 'Рабочая куртка' }],
  [ru('куртка'), { category: 'outerwear', subcategory: 'jacket', noun: 'Куртка' }],
  [ru('штаны'), { category: 'trousers', subcategory: 'trousers', noun: 'Штаны' }],
  [ru('брюки'), { category: 'trousers', subcategory: 'trousers', noun: 'Брюки' }],
  [ru('джинсы'), { category: 'jeans', subcategory: 'straight', noun: 'Джинсы' }],
  [ru('шорты'), { category: 'shorts', subcategory: 'shorts', noun: 'Шорты' }],
  [ru('кепка'), { category: 'accessories', subcategory: 'cap', noun: 'Кепка' }],
  [ru('панама'), { category: 'accessories', subcategory: 'hat', noun: 'Панама' }],
  [ru('шапка'), { category: 'accessories', subcategory: 'beanie', noun: 'Шапка' }],
  [ru('шарф'), { category: 'accessories', subcategory: 'scarf', noun: 'Шарф' }],
];

/** The shop keeps each category in its own store part (its /shop/… and /collection/… pages); recid can be any block. */
const KLTR_PARTS = [
  '970176725481', '137868595501', '673026101412', '537510189051', '213876649852', '637991565421', '315280906091',
  '565061890502', '830246005642', '431820715502', '124379256582', '478567908192', '917573764311', '112491914992',
  '131520218952', '820295631682', '483624399342', '778132416762', '329237082532',
];

/** Capitals in normal case, except inside «» (the model's own name: «INNER KINDNESS»). */
const lowerCaps = (name: string) =>
  name
    .split(/(«[^»]*»)/)
    .map((part, i) => (i % 2 ? part : part.replace(/[А-ЯЁ][А-ЯЁ-]+/g, (w) => w.toLowerCase())))
    .join('');

const kltr: ShopSourceConfig = {
  key: 'kulturabrand',
  brandName: 'КУЛЬТУРА (KLTR)',
  titleBrand: 'KLTR',
  origin: 'https://kulturabrand.by',
  currency: 'BYN',
  bio: 'КУЛЬТУРА (KLTR) — одежда со смыслом. Kindness. Love. Truth. Reality. Современный белорусский streetwear для тех, кто выбирает быть собой.',
  footer: 'КУЛЬТУРА (KLTR) — белорусский streetwear-бренд. Наличие размеров и доставку уточняйте в чате.',
  logoUrl: 'https://static.tildacdn.biz/tild3662-3665-4730-b462-663766356234/kltr-logo-site.jpg',
  tilda: KLTR_PARTS.map((storepartuid) => ({ storepartuid, recid: '458478773' })),
  mediaHosts: ['tildacdn.biz', 'tildacdn.com'],
  brandPattern: /kltr|культура/g,
  tidy: lowerCaps,
  kinds: KLTR_KINDS,
  kind: (product) => withCut(kindByName(KLTR_KINDS, product.name_ru), product),
};

export const SHOP_SOURCES: ShopSourceConfig[] = [iloveredhead, mechta, kltr];

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
  const name = (cfg.tidy ?? ((n: string) => n))(tidyName(product.name_ru));
  // The rule that matched the name (by pattern: a kind may be adjusted after matching, like the jeans' cut).
  const pattern = cfg.kinds.find(([re, k]) => k?.noun === kind.noun && re.test(name))?.[0];
  let rest = pattern ? name.replace(pattern, '').trim() : name;
  if (!rest) rest = name;
  const named = cfg.brandPattern ? new RegExp(cfg.brandPattern.source, 'i').test(rest) : false;
  const brand = named ? '' : `${cfg.titleBrand ?? cfg.brandName} `;
  return `${kind.noun} ${brand}${rest}`.replace(/\s+/g, ' ').trim().slice(0, 80);
}

const COLOR_WORDS: Record<string, string> = {
  BLACK: 'black', WHITE: 'white', GREY: 'gray', GRAY: 'gray', RED: 'red', PINK: 'pink', BROWN: 'brown',
  BLUE: 'blue', TIFFANY: 'lightblue', GREEN: 'green', BEIGE: 'beige', YELLOW: 'yellow', ORANGE: 'orange', PURPLE: 'purple',
  ЧЁРНЫЙ: 'black', ЧЕРНЫЙ: 'black', БЕЛЫЙ: 'white', СЕРЫЙ: 'gray', КРАСНЫЙ: 'red', РОЗОВЫЙ: 'pink',
  // KLTR and Mechta: feminine and plural forms, and their own colour words.
  ЧЁРНАЯ: 'black', ЧЕРНАЯ: 'black', ЧЁРНЫЕ: 'black', ЧЕРНЫЕ: 'black', ЧЁРНОЕ: 'black', ЧЕРНОЕ: 'black',
  БЕЛАЯ: 'white', БЕЛЫЕ: 'white', БЕЛОЕ: 'white', СЕРАЯ: 'gray', СЕРЫЕ: 'gray', GRAPHITE: 'gray',
  СИНИЙ: 'blue', СИНЯЯ: 'blue', СИНИЕ: 'blue', ГОЛУБОЙ: 'lightblue', ГОЛУБАЯ: 'lightblue', ГОЛУБЫЕ: 'lightblue',
  РОЗОВАЯ: 'pink', РОЗОВЫЕ: 'pink', ХАКИ: 'green', KHAKI: 'green', ОЛИВКОВАЯ: 'green', ОЛИВКОВЫЙ: 'green', OLIVE: 'green',
  LEMON: 'yellow', BORDO: 'red', BURGUNDY: 'red',
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
