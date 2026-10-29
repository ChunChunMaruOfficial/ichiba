import { brandKey, brandRussian } from '../catalog/brands.js';
import { categoryBySlug } from '../catalog/catalog.js';
import type { Condition, DeliveryMethod, Gender, ListingMarket } from '../generated/prisma/client.js';
import { cap, CITY_IN, DESCRIPTION_MAX, fit, slugify, TITLE_MAX } from './seo.js';

/**
 * Landing pages: the brand and category pages that broad searches land on («куртка carhartt минск», «джинсы клёш б/у»).
 * Big marketplaces (Avito, Kufar, Lamoda, Vinted) win those queries with such pages, while an item's own page wins
 * the exact item. /search stays out of search engines (endless thin lists), so only a fixed set of pages is offered:
 * - /c/<category>, /c/<category>/<subcategory>;
 * - /c/women/<category>[/<subcategory>] and /c/men/…: «женские джинсы», «мужские куртки»;
 * - /brands/<brand>, /brands/<brand>/<category>, /brands/<brand>/<category>/<subcategory>.
 * A page is indexed only with MIN_ITEMS live items, and a narrower page only when it shows less than each page above it
 * (a brand that only sells jackets has its brand page, not a copy of it at /brands/x/outerwear/jacket; «Женские джинсы»
 * where no jeans are marked for men or women would be «Джинсы» again). Everything the page says (its name, counts,
 * prices, cities) comes from the live listings themselves.
 */

/** Fewer live items than this and the page is thin: it still opens, but search engines are told to skip it. */
export const MIN_ITEMS = 6;

/** A listing on sale, as the landing pages count it. Rows come in the order pages show them (freshest first). */
export interface LiveRow {
  id: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  market: ListingMarket;
  gender: Gender | null;
  condition: Condition | null;
  price: number | null;
  priceNegotiable: boolean;
  city: string | null;
  deliveryOptions: DeliveryMethod[];
  updatedAt: Date;
}

export type LandingKind = 'category' | 'subcategory' | 'gender-category' | 'gender-subcategory' | 'brand' | 'brand-category' | 'brand-subcategory';
export type Audience = 'FEMALE' | 'MALE';

export interface Landing {
  /** Address without the leading slash: «c/jeans/flare», «brands/carhartt/outerwear». */
  path: string;
  kind: LandingKind;
  /** The page's H1 and the name links to it use: «Джинсы клёш», «Куртки Carhartt». */
  name: string;
  /** Short name for a breadcrumb under its parent: «Верхняя одежда» under Carhartt. */
  crumb: string;
  brand: { name: string; slug: string } | null;
  gender: Audience | null;
  category: string;
  subcategory: string | null;
  /** The page above it in breadcrumbs. */
  parent: string | null;
  /** Another wider page it must differ from: «Женские широкие джинсы» from «Широкие джинсы». */
  also?: string;
  indexable: boolean;
  rows: LiveRow[];
  updatedAt: Date;
}

/** Category names in the plural, as people search for them; the catalogue labels are used where they already are. */
const CATEGORY_NAMES: Record<string, string> = { swimwear: 'Купальники и домашняя одежда' };

/** Subcategories in the plural («Джинсы клёш», not the catalogue's «Клёш»). */
const SUBCATEGORY_NAMES: Record<string, string> = {
  jacket: 'Куртки', 'leather-jacket': 'Кожаные куртки', 'denim-jacket': 'Джинсовые куртки', bomber: 'Бомберы', windbreaker: 'Ветровки',
  parka: 'Парки', coat: 'Пальто', puffer: 'Пуховики', trench: 'Тренчи', raincoat: 'Плащи', fur: 'Шубы', sheepskin: 'Дублёнки', vest: 'Жилеты',
  tshirt: 'Футболки', longsleeve: 'Лонгсливы', top: 'Топы', tank: 'Майки', polo: 'Поло',
  shirt: 'Рубашки', blouse: 'Блузки', overshirt: 'Овершоты', tunic: 'Туники',
  sweater: 'Свитера', turtleneck: 'Водолазки', hoodie: 'Худи', 'zip-hoodie': 'Зип-худи', sweatshirt: 'Свитшоты', cardigan: 'Кардиганы',
  trousers: 'Брюки', chinos: 'Чиносы', cargo: 'Брюки карго', joggers: 'Джоггеры', sweatpants: 'Спортивные штаны', leggings: 'Леггинсы',
  straight: 'Прямые джинсы', slim: 'Джинсы слим', skinny: 'Джинсы скинни', wide: 'Широкие джинсы', mom: 'Джинсы мом', baggy: 'Джинсы багги',
  flare: 'Джинсы клёш',
  shorts: 'Шорты', 'denim-shorts': 'Джинсовые шорты', 'sport-shorts': 'Спортивные шорты', bermuda: 'Бермуды',
  mini: 'Юбки мини', midi: 'Юбки миди', maxi: 'Юбки макси', pleated: 'Юбки плиссе', pencil: 'Юбки-карандаш', 'denim-skirt': 'Джинсовые юбки',
  dress: 'Платья', 'evening-dress': 'Вечерние платья', 'shirt-dress': 'Платья-рубашки', 'knit-dress': 'Трикотажные платья', sundress: 'Сарафаны',
  jumpsuit: 'Комбинезоны',
  suit: 'Костюмы', pantsuit: 'Брючные костюмы', blazer: 'Пиджаки', tracksuit: 'Спортивные костюмы',
  swimsuit: 'Купальники', 'swim-trunks': 'Плавки', pajamas: 'Пижамы', robe: 'Халаты', homewear: 'Домашние костюмы',
  sneakers: 'Кроссовки', keds: 'Кеды', boots: 'Ботинки', chelsea: 'Челси', 'high-boots': 'Сапоги', 'ankle-boots': 'Ботильоны', uggs: 'Угги',
  shoes: 'Туфли', loafers: 'Лоферы', 'ballet-flats': 'Балетки', mules: 'Мюли', sandals: 'Сандалии', slides: 'Шлёпанцы',
  handbag: 'Сумки', backpack: 'Рюкзаки', tote: 'Шопперы', crossbody: 'Сумки кросс-боди', clutch: 'Клатчи', 'belt-bag': 'Поясные сумки',
  'travel-bag': 'Дорожные сумки', wallet: 'Кошельки',
  hat: 'Головные уборы', cap: 'Кепки', beanie: 'Шапки', scarf: 'Шарфы', gloves: 'Перчатки', belt: 'Ремни', tie: 'Галстуки', jewelry: 'Украшения',
  watch: 'Часы', glasses: 'Очки', hair: 'Аксессуары для волос', other: 'Другие аксессуары',
};

/**
 * Subcategories that are their category under another name (a «Футболка» among «Футболки»): their page would repeat
 * the category's, so they have none and their items count towards the category.
 */
const SAME_AS_CATEGORY = new Set(['tshirts/tshirt', 'shirts/shirt', 'trousers/trousers', 'shorts/shorts', 'dresses/dress', 'suits/suit', 'bags/handbag']);

/** Brand fields that name no brand. */
const NO_BRAND = /^(no ?name|noname|без бренда|без названия|нет|другое|other|unknown|-+)$/i;

export const categoryName = (slug: string) => CATEGORY_NAMES[slug] ?? categoryBySlug(slug)?.label ?? slug;
export const subcategoryName = (slug: string) => SUBCATEGORY_NAMES[slug] ?? slug;

/** Address words for an audience, as Lamoda and Zara spell them. */
export const AUDIENCE_SLUG: Record<Audience, string> = { FEMALE: 'women', MALE: 'men' };
const AUDIENCE_BY_SLUG: Record<string, Audience> = { women: 'FEMALE', men: 'MALE' };
/** Names that are one feminine noun take «Женская»; the rest are plural («Женские джинсы»). */
const SINGULAR_FEMININE = new Set(['Верхняя одежда', 'Обувь']);
const audienceName = (g: Audience, name: string) =>
  `${SINGULAR_FEMININE.has(name) ? (g === 'FEMALE' ? 'Женская' : 'Мужская') : g === 'FEMALE' ? 'Женские' : 'Мужские'} ${name[0].toLowerCase()}${name.slice(1)}`;

/**
 * Audiences a category has pages for: none where the catalogue already says who it is for (skirts and dresses are
 * women's, a «Женские юбки» page would be «Юбки» again).
 */
const audiencesOf = (category: string): Audience[] => (categoryBySlug(category)?.genders ? [] : ['FEMALE', 'MALE']);
/** As search reads «Женщинам»: items for women, and items not marked for anyone, which fit anyone. */
const fits = (r: LiveRow, g: Audience) => r.gender === g || r.gender === null || r.gender === 'UNISEX';

/** Whether a subcategory gets a page of its own. */
const ownSubcategory = (category: string, sub: string | null): sub is string =>
  !!sub && !SAME_AS_CATEGORY.has(`${category}/${sub}`) && !!categoryBySlug(category)?.subcategories.some((s) => s.slug === sub);

/** «Одежда и обувь Carhartt»: what a brand sells, from its items' catalogue groups. */
function brandPageName(brand: string, rows: LiveRow[]) {
  const groups = new Set(rows.map((r) => categoryBySlug(r.category)?.group));
  let kinds = (
    [
      ['clothing', 'одежда'],
      ['shoes', 'обувь'],
      ['bags', 'сумки'],
      ['accessories', 'аксессуары'],
    ] as const
  )
    .filter(([g]) => groups.has(g))
    .map(([, w]) => w as string);
  if (kinds.length > 3) kinds = kinds.filter((w) => w !== 'сумки');
  if (!kinds.length) return brand;
  const list = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} и ${kinds.at(-1)}` : kinds[0];
  return `${cap(list)} ${brand}`;
}

/**
 * Every page the live listings make, by path. Brands are grouped by their catalogue key («COS» and «Cos» are one
 * brand) and shown in their most common spelling.
 */
export function buildLandings(rows: LiveRow[]): Map<string, Landing> {
  // Each brand's spelling and address.
  const spellings = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const b = r.brand?.trim();
    if (!b || NO_BRAND.test(b)) continue;
    const k = brandKey(b);
    if (!k) continue;
    const m = spellings.get(k) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    spellings.set(k, m);
  }
  const brandOf = new Map<string, { name: string; slug: string }>();
  const slugTaken = new Map<string, string>();
  // Bigger brands first, so a clash of addresses goes to the one people more likely look for.
  const byCount = [...spellings].sort((a, b) => sum(b[1]) - sum(a[1]));
  for (const [k, m] of byCount) {
    // As sellers write it (the brand field is already the catalogue's spelling when the brand is known there).
    const name = [...m].sort((a, b) => b[1] - a[1])[0][0];
    const slug = slugify(name);
    if (!slug || (slugTaken.has(slug) && slugTaken.get(slug) !== k)) continue;
    slugTaken.set(slug, k);
    brandOf.set(k, { name, slug });
  }

  const pages = new Map<string, Landing>();
  const add = (path: string, make: () => Omit<Landing, 'rows' | 'updatedAt' | 'indexable' | 'name'>, r: LiveRow) => {
    let p = pages.get(path);
    if (!p) {
      p = { ...make(), name: '', rows: [], updatedAt: r.updatedAt, indexable: false };
      pages.set(path, p);
    }
    p.rows.push(r);
    if (r.updatedAt > p.updatedAt) p.updatedAt = r.updatedAt;
  };

  for (const r of rows) {
    const category = r.category;
    if (!category || !categoryBySlug(category)) continue;
    const sub = ownSubcategory(category, r.subcategory) ? r.subcategory : null;
    const c = `c/${category}`;
    add(c, () => ({ path: c, kind: 'category', crumb: categoryName(category), brand: null, gender: null, category, subcategory: null, parent: null }), r);
    if (sub) {
      const cs = `${c}/${sub}`;
      add(cs, () => ({ path: cs, kind: 'subcategory', crumb: subcategoryName(sub), brand: null, gender: null, category, subcategory: sub, parent: c }), r);
    }
    for (const g of audiencesOf(category)) {
      if (!fits(r, g)) continue;
      const gc = `c/${AUDIENCE_SLUG[g]}/${category}`;
      add(gc, () => ({ path: gc, kind: 'gender-category', crumb: '', brand: null, gender: g, category, subcategory: null, parent: c }), r);
      if (sub) {
        const gcs = `${gc}/${sub}`;
        add(gcs, () => ({ path: gcs, kind: 'gender-subcategory', crumb: '', brand: null, gender: g, category, subcategory: sub, parent: gc, also: `${c}/${sub}` }), r);
      }
    }
    const brand = r.brand?.trim() ? brandOf.get(brandKey(r.brand.trim())) : undefined;
    if (!brand) continue;
    const b = `brands/${brand.slug}`;
    const bc = `${b}/${category}`;
    add(b, () => ({ path: b, kind: 'brand', crumb: brand.name, brand, gender: null, category: '', subcategory: null, parent: null }), r);
    add(bc, () => ({ path: bc, kind: 'brand-category', crumb: categoryName(category), brand, gender: null, category, subcategory: null, parent: b }), r);
    if (sub) {
      const bcs = `${bc}/${sub}`;
      add(bcs, () => ({ path: bcs, kind: 'brand-subcategory', crumb: subcategoryName(sub), brand, gender: null, category, subcategory: sub, parent: bc }), r);
    }
  }

  for (const p of pages.values()) {
    p.name = landingName(p);
    if (p.gender) p.crumb = p.name;
    // A narrower page must show something each wider one doesn't, or it is that page's copy under another name.
    const wider = [p.parent, p.also].map((x) => (x ? pages.get(x) : undefined)).filter((x): x is Landing => !!x);
    p.indexable = p.rows.length >= MIN_ITEMS && wider.every((w) => p.rows.length < w.rows.length);
  }
  return pages;
}

function landingName(p: Pick<Landing, 'kind' | 'brand' | 'gender' | 'category' | 'subcategory' | 'rows'>) {
  const kind = p.subcategory ? subcategoryName(p.subcategory) : categoryName(p.category);
  if (p.kind === 'brand') return brandPageName(p.brand!.name, p.rows);
  if (p.brand) return `${kind} ${p.brand.name}`;
  return p.gender ? audienceName(p.gender, kind) : kind;
}

/**
 * A catalogue category or subcategory with nothing on sale right now: the page still opens (the footer links to
 * categories whatever their stock), says so, and stays out of search.
 */
export function emptyLanding(path: string): Landing | null {
  const [root, category, sub, ...rest] = path.split('/');
  if (root !== 'c' || rest.length || !categoryBySlug(category) || (sub && !ownSubcategory(category, sub))) return null;
  const base = { brand: null, gender: null, category, subcategory: sub ?? null, rows: [], indexable: false, updatedAt: new Date(0) };
  const p: Landing = sub
    ? { ...base, path, kind: 'subcategory', crumb: subcategoryName(sub), name: '', parent: `c/${category}` }
    : { ...base, path, kind: 'category', crumb: categoryName(category), name: '', parent: null };
  p.name = landingName(p);
  return p;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** The landing a path names, or null for anything outside the catalogue's shape (the page is then a 404). */
export function normalizeLandingPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const [root, ...rest] = parts;
  const valid = (category?: string, sub?: string) => !category || (!!categoryBySlug(category) && (!sub || ownSubcategory(category, sub)));
  if (root === 'c' && rest[0] in AUDIENCE_BY_SLUG) {
    const [, category, sub, ...extra] = rest;
    return !extra.length && !!category && audiencesOf(category).length > 0 && valid(category, sub) ? parts.join('/') : null;
  }
  if (root === 'c' && rest.length >= 1 && rest.length <= 2 && valid(rest[0], rest[1])) return parts.join('/');
  if (root === 'brands' && rest.length >= 1 && rest.length <= 3 && /^[a-z0-9-]+$/.test(rest[0]) && valid(rest[1], rest[2])) return parts.join('/');
  return null;
}

/** «1 вещь», «3 вещи», «12 вещей». */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const d = n % 10;
  const h = n % 100;
  return h >= 11 && h <= 14 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many;
}
const things = (n: number) => `${n} ${plural(n, ['вещь', 'вещи', 'вещей'])}`;

/** «Минске, Гродно и Бресте»: a list joined the Russian way. */
const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} и ${xs.at(-1)}` : (xs[0] ?? ''));

function topCounts(values: Array<string | null>, limit: number) {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export interface LandingText {
  title: string;
  description: string;
  /** Short paragraph under the H1, sentence by sentence. */
  intro: string[];
}

export interface LandingStats {
  total: number;
  /** By the item's condition («Новое» or worn), not by the section it is shown in: «Вторичка» has new items too. */
  fresh: number;
  used: number;
  price: { min: number; max: number; median: number } | null;
  /** «в Минске» when most items are there, else «в Беларуси». */
  where: string;
}

export function landingStats(p: Landing): LandingStats {
  const prices = p.rows
    .filter((r) => r.price != null && !r.priceNegotiable)
    .map((r) => r.price!)
    .sort((a, b) => a - b);
  const [topCity] = topCounts(p.rows.map((r) => r.city), 1);
  const cityIn = topCity && topCity[1] * 2 >= p.rows.length ? CITY_IN[topCity[0]] : undefined;
  return {
    total: p.rows.length,
    fresh: p.rows.filter((r) => r.condition === 'NEW_WITH_TAGS').length,
    used: p.rows.filter((r) => r.condition && r.condition !== 'NEW_WITH_TAGS').length,
    price: prices.length ? { min: prices[0], max: prices.at(-1)!, median: prices[Math.floor((prices.length - 1) / 2)] } : null,
    where: cityIn ? `в ${cityIn}` : 'в Беларуси',
  };
}

/**
 * The page's <title>, meta description and the paragraph under its H1, from the live items' real numbers:
 * how many there are, new and second-hand, the prices, what kinds and brands, where and how they are handed over.
 */
export function landingText(p: Landing): LandingText {
  const s = landingStats(p);
  if (!s.total) {
    return {
      title: `${p.name} — купить в Беларуси`,
      description: `${p.name} на ichiba: сейчас нет вещей в продаже, новые появляются каждый день.`,
      intro: [`Сейчас в разделе «${p.name}» нет вещей в продаже.`, 'Загляните позже или посмотрите соседние разделы.'],
    };
  }
  const brandRu = p.brand && !/[а-яё]/i.test(p.brand.name) ? brandRussian(p.brand.name) : null;
  const mixed = s.fresh > 0 && s.used > 0;
  const usedOnly = s.used > 0 && s.fresh === 0;

  // «Куртки Carhartt — купить в Минске, новые и б/у, от 80 р.»: the item kind, then the words people add to a search.
  const title = fit(
    [
      { text: p.name, rank: 100, sep: '' },
      ...(usedOnly ? [{ text: 'б/у', rank: 90, sep: ' ' }] : []),
      ...(brandRu && p.kind === 'brand' ? [{ text: `(${cap(brandRu)})`, rank: 45, sep: ' ' }] : []),
      { text: `купить ${s.where}`, rank: 60, sep: ' — ' },
      ...(mixed ? [{ text: 'новые и б/у', rank: 40, sep: ', ' }] : []),
      ...(s.price ? [{ text: `от ${s.price.min} р.`, rank: 50, sep: ', ' }] : []),
    ],
    TITLE_MAX,
  );

  const intro: string[] = [];
  const subject = p.kind === 'brand' ? `Сейчас на ichiba ${things(s.total)} ${p.brand!.name}${brandRu ? ` (${cap(brandRu)})` : ''}` : `В разделе «${p.name}» сейчас ${things(s.total)}`;
  intro.push(
    mixed
      ? `${subject}: ${s.fresh} ${plural(s.fresh, ['новая', 'новых', 'новых'])} и ${s.used} б/у.`
      : usedOnly
        ? `${subject}, все — б/у.`
        : s.fresh === s.total
          ? `${subject}, все новые.`
          : `${subject}.`,
  );
  if (s.price) {
    const half = s.total >= MIN_ITEMS && s.price.median > s.price.min && s.price.median < s.price.max ? `, у половины вещей — до ${s.price.median} р.` : '';
    intro.push(s.price.min === s.price.max ? `Цена — ${s.price.min} р.` : `Цены от ${s.price.min} до ${s.price.max} р.${half}`);
  }

  // What is inside: kinds of items on a category or brand page, brands on a category page.
  const kinds =
    p.kind === 'category' || p.kind === 'gender-category'
      ? topCounts(p.rows.map((r) => (ownSubcategory(p.category, r.subcategory) ? subcategoryName(r.subcategory) : null)), 4)
      : p.kind === 'brand'
        ? topCounts(p.rows.map((r) => (r.category ? categoryName(r.category) : null)), 4)
        : p.kind === 'brand-category'
          ? topCounts(p.rows.map((r) => (ownSubcategory(p.category, r.subcategory) ? subcategoryName(r.subcategory) : null)), 4)
          : [];
  const common = kinds.filter(([, n]) => n > 1);
  if (common.length > 1) intro.push(`Больше всего: ${common.map(([k, n]) => `${k.toLowerCase()} (${n})`).join(', ')}.`);
  const brands = p.brand ? [] : topCounts(p.rows.map((r) => (r.brand?.trim() && !NO_BRAND.test(r.brand.trim()) ? r.brand.trim() : null)), 5);
  if (brands.length) intro.push(`Бренды: ${brands.length >= 5 ? `${brands.map(([b]) => b).join(', ')} и другие` : listOf(brands.map(([b]) => b))}.`);

  const cities = topCounts(p.rows.map((r) => r.city), 3)
    .map(([c]) => CITY_IN[c])
    .filter(Boolean);
  const delivered = p.rows.filter((r) => r.deliveryOptions.includes('DELIVERY')).length;
  const delivery = delivered === s.total ? 'все можно заказать с доставкой по Беларуси' : delivered ? `${delivered} из ${s.total} — с доставкой по Беларуси` : null;
  if (cities.length) intro.push(`Продают в ${listOf(cities)}${delivery ? `; ${delivery}` : ''}.`);
  else if (delivery) intro.push(`${cap(delivery)}.`);

  // The description: the same facts, shortest first, as long as they fit.
  const offer = mixed ? ', новые и б/у' : usedOnly ? ', б/у' : s.fresh === s.total ? ', новые' : '';
  const facts = [
    `${p.name}${brandRu && p.kind === 'brand' ? ` (${cap(brandRu)})` : ''} на ichiba: ${things(s.total)} ${s.where}${offer}.`,
    s.price ? (s.price.min === s.price.max ? `Цена ${s.price.min} р.` : `Цены от ${s.price.min} до ${s.price.max} р.`) : null,
    brands.length ? `${brands.slice(0, 3).map(([b]) => b).join(', ')}.` : null,
    delivered ? 'Доставка по Беларуси.' : null,
  ].filter((x): x is string => !!x);
  let description = '';
  for (const f of facts) {
    const next = description ? `${description} ${f}` : f;
    if (next.length > DESCRIPTION_MAX) break;
    description = next;
  }

  return { title, description: description || facts[0].slice(0, DESCRIPTION_MAX), intro };
}

/** Pages to link from a landing: narrower ones under it, and brands (or kinds) beside it; only indexed ones. */
export function landingLinks(p: Landing, pages: Map<string, Landing>) {
  const indexed = [...pages.values()].filter((x) => x.indexable && x.path !== p.path);
  const groups: Array<{ title: string; links: Array<{ path: string; name: string; count: number }> }> = [];
  // A list of brands names each by the brand; a list of kinds, by the kind.
  const push = (title: string, xs: Landing[], byBrand = false) => {
    const links = xs
      .sort((a, b) => b.rows.length - a.rows.length)
      .slice(0, 24)
      .map((x) => ({ path: x.path, name: byBrand ? x.brand!.name : x.crumb, count: x.rows.length }));
    if (links.length) groups.push({ title, links });
  };
  if (p.kind === 'category') {
    push('Что ещё в разделе', indexed.filter((x) => x.kind === 'subcategory' && x.category === p.category));
    push('Женщинам и мужчинам', indexed.filter((x) => x.kind === 'gender-category' && x.category === p.category));
    push('Бренды', indexed.filter((x) => x.kind === 'brand-category' && x.category === p.category), true);
  } else if (p.kind === 'subcategory') {
    push('Женщинам и мужчинам', indexed.filter((x) => x.kind === 'gender-subcategory' && x.also === p.path));
    push('Бренды', indexed.filter((x) => x.kind === 'brand-subcategory' && x.subcategory === p.subcategory), true);
    push(`Ещё в разделе «${categoryName(p.category)}»`, indexed.filter((x) => x.kind === 'subcategory' && x.category === p.category));
  } else if (p.kind === 'gender-category') {
    push('Что ещё в разделе', indexed.filter((x) => x.kind === 'gender-subcategory' && x.parent === p.path));
    push('Ещё', indexed.filter((x) => x.kind === 'gender-category' && x.gender === p.gender));
  } else if (p.kind === 'gender-subcategory') {
    push(`Ещё в разделе «${pages.get(p.parent!)?.name ?? categoryName(p.category)}»`, indexed.filter((x) => x.kind === 'gender-subcategory' && x.parent === p.parent));
  } else if (p.kind === 'brand') {
    push('Разделы', indexed.filter((x) => x.kind === 'brand-category' && x.brand?.slug === p.brand!.slug));
  } else if (p.kind === 'brand-category') {
    push('Разделы', indexed.filter((x) => x.kind === 'brand-subcategory' && x.parent === p.path));
    push('Другие бренды', indexed.filter((x) => x.kind === 'brand-category' && x.category === p.category), true);
  } else {
    push('Другие бренды', indexed.filter((x) => x.kind === 'brand-subcategory' && x.subcategory === p.subcategory), true);
  }
  // «Все куртки», «Все вещи Carhartt», «Мужские куртки» beside «Женские»: the pages around it, for anyone who came in too narrow.
  const other = p.gender && `c/${AUDIENCE_SLUG[p.gender === 'FEMALE' ? 'MALE' : 'FEMALE']}/${p.category}${p.subcategory ? `/${p.subcategory}` : ''}`;
  const around = p.brand && p.kind !== 'brand' ? [`brands/${p.brand.slug}`, p.subcategory ? `c/${p.category}/${p.subcategory}` : `c/${p.category}`] : p.gender ? [other!, p.subcategory ? `c/${p.category}/${p.subcategory}` : `c/${p.category}`] : [];
  const wider = around
    .map((path) => pages.get(path))
    .filter((x): x is Landing => !!x?.indexable);
  if (wider.length) groups.push({ title: 'Смотрите также', links: wider.map((x) => ({ path: x.path, name: x.name, count: x.rows.length })) });
  return groups;
}

/** Breadcrumbs above the H1: the indexed pages above this one, then the page itself. */
export function landingCrumbs(p: Landing, pages: Map<string, Landing>) {
  const chain: Landing[] = [];
  for (let x: Landing | undefined = p; x; x = x.parent ? pages.get(x.parent) : undefined) if (x === p || x.indexable) chain.unshift(x);
  return chain.map((x) => ({ path: x.path, name: x.crumb }));
}
