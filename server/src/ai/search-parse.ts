import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { findBrandInText, knownBrand, POPULAR_BRANDS } from '../catalog/brands.js';
import { CATEGORIES, CITIES, COLORS, CONDITIONS, SIZES, STYLE_TAGS } from '../catalog/catalog.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { majority, median, quorumSet } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, RunBudget, TtlCache, Vote } from './ensemble/ensemble.js';

/**
 * Natural-language search (AI feature 6): «летнее платье на свадьбу до 50 BYN» → filters.
 * A rule parser (prices, sizes, colours, condition, gender, city, brands, categories, occasions) runs
 * instantly and is one voter; for longer phrases the ensemble votes too. Everything is validated against
 * the catalog, so a model can never invent a filter value.
 */

interface ParsedFilters {
  q: string;
  category: string[];
  subcategory: string[];
  color: string[];
  size: string[];
  condition: string[];
  brand: string[];
  style: string[];
  gender: string[];
  city: string | null;
  price_min: number | null;
  price_max: number | null;
}

export interface SearchInterpretation {
  status: 'ok' | 'skip';
  filters: ParsedFilters;
  chips: Array<{ key: keyof ParsedFilters; label: string }>;
  source: 'rules' | 'ai';
}

const ALL_SIZES = [...new Set([...SIZES.ALPHA, ...SIZES.RU, ...SIZES.SHOE_EU, ...SIZES.JEANS_W])];
const GENDERS = ['MALE', 'FEMALE'];

const Vote_ = z.object({
  keywords: z.string().catch(''),
  category: z.string().nullish().catch(null),
  subcategory: z.string().nullish().catch(null),
  colors: z.array(z.string()).catch([]),
  sizes: z.array(z.string()).catch([]),
  conditions: z.array(z.string()).catch([]),
  brands: z.array(z.string()).catch([]),
  price_min: z.coerce.number().int().min(0).nullish().catch(null),
  price_max: z.coerce.number().int().min(0).nullish().catch(null),
  city: z.string().nullish().catch(null),
  gender: z.string().nullish().catch(null),
  style_tags: z.array(z.string()).catch([]),
});
type VoteT = z.infer<typeof Vote_>;

const SYSTEM = `Ты разбираешь поисковый запрос покупателя на маркетплейсе б/у одежды в Беларуси и превращаешь его в фильтры каталога. Используй только значения из списков.
Категории и подкатегории (slug):
${CATEGORIES.map((c) => `${c.slug} (${c.label}): ${c.subcategories.map((s) => `${s.slug}=${s.label}`).join(', ')}`).join('\n')}
Цвета: ${COLORS.map((c) => `${c.value}=${c.label}`).join(', ')}
Размеры: ${ALL_SIZES.join(', ')}
Состояние: ${CONDITIONS.map((c) => `${c.value}=${c.label}`).join(', ')}
Стили (style_tags): ${STYLE_TAGS.join(', ')} — повод переводи в стиль: свадьба/выпускной/театр → Classic, офис → Business, спорт/зал → Sport, поход → Outdoor.
Пол (gender): MALE, FEMALE — только если пол прямо назван в запросе. Города: ${CITIES.join(', ')}.
Цены в BYN: «до 50» → price_max 50, «от 20» → price_min 20.
keywords — только слова, которые стоит искать в названии и не покрыты фильтрами (например «оверсайз», «кожаная», модель «air max»). Повод, сезон, «недорого», «хочу», «ищу» в keywords не включай. Если всё покрыто фильтрами — пустая строка.
Если чего-то в запросе нет — null или пустой список.`;

const STOP = new Set(['до', 'от', 'на', 'для', 'в', 'во', 'с', 'со', 'и', 'или', 'по', 'за', 'из', 'к', 'не', 'размер', 'размера', 'размеры', 'р', 'р-р', 'byn', 'руб', 'рублей', 'рубля', 'бел', 'цвет', 'цвета', 'недорого', 'дешево', 'дёшево', 'купить', 'хочу', 'ищу', 'нужен', 'нужна', 'нужно', 'нужны', 'мне', 'что', 'нибудь', 'какой', 'какую', 'какое', 'бу', 'б/у', 'дешевле', 'дороже', 'меньше', 'больше', 'не дороже']);

const COLOR_RULES: Array<[RegExp, string]> = [
  [/^черн/, 'black'], [/^бел(?:ый|ая|ое|ые|ого|ую|ых)$/, 'white'], [/^сер(?:ый|ая|ое|ые|ого|ую|ых)$/, 'gray'], [/^беж/, 'beige'], [/^коричн/, 'brown'],
  [/^красн/, 'red'], [/^розов/, 'pink'], [/^оранж/, 'orange'], [/^желт/, 'yellow'], [/^зелен/, 'green'], [/^син(?:ий|яя|ее|ие|его|юю|их)$/, 'blue'],
  [/^голуб/, 'lightblue'], [/^фиолет/, 'purple'], [/^разноцвет/, 'multi'], [/^black$/, 'black'], [/^white$/, 'white'],
];
const STYLE_RULES: Array<[RegExp, string]> = [
  [/^свадьб|^выпускн|^торжеств|^театр|^вечерн/, 'Classic'], [/^офис|^делов|^собеседован/, 'Business'], [/^спорт|^трениров|^бег$|^зал$|^фитнес/, 'Sport'],
  [/^поход|^туризм|^треккинг/, 'Outdoor'], [/^винтаж|^ретро/, 'Vintage'], [/^стрит|^уличн/, 'Streetwear'], [/^минимал/, 'Minimal'], [/^бохо/, 'Boho'], [/^y2k$|^нулев/, 'Y2K'],
];
const SEASON = /^(?:летн|зимн|осенн|весенн|демисезон|тепл|легк)/;

/**
 * Majority among voters that gave a value: a provider that left a field empty abstains rather than
 * voting "no filter". The winner needs a third of all weight and must not be outvoted by a rival value.
 */
function presentMajority<T>(votes: Vote<T>[], pick: (v: T) => string | null): string | null {
  const total = votes.reduce((s, v) => s + v.weight, 0);
  const present = votes.filter((v) => pick(v.value) != null);
  if (!present.length) return null;
  const m = majority(present, pick);
  const w = m.share * present.reduce((s, v) => s + v.weight, 0);
  return m.value != null && m.share > 0.5 && w / total >= 0.34 ? (m.value as string) : null;
}

const stem = (w: string) => (w.length > 5 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w);
const labelWords = (label: string) => label.toLowerCase().replace(/ё/g, 'е').split(/[\s-]+/);
const SUBCATEGORIES = CATEGORIES.flatMap((c) => c.subcategories.map((s) => ({ c, s })));
const MULTI_WORD_SUBCATEGORIES = SUBCATEGORIES.filter(({ s }) => labelWords(s.label).length > 1).sort((a, b) => labelWords(b.s.label).length - labelWords(a.s.label).length);

@Injectable()
export class SearchParser {
  private readonly cache = new TtlCache<SearchInterpretation>(60 * 60_000, 2000);
  /** Model runs for text search, site-wide, per minute. */
  private readonly budget = new RunBudget(60);
  private brands: { at: number; list: string[] } = { at: 0, list: POPULAR_BRANDS };

  constructor(
    private readonly prisma: PrismaService,
    private readonly ensemble: AiEnsemble,
  ) {}

  private async knownBrands() {
    if (Date.now() - this.brands.at > 10 * 60_000) {
      const rows = await this.prisma.listing.groupBy({ by: ['brand'], where: { brand: { not: null }, status: { in: ['PUBLISHED', 'RESERVED'] } }, _count: true, orderBy: { _count: { brand: 'desc' } }, take: 300 });
      this.brands = { at: Date.now(), list: [...new Set([...POPULAR_BRANDS, ...rows.map((r) => r.brand!.trim()).filter((b) => b.length >= 2)])] };
    }
    return this.brands.list;
  }

  async parse(raw: string): Promise<SearchInterpretation> {
    const q = raw.trim().replace(/\s+/g, ' ').slice(0, 200);
    const key = hashKey('nlsearch', q.toLowerCase());
    const cached = this.cache.get(key);
    if (cached) return cached;

    const brands = await this.knownBrands();
    const rules = this.ruleParse(q, brands);
    const words = q.split(' ').filter(Boolean);
    // Short queries the rules fully understood don't need a model round-trip.
    const wantsAi = this.ensemble.available && (words.length >= 3 || /\d/.test(q) || rules.leftover.length > 0) && words.length >= 2;
    // Guests search too: past the site-wide budget the rules alone answer (and the answer isn't cached), so a burst
    // of searches never takes the providers away from listing moderation.
    const needsAi = wantsAi && this.budget.take();

    let votes: Vote<VoteT>[] = [];
    if (needsAi) {
      votes = (
        await this.ensemble.run({
          feature: 'nl_search',
          system: SYSTEM,
          prompt: `Запрос: «${q}»`,
          schema: Vote_,
          tier: 'fast',
          timeoutMs: 6_000,
          graceMs: 2_000,
          maxTokens: 300,
          temperature: 0,
        })
      ).votes;
    }
    const result = this.combine(rules.vote, votes, brands);
    if (needsAi || !wantsAi) this.cache.set(key, result);
    return result;
  }

  /** Deterministic parse; returns a vote in the same shape as a model answer. */
  ruleParse(q: string, brands: string[]): { vote: VoteT; leftover: string[] } {
    const lower = q.toLowerCase().replace(/ё/g, 'е');
    const vote: VoteT = { keywords: '', category: null, subcategory: null, colors: [], sizes: [], conditions: [], brands: [], price_min: null, price_max: null, city: null, gender: null, style_tags: [] };
    let rest = ` ${lower} `;
    /** Removes the first match of `re` from the remaining text and returns it. */
    const take = (re: RegExp) => {
      const m = rest.match(re);
      if (m) rest = rest.replace(m[0], ' ');
      return m;
    };

    const range = take(/(\d{1,6})\s*[-–—]\s*(\d{1,6})\s*(?:byn|бел\S*|руб\S*|р\.?)(?=\s)/);
    if (range) {
      vote.price_min = Number(range[1]);
      vote.price_max = Number(range[2]);
    }
    const max = take(/(?:до|дешевле|не дороже|меньше|max|<)\s*(\d{1,6})(?!\d|\s*(?:размер|р-р|eu|см))/);
    if (max) vote.price_max = Number(max[1]);
    const min = take(/(?:от|дороже|больше|min|>)\s*(\d{1,6})(?!\d|\s*(?:размер|р-р|eu|см))/);
    if (min) vote.price_min = Number(min[1]);
    while (take(/\s(?:byn|бел\.?\s*руб\S*|руб\S*|р\.)(?=\s)/));

    const sizeAlpha = take(/\s(?:размер\S*\s+)?(xxs|xs|s|m|l|xl|xxl)(?=\s)/i);
    if (sizeAlpha) vote.sizes.push(sizeAlpha[1].toUpperCase());
    const jeans = take(/\sw\s?(\d{2})(?=\s)/i);
    if (jeans) vote.sizes.push(`W${jeans[1]}`);
    if (/размер|р-р|eu|кроссов|ботин|туфл|кед|сапог|обув/.test(lower)) {
      const shoe = take(/\s(?:размер\S*\s+)?(3[5-9]|4[0-6])(?:\s+(?:размер\S*|р-р|eu))?(?=\s)/);
      if (shoe) vote.sizes.push(shoe[1]);
    }

    if (take(/\s(?:нов\S*\s+)?с\s*бирк\S*|\sбирк\S*/)) vote.conditions.push('NEW_WITH_TAGS');
    else if (take(/\sкак\s*нов\S*/)) vote.conditions.push('LIKE_NEW');
    else if (take(/\sнов(?:ый|ая|ое|ые|ую|ого)(?=\s)/)) vote.conditions.push('NEW_WITH_TAGS', 'LIKE_NEW');

    if (take(/\sмужск\S*/)) vote.gender = 'MALE';
    else if (take(/\sженск\S*/)) vote.gender = 'FEMALE';

    for (const city of CITIES) {
      const s = city.toLowerCase().replace(/ё/g, 'е').slice(0, Math.max(4, city.length - 2));
      if (take(new RegExp(`\\s(?:(?:в|из)\\s+)?${s}\\S*`))) vote.city = city;
    }
    for (const b of brands) {
      const esc = b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (take(new RegExp(`\\s${esc}(?:['’]s)?(?=\\s)`, 'i'))) vote.brands.push(b);
    }
    // Any other catalogue brand, including Cyrillic spellings: «найк», «доктор мартинс».
    if (!vote.brands.length) {
      const found = findBrandInText(q);
      if (found) {
        const esc = found.match.toLowerCase().replace(/ё/g, 'е').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        take(new RegExp(`\\s${esc}(?:['’]s)?(?=\\s)`));
        vote.brands.push(found.brand);
      }
    }

    // Multi-word subcategories as phrases first: «спортивный костюм» is not «Спортивные штаны» + a stray word.
    for (const { c, s } of MULTI_WORD_SUBCATEGORIES) {
      if (vote.category) break;
      if (take(new RegExp(`\\s${labelWords(s.label).map((w) => stem(w)).join('\\S*\\s+')}\\S*(?=\\s)`))) {
        vote.category = c.slug;
        vote.subcategory = s.slug;
      }
    }

    const leftover: string[] = [];
    for (const word of rest.split(/[^a-zа-я0-9'-]+/).filter(Boolean)) {
      if (STOP.has(word)) continue;
      const color = COLOR_RULES.find(([re]) => re.test(word));
      if (color) {
        vote.colors.push(color[1]);
        continue;
      }
      const style = STYLE_RULES.find(([re]) => re.test(word));
      if (style) {
        vote.style_tags.push(style[1]);
        continue;
      }
      if (SEASON.test(word)) continue;
      const st = stem(word);
      // Most specific first: a subcategory named by this word («куртка»), then a category («джинсы» must not
      // become «Джинсовые шорты»), then any word of a subcategory, then prefixes.
      const exactCat = CATEGORIES.find((c) => labelWords(c.label).some((w) => stem(w) === st));
      const sub =
        SUBCATEGORIES.find(({ s }) => stem(labelWords(s.label)[0]) === st) ??
        (exactCat
          ? undefined
          : (SUBCATEGORIES.find(({ s }) => labelWords(s.label).some((w) => stem(w) === st)) ??
            SUBCATEGORIES.find(({ s }) => s.label.toLowerCase().startsWith(st) && st.length >= (word.length >= 4 ? 3 : 4))));
      if (exactCat && !sub && !vote.category) {
        vote.category = exactCat.slug;
        continue;
      }
      if (sub && !vote.category) {
        vote.category = sub.c.slug;
        if (sub.s.slug !== sub.c.slug && sub.c.subcategories.length > 1) vote.subcategory = sub.s.slug;
        continue;
      }
      // «юбка плиссе»: the category came first, this word narrows it.
      const narrower = SUBCATEGORIES.find(({ c, s }) => c.slug === vote.category && labelWords(s.label).some((w) => stem(w) === st));
      if (narrower && !vote.subcategory) {
        vote.subcategory = narrower.s.slug;
        continue;
      }
      const cat = CATEGORIES.find((c) => c.label.toLowerCase().split(' ').some((w) => w.length >= 4 && w.startsWith(st) && st.length >= 4));
      if (cat && !vote.category) {
        vote.category = cat.slug;
        continue;
      }
      if (word.length >= 2 && !/^\d+$/.test(word)) leftover.push(word);
    }
    vote.keywords = leftover.join(' ');
    return { vote, leftover };
  }

  private combine(rule: VoteT, ai: Vote<VoteT>[], brands: string[]): SearchInterpretation {
    const all: Vote<VoteT>[] = [...ai, { provider: 'rules', model: 'rules', weight: 1, latencyMs: 0, value: rule }];
    const validCat = (v: VoteT) => (CATEGORIES.some((c) => c.slug === v.category) ? v.category! : null);
    const cat = { value: presentMajority(all, validCat) };
    const catObj = CATEGORIES.find((c) => c.slug === cat.value);
    const sub = {
      value: presentMajority(
        all.filter((v) => validCat(v.value) === cat.value),
        (v) => (catObj?.subcategories.some((s) => s.slug === v.subcategory) ? v.subcategory! : null),
      ),
    };
    const brandList = brands.map((b) => b.toLowerCase());
    const canonBrand = (b: string) => brands[brandList.indexOf(b.trim().toLowerCase())] ?? knownBrand(b);

    // Prices: an explicit number in the query (rules) beats any model reading of it.
    const price = (k: 'price_min' | 'price_max') => {
      if (rule[k] != null) return rule[k]!;
      const vals = ai.map((v) => v.value[k]).filter((x): x is number => x != null && x > 0);
      return vals.length > ai.length / 2 ? Math.round(median(vals)!) : null;
    };
    const city = presentMajority(all, (v) => (CITIES.includes(v.city ?? '') ? v.city! : null));
    // Gender only when the query says it ("мужская", "женские"): models tend to infer it from the item,
    // and a gender filter hides every listing whose seller didn't set one.
    const gender = rule.gender && GENDERS.includes(rule.gender) ? rule.gender : null;

    const filters: ParsedFilters = {
      q: '',
      category: cat.value ? [cat.value as string] : [],
      subcategory: sub.value ? [sub.value as string] : [],
      color: quorumSet(all, (v) => v.colors.filter((c) => COLORS.some((x) => x.value === c)), 0.5),
      size: quorumSet(all, (v) => v.sizes.map((s) => s.toUpperCase()).filter((s) => ALL_SIZES.includes(s)), 0.5),
      condition: quorumSet(all, (v) => v.conditions.filter((c) => CONDITIONS.some((x) => x.value === c)), 0.5),
      brand: quorumSet(all, (v) => v.brands.map(canonBrand).filter((b): b is string => !!b), 0.5),
      style: quorumSet(all, (v) => v.style_tags.filter((t) => STYLE_TAGS.includes(t)), 0.5),
      gender: gender ? [gender] : [],
      city,
      price_min: price('price_min'),
      price_max: price('price_max'),
    };
    if (filters.price_min != null && filters.price_max != null && filters.price_min > filters.price_max) [filters.price_min, filters.price_max] = [filters.price_max, filters.price_min];

    // Keywords: words at least half of the voters kept, minus anything a filter already covers.
    const covered = [
      ...filters.category.flatMap((c) => CATEGORIES.find((x) => x.slug === c)!.label.toLowerCase().split(' ')),
      ...filters.subcategory.flatMap((s) => (catObj?.subcategories.find((x) => x.slug === s)?.label.toLowerCase().split(' ') ?? [])),
      ...filters.brand.map((b) => b.toLowerCase()),
    ].map(stem);
    const tokens = quorumSet(all, (v) => v.keywords.toLowerCase().split(/[^a-zа-яё0-9'-]+/).filter((w) => w.length >= 2 && !STOP.has(w) && !SEASON.test(w)), 0.5);
    filters.q = tokens.filter((t) => !covered.some((c) => c.length >= 3 && stem(t).startsWith(c.slice(0, 4)))).slice(0, 4).join(' ');

    const chips: SearchInterpretation['chips'] = [];
    if (filters.subcategory.length) chips.push({ key: 'subcategory', label: catObj!.subcategories.find((s) => s.slug === filters.subcategory[0])!.label });
    else if (filters.category.length) chips.push({ key: 'category', label: catObj!.label });
    for (const c of filters.color) chips.push({ key: 'color', label: COLORS.find((x) => x.value === c)!.label });
    if (filters.size.length) chips.push({ key: 'size', label: `Размер ${filters.size.join(', ')}` });
    for (const c of filters.condition) chips.push({ key: 'condition', label: CONDITIONS.find((x) => x.value === c)!.label });
    for (const b of filters.brand) chips.push({ key: 'brand', label: b });
    for (const s of filters.style) chips.push({ key: 'style', label: s });
    if (filters.gender.length) chips.push({ key: 'gender', label: { MALE: 'Мужское', FEMALE: 'Женское', UNISEX: 'Унисекс' }[filters.gender[0]]! });
    if (filters.city) chips.push({ key: 'city', label: filters.city });
    if (filters.price_min != null || filters.price_max != null) {
      chips.push({ key: 'price_max', label: filters.price_min != null && filters.price_max != null ? `${filters.price_min}–${filters.price_max} BYN` : filters.price_max != null ? `до ${filters.price_max} BYN` : `от ${filters.price_min} BYN` });
    }
    if (filters.q) chips.push({ key: 'q', label: `«${filters.q}»` });

    const structured = chips.some((c) => c.key !== 'q');
    return { status: structured ? 'ok' : 'skip', filters, chips, source: ai.length ? 'ai' : 'rules' };
  }
}
