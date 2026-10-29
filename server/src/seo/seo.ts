import { createHash } from 'crypto';
import { brandRussian, findBrandInText } from '../catalog/brands.js';
import { categoryBySlug, COLORS, CONDITIONS } from '../catalog/catalog.js';
import type { Condition, DeliveryMethod, Gender, ListingMarket, ListingStatus, SizeSystem } from '../generated/prisma/client.js';

/**
 * Search snippet of an item page, built from the listing's own facts: the <title>, the meta description, the URL slug,
 * the photos' alt text and the product name for structured data.
 *
 * How the pages people find look on big marketplaces (Avito, Kufar, Vinted, Grailed, eBay): the title is the item as
 * people search for it — what it is, the brand and model, then colour, who it is for and the size — with the price
 * and the place («купить в Минске») when they fit; the description repeats the facts a buyer filters by and one line
 * about the item itself. So the name here is built the same way, in proper Russian (a «чёрная куртка», but a «чёрный
 * свитер» and «чёрные джинсы»), and never says anything the listing doesn't: every word comes from a field the seller
 * filled in, or from the seller's own text (the model name and features the AI pass found there, see seo-writer.ts).
 */

type Gram = 'm' | 'f' | 'n' | 'pl';
interface Noun {
  /** How people name it in a search, lower case: «куртка», «джинсы клёш», «сумка кросс-боди». */
  n: string;
  g: Gram;
}

/** Item names per subcategory, with their grammatical gender for the adjectives around them. */
const NOUNS: Record<string, Noun> = {
  // outerwear
  jacket: { n: 'куртка', g: 'f' }, 'leather-jacket': { n: 'кожаная куртка', g: 'f' }, 'denim-jacket': { n: 'джинсовая куртка', g: 'f' },
  bomber: { n: 'бомбер', g: 'm' }, windbreaker: { n: 'ветровка', g: 'f' }, parka: { n: 'парка', g: 'f' }, coat: { n: 'пальто', g: 'n' },
  puffer: { n: 'пуховик', g: 'm' }, trench: { n: 'тренч', g: 'm' }, raincoat: { n: 'плащ', g: 'm' }, fur: { n: 'шуба', g: 'f' },
  sheepskin: { n: 'дублёнка', g: 'f' }, vest: { n: 'жилет', g: 'm' },
  // tshirts
  tshirt: { n: 'футболка', g: 'f' }, longsleeve: { n: 'лонгслив', g: 'm' }, top: { n: 'топ', g: 'm' }, tank: { n: 'майка', g: 'f' }, polo: { n: 'поло', g: 'n' },
  // shirts
  shirt: { n: 'рубашка', g: 'f' }, blouse: { n: 'блузка', g: 'f' }, overshirt: { n: 'овершот', g: 'm' }, tunic: { n: 'туника', g: 'f' },
  // knitwear
  sweater: { n: 'свитер', g: 'm' }, turtleneck: { n: 'водолазка', g: 'f' }, hoodie: { n: 'худи', g: 'n' }, 'zip-hoodie': { n: 'зип-худи', g: 'n' },
  sweatshirt: { n: 'свитшот', g: 'm' }, cardigan: { n: 'кардиган', g: 'm' },
  // trousers
  trousers: { n: 'брюки', g: 'pl' }, chinos: { n: 'чиносы', g: 'pl' }, cargo: { n: 'брюки карго', g: 'pl' }, joggers: { n: 'джоггеры', g: 'pl' },
  sweatpants: { n: 'спортивные штаны', g: 'pl' }, leggings: { n: 'леггинсы', g: 'pl' },
  // jeans: the subcategory is the fit
  straight: { n: 'прямые джинсы', g: 'pl' }, slim: { n: 'джинсы слим', g: 'pl' }, skinny: { n: 'джинсы скинни', g: 'pl' }, wide: { n: 'широкие джинсы', g: 'pl' },
  mom: { n: 'джинсы мом', g: 'pl' }, baggy: { n: 'джинсы багги', g: 'pl' }, flare: { n: 'джинсы клёш', g: 'pl' },
  // shorts
  shorts: { n: 'шорты', g: 'pl' }, 'denim-shorts': { n: 'джинсовые шорты', g: 'pl' }, 'sport-shorts': { n: 'спортивные шорты', g: 'pl' }, bermuda: { n: 'бермуды', g: 'pl' },
  // skirts: the subcategory is the length or the cut
  mini: { n: 'юбка мини', g: 'f' }, midi: { n: 'юбка миди', g: 'f' }, maxi: { n: 'юбка макси', g: 'f' }, pleated: { n: 'юбка плиссе', g: 'f' },
  pencil: { n: 'юбка-карандаш', g: 'f' }, 'denim-skirt': { n: 'джинсовая юбка', g: 'f' },
  // dresses
  dress: { n: 'платье', g: 'n' }, 'evening-dress': { n: 'вечернее платье', g: 'n' }, 'shirt-dress': { n: 'платье-рубашка', g: 'n' },
  'knit-dress': { n: 'трикотажное платье', g: 'n' }, sundress: { n: 'сарафан', g: 'm' }, jumpsuit: { n: 'комбинезон', g: 'm' },
  // suits
  suit: { n: 'костюм', g: 'm' }, pantsuit: { n: 'брючный костюм', g: 'm' }, blazer: { n: 'пиджак', g: 'm' }, tracksuit: { n: 'спортивный костюм', g: 'm' },
  // swimwear and homewear
  swimsuit: { n: 'купальник', g: 'm' }, 'swim-trunks': { n: 'плавки', g: 'pl' }, pajamas: { n: 'пижама', g: 'f' }, robe: { n: 'халат', g: 'm' },
  homewear: { n: 'домашний костюм', g: 'm' },
  // shoes
  sneakers: { n: 'кроссовки', g: 'pl' }, keds: { n: 'кеды', g: 'pl' }, boots: { n: 'ботинки', g: 'pl' }, chelsea: { n: 'челси', g: 'pl' },
  'high-boots': { n: 'сапоги', g: 'pl' }, 'ankle-boots': { n: 'ботильоны', g: 'pl' }, uggs: { n: 'угги', g: 'pl' }, shoes: { n: 'туфли', g: 'pl' },
  loafers: { n: 'лоферы', g: 'pl' }, 'ballet-flats': { n: 'балетки', g: 'pl' }, mules: { n: 'мюли', g: 'pl' }, sandals: { n: 'сандалии', g: 'pl' },
  slides: { n: 'шлёпанцы', g: 'pl' },
  // bags
  handbag: { n: 'сумка', g: 'f' }, backpack: { n: 'рюкзак', g: 'm' }, tote: { n: 'шоппер', g: 'm' }, crossbody: { n: 'сумка кросс-боди', g: 'f' },
  clutch: { n: 'клатч', g: 'm' }, 'belt-bag': { n: 'поясная сумка', g: 'f' }, 'travel-bag': { n: 'дорожная сумка', g: 'f' }, wallet: { n: 'кошелёк', g: 'm' },
  // accessories
  hat: { n: 'головной убор', g: 'm' }, cap: { n: 'кепка', g: 'f' }, beanie: { n: 'шапка', g: 'f' }, scarf: { n: 'шарф', g: 'm' }, gloves: { n: 'перчатки', g: 'pl' },
  belt: { n: 'ремень', g: 'm' }, tie: { n: 'галстук', g: 'm' }, jewelry: { n: 'украшение', g: 'n' }, watch: { n: 'часы', g: 'pl' }, glasses: { n: 'очки', g: 'pl' },
  hair: { n: 'аксессуар для волос', g: 'm' }, other: { n: 'аксессуар', g: 'm' },
};

/** When only the category is known. */
const CATEGORY_NOUNS: Record<string, Noun> = {
  outerwear: { n: 'куртка', g: 'f' }, tshirts: { n: 'футболка', g: 'f' }, shirts: { n: 'рубашка', g: 'f' }, knitwear: { n: 'кофта', g: 'f' },
  trousers: { n: 'брюки', g: 'pl' }, jeans: { n: 'джинсы', g: 'pl' }, shorts: { n: 'шорты', g: 'pl' }, skirts: { n: 'юбка', g: 'f' },
  dresses: { n: 'платье', g: 'n' }, suits: { n: 'костюм', g: 'm' }, swimwear: { n: 'домашняя одежда', g: 'f' }, shoes: { n: 'обувь', g: 'f' },
  bags: { n: 'сумка', g: 'f' }, accessories: { n: 'аксессуар', g: 'm' },
};

type Forms = Record<Gram, string>;
const adj = (m: string, f: string, n: string, pl: string): Forms => ({ m, f, n, pl });

const COLOR_FORMS: Record<string, Forms> = {
  black: adj('чёрный', 'чёрная', 'чёрное', 'чёрные'),
  white: adj('белый', 'белая', 'белое', 'белые'),
  gray: adj('серый', 'серая', 'серое', 'серые'),
  beige: adj('бежевый', 'бежевая', 'бежевое', 'бежевые'),
  brown: adj('коричневый', 'коричневая', 'коричневое', 'коричневые'),
  red: adj('красный', 'красная', 'красное', 'красные'),
  pink: adj('розовый', 'розовая', 'розовое', 'розовые'),
  orange: adj('оранжевый', 'оранжевая', 'оранжевое', 'оранжевые'),
  yellow: adj('жёлтый', 'жёлтая', 'жёлтое', 'жёлтые'),
  green: adj('зелёный', 'зелёная', 'зелёное', 'зелёные'),
  blue: adj('синий', 'синяя', 'синее', 'синие'),
  lightblue: adj('голубой', 'голубая', 'голубое', 'голубые'),
  purple: adj('фиолетовый', 'фиолетовая', 'фиолетовое', 'фиолетовые'),
  multi: adj('разноцветный', 'разноцветная', 'разноцветное', 'разноцветные'),
};
/** Stems of every colour word, for checking that generated text names no colour but the item's own. */
export const COLOR_STEMS: Record<string, string[]> = {
  black: ['чёрн', 'черн'], white: ['бел'], gray: ['сер'], beige: ['бежев'], brown: ['коричнев'], red: ['красн'], pink: ['розов'], orange: ['оранжев'],
  yellow: ['жёлт', 'желт'], green: ['зелён', 'зелен'], blue: ['син'], lightblue: ['голуб'], purple: ['фиолетов'], multi: ['разноцветн'],
};

const GENDER_FORMS: Record<'MALE' | 'FEMALE', Forms> = {
  MALE: adj('мужской', 'мужская', 'мужское', 'мужские'),
  FEMALE: adj('женский', 'женская', 'женское', 'женские'),
};
const NEW_FORMS = adj('новый', 'новая', 'новое', 'новые');

/** «в Минске»: the cities sellers pick from (catalog CITIES), in the prepositional case. */
export const CITY_IN: Record<string, string> = {
  Минск: 'Минске', Брест: 'Бресте', Витебск: 'Витебске', Гомель: 'Гомеле', Гродно: 'Гродно', Могилёв: 'Могилёве', Бобруйск: 'Бобруйске',
  Барановичи: 'Барановичах', Борисов: 'Борисове', Пинск: 'Пинске',
};

/** What the AI pass found in the seller's own text (seo-writer.ts); every piece is checked against the text again here. */
export interface SeoAi {
  /** Content hash the pass was run on (`contentHash`). */
  hash: string;
  /** Model or collection name exactly as the seller wrote it: «Air Max 90», «Тень». */
  model?: string | null;
  /** A brand the seller named in the text when the brand field is empty. */
  brand?: string | null;
  /** Up to two features from the text a buyer would search by: «оверсайз», «с вышивкой». */
  features?: string[];
  /** One sentence about the item for the meta description. */
  blurb?: string | null;
}

export interface SeoListing {
  id: string;
  status: ListingStatus;
  title: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  color: string | null;
  material: string | null;
  gender: Gender | null;
  condition: Condition | null;
  hasTags: boolean | null;
  sizeSystem: SizeSystem | null;
  sizeValue: string | null;
  sizes: string[];
  price: number | null;
  priceNegotiable: boolean;
  city: string | null;
  deliveryOptions: DeliveryMethod[];
  market: ListingMarket;
  /** The current bid or the start price while an auction runs. */
  auctionPrice?: number | null;
  ai?: SeoAi | null;
}

export interface Seo {
  /** <title> without the site name (the layout adds «· ichiba»). */
  title: string;
  description: string;
  /** The item as people search for it: «Куртка Carhartt Detroit чёрная мужская». Product name in structured data. */
  name: string;
  /** Latin URL words before the id: «kurtka-carhartt-detroit-chernaya». */
  slug: string;
  /** Russian spelling of a Latin brand, for structured data (alternateName): «Кархарт». */
  brandRu: string | null;
  /** The brand the snippet names (the field, or one found in the seller's text). */
  brand: string | null;
  /** The colour's name for structured data: «Чёрный». */
  color: string | null;
}

/**
 * Google rewrites most titles over ~60 characters (Zyppy, 80 000 titles) and Yandex shows about 70: with « · ichiba»
 * added by the layout the whole title stays near 65.
 */
export const TITLE_MAX = 56;
/** Google cuts descriptions near 155–160 characters on desktop. */
export const DESCRIPTION_MAX = 158;

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

function nounOf(l: Pick<SeoListing, 'category' | 'subcategory'>): Noun | null {
  return (l.subcategory && NOUNS[l.subcategory]) || (l.category && CATEGORY_NOUNS[l.category]) || null;
}

/** Words of a text for grounding checks: lower case, ё as е, letters and digits only. */
export const words = (s: string): string[] => s.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Whether the seller's text says this: every word of `phrase` is in the text (Russian words by their stem, so
 * «камуфляжные» is grounded by «камуфляжной»). The AI pass may only bring back what the seller wrote.
 */
export function grounded(phrase: string, source: string) {
  const src = words(source);
  const ws = words(phrase);
  if (!ws.length) return false;
  return ws.every((w) => {
    if (/^\d+$/.test(w) || w.length <= 3 || !hasCyrillic(w)) return src.includes(w);
    const stem = w.slice(0, Math.max(4, w.length - 3));
    return src.some((s) => s.startsWith(stem));
  });
}

/** The text the seller wrote about the item; the AI pass reads it and everything it brings back is checked against it. */
export const sellerText = (l: Pick<SeoListing, 'title' | 'description'>) => `${clean(l.title)}\n${clean(l.description)}`;

/** Changes to these send the listing through the AI pass again. */
export function contentHash(l: Pick<SeoListing, 'title' | 'description' | 'category' | 'subcategory' | 'brand' | 'color' | 'material' | 'gender'>) {
  return createHash('sha256')
    .update(JSON.stringify([l.title, l.description, l.category, l.subcategory, l.brand, l.color, l.material, l.gender]))
    .digest('hex')
    .slice(0, 16);
}

/** The model name, only while the current text still has it and it isn't just the brand or the item word. */
function modelOf(l: SeoListing, brand: string | null, noun: Noun | null) {
  const m = clean(l.ai?.model).replace(/^[«"'“]+|[»"'”]+$/g, '');
  if (!m || m.length > 40 || !grounded(m, sellerText(l)) || nounIn(m)) return null;
  const key = words(m).join(' ');
  if (brand && key === words(brand).join(' ')) return null;
  if (noun && words(noun.n).join(' ') === key) return null;
  return m;
}

function brandOf(l: SeoListing) {
  const own = clean(l.brand);
  if (own) return own;
  // A brand the seller only wrote in the title: the catalogue lookup finds it (descriptions name other brands too, «как
  // у Zara»), and the AI pass may confirm one it missed.
  const found = findBrandInText(clean(l.title))?.brand;
  if (found) return found;
  const ai = clean(l.ai?.brand);
  return ai && grounded(ai, sellerText(l)) ? ai : null;
}

function sizePhrase(l: SeoListing): string | null {
  const sizes = (l.sizes.length > 1 ? l.sizes : [l.sizeValue]).filter((s): s is string => !!s && l.sizeSystem !== 'OTHER');
  if (!sizes.length) return null;
  const list = sizes.join(', ');
  return sizes.length > 1 ? `размеры ${list}` : `размер ${list}`;
}

/** «б/у», «новая с биркой», «новые»: worn items are searched for as б/у, new ones by the tag. */
function conditionShort(l: SeoListing, g: Gram): string | null {
  if (!l.condition) return null;
  if (l.condition !== 'NEW_WITH_TAGS') return 'б/у';
  return l.hasTags ? `${NEW_FORMS[g]} с биркой` : NEW_FORMS[g];
}

function conditionLong(l: SeoListing): string | null {
  if (!l.condition) return null;
  if (l.condition === 'NEW_WITH_TAGS') return l.hasTags === false ? 'новое, без бирки' : l.hasTags ? 'новое, с биркой' : 'новое';
  return CONDITIONS.find((c) => c.value === l.condition)?.label.toLowerCase() ?? null;
}

const priceOf = (l: SeoListing) => l.auctionPrice ?? (l.priceNegotiable ? null : l.price);

/** Title pieces in reading order; `rank` decides which go first when the title is too long (higher stays longer). */
export interface Piece {
  text: string;
  rank: number;
  sep: string;
}

export function fit(pieces: Piece[], max: number) {
  const kept = [...pieces];
  const join = (ps: Piece[]) => ps.map((p, i) => (i ? p.sep : '') + p.text).join('');
  while (join(kept).length > max) {
    const weakest = kept.reduce((w, p) => (p.rank < w.rank ? p : w), kept[0]);
    if (weakest.rank >= 100) break;
    kept.splice(kept.indexOf(weakest), 1);
  }
  return join(kept);
}

/** Cuts at the last word that fits and adds an ellipsis. */
function clip(s: string, max: number) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

/** The first sentence or two of the seller's description, as long as they fit. */
function lead(text: string, room: number) {
  const sentences = clean(text).match(/[^.!?…]+[.!?…]*/g) ?? [];
  let out = '';
  for (const s of sentences) {
    const next = `${out} ${s.trim()}`.trim();
    if (next.length > room) break;
    out = next;
  }
  return out || (room >= 40 ? clip(clean(text), room) : '');
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Latin URL words, Yandex-style transliteration: «Чёрная куртка» → «chernaya-kurtka». */
export function slugify(s: string, max = 60) {
  const t = s
    .toLowerCase()
    // Cyrillic first (й would lose its breve below), then Latin diacritics: «Hermès» → «hermes».
    .replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf('-');
  return (at > 10 ? cut.slice(0, at) : t.slice(0, max)).replace(/-+$/, '');
}


/**
 * Words that name the item, with the gender adjectives agree with: when the seller's title already says what the item
 * is («Белая кофта», «Футбольная майка»), it stays the name and colour or gender are added in its own grammar.
 * A stem matches a word's start with at most three letters left over («куртк» → «куртка», «куртку»).
 */
const TITLE_NOUNS: Array<[string, Gram]> = (
  [
    ['куртк', 'f'], ['курточк', 'f'], ['косух', 'f'], ['джинсовк', 'f'], ['бомбер', 'm'], ['ветровк', 'f'], ['парка', 'f'], ['пальто', 'n'],
    ['пуховик', 'm'], ['тренч', 'm'], ['плащ', 'm'], ['шуб', 'f'], ['шубк', 'f'], ['дублёнк', 'f'], ['жилет', 'm'], ['жилетк', 'f'], ['анорак', 'm'],
    ['пиджак', 'm'], ['жакет', 'm'], ['блейзер', 'm'], ['футболк', 'f'], ['лонгслив', 'm'], ['топ', 'm'], ['топик', 'm'], ['майк', 'f'], ['поло', 'n'],
    ['рубашк', 'f'], ['рубах', 'f'], ['блуз', 'f'], ['блузк', 'f'], ['овершот', 'm'], ['туник', 'f'], ['свитер', 'm'], ['водолазк', 'f'], ['гольф', 'm'],
    ['худи', 'n'], ['толстовк', 'f'], ['свитшот', 'm'], ['кардиган', 'm'], ['кофт', 'f'], ['кофточк', 'f'], ['джемпер', 'm'], ['пуловер', 'm'],
    ['брюк', 'pl'], ['штан', 'pl'], ['чинос', 'pl'], ['карго', 'pl'], ['джоггер', 'pl'], ['леггинс', 'pl'], ['лосин', 'pl'], ['джинс', 'pl'],
    ['шорт', 'pl'], ['бермуд', 'pl'], ['юбк', 'f'], ['юбочк', 'f'], ['плать', 'n'], ['платьиц', 'n'], ['сарафан', 'm'], ['комбинезон', 'm'],
    ['костюм', 'm'], ['купальник', 'm'], ['плавк', 'pl'], ['пижам', 'f'], ['халат', 'm'], ['кроссовк', 'pl'], ['кроссовок', 'pl'], ['кед', 'pl'],
    ['ботинк', 'pl'], ['ботинок', 'pl'], ['челси', 'pl'], ['сапог', 'pl'], ['сапожк', 'pl'], ['ботильон', 'pl'], ['угг', 'pl'], ['туфл', 'pl'],
    ['туфель', 'pl'], ['лофер', 'pl'], ['балетк', 'pl'], ['мюли', 'pl'], ['сандал', 'pl'], ['босоножк', 'pl'], ['шлёпанц', 'pl'], ['слайд', 'pl'],
    ['сумк', 'f'], ['сумочк', 'f'], ['рюкзак', 'm'], ['шоппер', 'm'], ['клатч', 'm'], ['кошелёк', 'm'], ['кошельк', 'm'], ['портмоне', 'n'],
    ['кепк', 'f'], ['бейсболк', 'f'], ['шапк', 'f'], ['панам', 'f'], ['шляп', 'f'], ['берет', 'm'], ['шарф', 'm'], ['палантин', 'm'], ['платок', 'm'],
    ['перчатк', 'pl'], ['варежк', 'pl'], ['ремень', 'm'], ['ремешок', 'm'], ['пояс', 'm'], ['галстук', 'm'], ['часы', 'pl'], ['очки', 'pl'],
    ['серьг', 'pl'], ['серёжк', 'pl'], ['кольц', 'n'], ['браслет', 'm'], ['цепочк', 'f'], ['цепь', 'f'], ['колье', 'n'], ['кулон', 'm'], ['подвеск', 'f'],
    ['олимпийк', 'f'], ['безрукавк', 'f'], ['зипк', 'f'], ['брелоки', 'pl'], ['брелок', 'm'], ['брелк', 'pl'], ['тракер', 'm'], ['бандан', 'f'], ['носк', 'pl'], ['гетр', 'pl'],
  ] as Array<[string, Gram]>
).map(([stem, g]) => [stem.replace(/ё/g, 'е'), g]);

/** The gender of the first word in the text that names an item. */
function nounIn(text: string): Gram | null {
  const ws = words(text);
  for (let i = 0; i < ws.length; i++) {
    // «Брелок на сумку»: a word after a preposition is not the item.
    if (i > 0 && PREPOSITIONS.has(ws[i - 1])) continue;
    const noun = TITLE_NOUNS.find(([stem]) => ws[i].startsWith(stem) && ws[i].length - stem.length <= 3);
    if (!noun) continue;
    // The seller's adjective decides, a word or two before («меховая зип-худи» stays feminine).
    const adjective = ws.slice(Math.max(0, i - 2), i).reverse().find((w) => w.length >= 4 && ADJ_GENDER.some(([re]) => re.test(w)));
    return (adjective && ADJ_GENDER.find(([re]) => re.test(adjective))?.[1]) || noun[1];
  }
  return null;
}

/** Gender by an adjective's ending. */
const ADJ_GENDER: Array<[RegExp, Gram]> = [
  [/(ая|яя)$/, 'f'],
  [/(ый|ий|ой)$/, 'm'],
  [/(ое|ее)$/, 'n'],
  [/(ые|ие)$/, 'pl'],
];

/** A title with one of these already says the colour («молочный», «светло-голубые», «в полоску»). */
const SHADE_STEMS = ['молочн', 'кремов', 'бордов', 'хаки', 'графит', 'пудров', 'мятн', 'оливк', 'светл', 'темн', 'камуфл', 'леопард', 'бирюз', 'сирен', 'лилов', 'горчичн', 'терракот', 'песочн', 'шоколадн', 'изумрудн', 'серебрист', 'золот', 'мультиколор', 'полоск', 'клетк', 'принт'];
const COLOUR_WORDS = [...Object.values(COLOR_STEMS).flat(), ...SHADE_STEMS].map((s) => s.replace(/ё/g, 'е'));
const saysColour = (text: string) => words(text).some((w) => COLOUR_WORDS.some((s) => w.startsWith(s)));

/** Promotion has no place in a product name (Google Merchant rules), and shouting is calmed down. */
const PROMO = /(^|\s)(срочно|торг|скидк\p{L}*|распродаж\p{L}*|дешево|дёшево|акция|sale|продам|продаю|отдам)(?=\s|$|[,.!])/giu;
export function tidyTitle(raw: string) {
  let t = clean(raw.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ').replace(/!{2,}/g, '!').replace(PROMO, ' '))
    .replace(/\s+([,.!»”)])/g, '$1')
    .replace(/^[\s,.;:!—-]+|[\s,.;:!—-]+$/g, '');
  // Russian words in capitals are shouting; Latin ones are usually a brand or a model («I LOVE REDHEAD») and stay.
  const letters = t.match(/[а-яё]/giu) ?? [];
  const upper = t.match(/[А-ЯЁ]/gu) ?? [];
  if (letters.length >= 8 && upper.length / letters.length > 0.7) t = cap(t.replace(/[А-ЯЁ]{2,}/gu, (w) => w.toLowerCase()));
  return t;
}

/** A Russian adjective ending: the title describes the item rather than just naming a model («Розовая олимпийка»). */
const describes = (text: string) => words(text).some((w) => w.length >= 4 && hasCyrillic(w) && /(ая|яя|ый|ий|ой|ое|ее|ые|ие)$/.test(w));
/** After a phrase like «с вышивкой» or «из экокожи» an adjective can't be tacked on at the end. */
const PREPOSITIONS = new Set(['с', 'со', 'в', 'во', 'на', 'из', 'под', 'без', 'для', 'от', 'по', 'у', 'к', 'за', 'и', 'x', '×']);
const openEnded = (text: string) => text.includes(',') || words(text).some((w) => PREPOSITIONS.has(w));
/** The brand counts as written when its longest word is in the text: «Hilfiger Denim» has Tommy Hilfiger. */
function mentions(text: string, brand: string) {
  const longest = words(brand).sort((a, b) => b.length - a.length)[0];
  return !!longest && words(text).includes(longest);
}

export function buildSeo(l: SeoListing): Seo {
  const noun = nounOf(l);
  const own = tidyTitle(l.title);
  const brand = brandOf(l);
  const model = modelOf(l, brand, noun);
  const has = (phrase: string | null | undefined, text: string) => !!phrase && ` ${words(text).join(' ')} `.includes(` ${words(phrase).join(' ')} `);

  // The name: the seller's title when it says what the item is (it holds the details people search by and keeps every
  // item's title its own); otherwise the catalogue word for the item first, then the title.
  const titleGram = own ? nounIn(own) : null;
  let head: string;
  let g: Gram;
  if (own && titleGram) [head, g] = [own, titleGram];
  // «Розовая олимпийка»: a description in its own words stays, the catalogue word goes to the facts below.
  else if (own && describes(own)) [head, g] = [own, noun?.g ?? 'm'];
  // «MIRAR «Тень»», «Freeman T. Porter хаки»: only a brand or a model, so the item word goes first.
  else if (noun) [head, g] = [own ? `${cap(noun.n)} ${own}` : cap(noun.n), noun.g];
  else [head, g] = [own || 'Вещь', 'm'];

  const brandPart = brand && !mentions(head, brand) ? brand : null;
  const modelPart = model && !has(model, head) ? (hasCyrillic(model) ? `«${model}»` : model) : null;
  if (brandPart || modelPart) head = [head, brandPart, modelPart].filter(Boolean).join(' ');

  // The colour in front, as Russian puts it («Чёрная дутая куртка Zara из экокожи»), unless the title starts in Latin.
  const colorWord = l.color && !saysColour(head) ? COLOR_FORMS[l.color]?.[g] : undefined;
  let colorInFacts = false;
  if (colorWord && /^[А-ЯЁа-яё]/.test(head) && !/^[А-ЯЁ]{2,}/.test(head)) head = `${cap(colorWord)} ${head[0].toLowerCase()}${head.slice(1)}`;
  else if (colorWord && !openEnded(head)) head = `${head} ${colorWord}`;
  else if (colorWord) colorInFacts = true;
  // Skirts and dresses need no «женская»; unisex items get no word at all. At the end of the name, or among the facts.
  const genderObvious = !!categoryBySlug(l.category)?.genders?.every((x) => x === l.gender);
  const gender = (l.gender === 'MALE' || l.gender === 'FEMALE') && !genderObvious && !/(муж|жен)/i.test(head) ? l.gender : null;
  const genderWord = gender && !openEnded(head) ? GENDER_FORMS[gender][g] : undefined;
  const genderFact = gender && !genderWord ? (gender === 'MALE' ? 'для мужчин' : 'для женщин') : null;
  const features = (l.ai?.features ?? []).map(clean).filter((f) => f && f.length <= 24 && grounded(f, sellerText(l)) && !grounded(f, head));
  const name = [head, genderWord].filter(Boolean).join(' ');

  const size = /размер|\bр-?р\b/i.test(head) ? null : sizePhrase(l);
  const cond = conditionShort(l, g);
  const price = priceOf(l);
  const cityIn = l.city ? CITY_IN[l.city] : undefined;
  const where = cityIn ? `в ${cityIn}` : 'в Беларуси';

  // Ranks: the name never goes; then the price, size, condition, place, gender and a feature from the text.
  const title = fit(
    [
      { text: head, rank: 100, sep: '' },
      ...(genderWord ? [{ text: genderWord, rank: 20, sep: ' ' }] : []),
      ...(features[0] && !genderWord && !openEnded(head) ? [{ text: features[0], rank: 30, sep: ' ' }] : []),
      ...(size ? [{ text: size, rank: 55, sep: ', ' }] : []),
      ...(cond && !has(cond, head) ? [{ text: cond, rank: l.market === 'RESALE' ? 50 : 25, sep: ', ' }] : []),
      ...(price != null ? [{ text: `${price} р.`, rank: 80, sep: ' — ' }] : []),
      { text: `купить ${where}`, rank: 35, sep: price != null ? ', ' : ' — ' },
    ],
    TITLE_MAX,
  );

  // The description: facts a buyer filters by first, then one line about the item, then how it is handed over.
  const offer = l.auctionPrice != null ? `аукцион, ставка от ${l.auctionPrice} р.` : price != null ? `цена ${price} р.` : 'цена договорная';
  // The catalogue word leads the facts when the title calls the item otherwise («кофта» that is a «лонгслив»).
  const kind = noun && !has(noun.n, name) ? noun.n : null;
  const facts = cap(
    [kind, genderFact, colorInFacts && l.color ? `цвет: ${COLOR_FORMS[l.color].m}` : null, size, conditionLong(l) && `состояние: ${conditionLong(l)}`, clean(l.material) && clean(l.material) !== 'Другое' ? `материал: ${clean(l.material).toLowerCase()}` : null]
      .filter(Boolean)
      .join(', '),
  );
  const delivery = l.deliveryOptions.includes('DELIVERY')
    ? cityIn
      ? `Доставка по Беларуси или встреча в ${cityIn}.`
      : 'Доставка по Беларуси.'
    : cityIn
      ? `Встреча в ${cityIn}.`
      : '';
  const first = `${name} — ${offer}`.replace(/\.?$/, '.');
  const factsLine = facts ? `${facts}.` : '';
  const blurb = l.ai?.hash === contentHash(l) ? clean(l.ai.blurb) : '';
  const fixed = [first, factsLine].filter(Boolean).join(' ');
  const roomForAbout = DESCRIPTION_MAX - fixed.length - (delivery ? delivery.length + 1 : 0) - 1;
  const about = blurb && blurb.length <= roomForAbout ? blurb : lead(l.description ?? '', roomForAbout);
  // Room left: the commercial words people add to a search, as Kufar and Avito end theirs.
  const call = `Купить ${where} на ichiba.`;
  let description = [fixed, about, delivery].filter(Boolean).join(' ');
  if (description.length + call.length + 1 <= DESCRIPTION_MAX) description = `${description} ${call}`;
  if (description.length > DESCRIPTION_MAX) description = clip([fixed, about].filter(Boolean).join(' '), DESCRIPTION_MAX);

  const brandRu = brand && !hasCyrillic(brand) ? brandRussian(brand) : null;
  return {
    title,
    description,
    name,
    slug: slugify(head) || 'item',
    brandRu: brandRu ? cap(brandRu) : null,
    brand,
    color: COLORS.find((c) => c.value === l.color)?.label ?? null,
  };
}
