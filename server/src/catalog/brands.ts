import { BRAND_DATA } from './brands.data.js';

/**
 * Brand catalogue: ~5 000 clothing, shoe, bag and jewellery brands (see scripts/brands/build.mjs).
 * Sellers pick from it, but any other brand is still accepted: small and local labels are welcome.
 */

/** Lower-case, no diacritics or punctuation: "Levi's" and "levis", "Hermès" and "hermes" are the same key. */
export const brandKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9а-я]/g, '');

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/**
 * A rough sound skeleton shared by Latin and Cyrillic spellings, for fallback matching:
 * "манго" and "Mango", "зара" and "Zara", "найк" and "Nike" end up close.
 */
const skeleton = (key: string) =>
  key
    .replace(/[а-я]/g, (c) => CYR[c] ?? '')
    .replace(/dzh|j/g, 'g')
    .replace(/ck|c|q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/[aeiouy]+/g, '')
    .replace(/(.)\1+/g, '$1');

interface Brand {
  name: string;
  score: number;
  key: string;
  aliases: string[];
  /** Keys of each word, for "north" finding "The North Face". */
  words: string[];
  skeleton: string;
  /** How the brand is written in Russian («Кархарт» for Carhartt), the first Cyrillic alias. */
  ru: string | null;
}

const BRANDS: Brand[] = BRAND_DATA.split('\n').map((line) => {
  const [name, score, aliases = ''] = line.split('|');
  const aliasKeys = aliases ? aliases.split(';').map(brandKey).filter(Boolean) : [];
  return {
    name,
    score: Number(score),
    key: brandKey(name),
    ru: aliases.split(';').find((a) => /[а-яё]/i.test(a))?.trim() || null,
    aliases: aliasKeys,
    words: name.split(/[\s\-/.]+/).map(brandKey).filter((w) => w.length >= 2),
    skeleton: skeleton(brandKey(name)),
  };
});
const BY_KEY = new Map<string, Brand>();
for (const b of BRANDS) if (!BY_KEY.has(b.key)) BY_KEY.set(b.key, b);
for (const b of BRANDS) for (const a of b.aliases) if (!BY_KEY.has(a)) BY_KEY.set(a, b);

/** Most common brands, for chips on the search page. */
export const POPULAR_BRANDS = BRANDS.slice(0, 40).map((b) => b.name);

/** Damerau-free Levenshtein with an early exit once the distance exceeds max. */
function within(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Ranked suggestions for what the user typed. Exact names and aliases come first, then prefixes,
 * word prefixes, substrings, sound-alike and one-typo matches; popularity breaks ties.
 * `boost` adds weight for brands that already have listings on the site.
 */
export function searchBrands(query: string, limit = 10, boost?: Map<string, number>): string[] {
  const q = brandKey(query);
  if (!q) return POPULAR_BRANDS.slice(0, limit);
  const qs = skeleton(q);
  const typo = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  const hits: Array<{ b: Brand; s: number }> = [];
  for (const b of BRANDS) {
    let m = 0;
    if (b.key === q || b.aliases.includes(q)) m = 1000;
    else if (b.key.startsWith(q)) m = 600;
    else if (b.aliases.some((a) => a.startsWith(q))) m = 550;
    else if (b.words.some((w) => w.startsWith(q))) m = 400;
    else if (q.length >= 3 && b.key.includes(q)) m = 200;
    else if (b.skeleton === qs ? qs.length >= 2 : qs.length >= 3 && b.skeleton.startsWith(qs) && b.skeleton.length - qs.length <= 2) m = 120;
    else if (typo && within(q, b.key.slice(0, q.length + typo), typo)) m = 80;
    if (!m) continue;
    const used = boost?.get(b.key) ?? 0;
    hits.push({ b, s: m + Math.log1p(b.score) * 25 + Math.log1p(used) * 60 });
  }
  hits.sort((x, y) => y.s - x.s || x.b.name.length - y.b.name.length);
  return hits.slice(0, limit).map((h) => h.b.name);
}

/** The catalogue spelling of a brand ("nike", "Найк" -> "Nike"), or null when it is not in the catalogue. */
export const knownBrand = (input: string) => BY_KEY.get(brandKey(input))?.name ?? null;

/** The Russian spelling of a catalogue brand ("Nike" -> "найк"), or null. */
export const brandRussian = (name: string) => BY_KEY.get(brandKey(name))?.ru ?? null;

/** The catalogue spelling of a brand; unknown brands are kept as typed. */
export function canonicalBrand(input: string | null | undefined): string | null {
  const t = input?.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  return knownBrand(t) ?? t;
}

/**
 * Brands that are also ordinary words; in free text they count only when written in Latin with a
 * capital letter ("Next", not "next" or "некст", "Lime" and not the colour "лайм").
 */
const AMBIGUOUS = new Set(
  ['only', 'next', 'simple', 'house', 'object', 'mother', 'frame', 'pink', 'coast', 'office', 'express', 'loft', 'element', 'peak', 'head',
    'arena', 'network', 'twist', 'area', 'commission', 'monochrome', 'respect', 'medicine', 'diverse', 'evans', 'burton', 'hush', 'boss',
    'theory', 'vince', 'joseph', 'champion', 'hunter', 'lime', 'sela', 'elis', 'kari', 'marko', 'serge', 'munich', 'oasis', 'warehouse',
    'mustang', 'savage', 'essentials', 'represent', 'undercover', 'needles', 'neighborhood', 'kit', 'kith', 'vila', 'pieces', 'closed',
    'replay', 'starter', 'твое', 'kapital', 'boots', 'gap', 'hudson', 'paige', 'twinset', 'basic', 'premium', 'classic', 'vintage', 'sport', 'style', 'denim'].map(brandKey),
);

/**
 * Finds a known brand mentioned in free text (a listing title, a search query): "Кроссовки найк air max" -> Nike.
 * Tries three-, two- and one-word spans, longest first, so "The North Face" wins over "North".
 */
export function findBrandInText(text: string): { brand: string; match: string } | null {
  const tokens = text.match(/[\p{L}\p{N}&'’.+-]+/gu) ?? [];
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const span = tokens.slice(i, i + n).join(' ');
      const k = brandKey(span);
      if (k.length < 3) continue;
      const b = BY_KEY.get(k);
      if (!b) continue;
      if (n === 1 && AMBIGUOUS.has(b.key) && !/^[A-Z]/.test(span)) continue;
      // Short keys ("lee", "cos", "gap") only count when written exactly like the brand name.
      if (k.length <= 3 && span.replace(/[.']/g, '').toLowerCase() !== b.name.replace(/[.']/g, '').toLowerCase()) continue;
      return { brand: b.name, match: span };
    }
  }
  return null;
}
