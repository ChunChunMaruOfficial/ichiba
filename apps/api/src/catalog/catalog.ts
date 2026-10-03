// Catalog reference data (frames 07 SEARCH, 09 WARDROBE, 21 DATA MODEL).
// Served to the web app via GET /meta so both sides share one source.

export type WardrobeSection = 'top' | 'bottom' | 'shoes' | 'accessories';
export type ChipGroup = 'clothing' | 'shoes' | 'accessories' | 'bags';
export type SizeSystemKey = 'ALPHA' | 'SHOE_EU' | 'JEANS_W' | 'OTHER';

export interface Category {
  slug: string;
  label: string;
  section: WardrobeSection;
  group: ChipGroup;
  sizeSystems: SizeSystemKey[];
  subcategories: Array<{ slug: string; label: string }>;
}

const sub = (pairs: string[][]) => pairs.map(([slug, label]) => ({ slug, label }));

export const CATEGORIES: Category[] = [
  {
    slug: 'outerwear', label: 'Верхняя одежда', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['jacket', 'Куртка'], ['leather-jacket', 'Кожаная куртка'], ['coat', 'Пальто'], ['puffer', 'Пуховик'], ['trench', 'Тренч'], ['vest', 'Жилет']]),
  },
  {
    slug: 'tshirts', label: 'Футболки', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['tshirt', 'Футболка'], ['longsleeve', 'Лонгслив'], ['tank', 'Майка'], ['polo', 'Поло']]),
  },
  {
    slug: 'shirts', label: 'Рубашки', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['shirt', 'Рубашка'], ['blouse', 'Блузка'], ['overshirt', 'Овершот']]),
  },
  {
    slug: 'knitwear', label: 'Свитера и худи', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['sweater', 'Свитер'], ['hoodie', 'Худи'], ['sweatshirt', 'Свитшот'], ['cardigan', 'Кардиган']]),
  },
  {
    slug: 'trousers', label: 'Брюки', section: 'bottom', group: 'clothing', sizeSystems: ['ALPHA', 'JEANS_W'],
    subcategories: sub([['trousers', 'Брюки'], ['cargo', 'Карго'], ['joggers', 'Джоггеры']]),
  },
  {
    slug: 'jeans', label: 'Джинсы', section: 'bottom', group: 'clothing', sizeSystems: ['JEANS_W', 'ALPHA'],
    subcategories: sub([['straight', 'Прямые'], ['skinny', 'Скинни'], ['wide', 'Широкие']]),
  },
  {
    slug: 'shorts', label: 'Шорты', section: 'bottom', group: 'clothing', sizeSystems: ['ALPHA', 'JEANS_W'],
    subcategories: sub([['shorts', 'Шорты'], ['denim-shorts', 'Джинсовые шорты']]),
  },
  {
    slug: 'skirts', label: 'Юбки', section: 'bottom', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['mini', 'Мини'], ['midi', 'Миди'], ['maxi', 'Макси']]),
  },
  {
    slug: 'dresses', label: 'Платья', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['dress', 'Платье'], ['jumpsuit', 'Комбинезон']]),
  },
  {
    slug: 'suits', label: 'Костюмы', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['suit', 'Костюм'], ['blazer', 'Пиджак']]),
  },
  {
    slug: 'shoes', label: 'Обувь', section: 'shoes', group: 'shoes', sizeSystems: ['SHOE_EU'],
    subcategories: sub([['sneakers', 'Кроссовки'], ['boots', 'Ботинки'], ['shoes', 'Туфли'], ['sandals', 'Сандалии'], ['loafers', 'Лоферы']]),
  },
  {
    slug: 'bags', label: 'Сумки', section: 'accessories', group: 'bags', sizeSystems: [],
    subcategories: sub([['handbag', 'Сумка'], ['backpack', 'Рюкзак'], ['tote', 'Шоппер'], ['crossbody', 'Кросс-боди']]),
  },
  {
    slug: 'accessories', label: 'Аксессуары', section: 'accessories', group: 'accessories', sizeSystems: [],
    subcategories: sub([['hat', 'Головной убор'], ['scarf', 'Шарф'], ['belt', 'Ремень'], ['jewelry', 'Украшения'], ['glasses', 'Очки'], ['other', 'Другое']]),
  },
];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
export const categoryBySlug = (slug?: string | null) => CATEGORIES.find((c) => c.slug === slug);
export const categoriesInGroup = (group: ChipGroup) => CATEGORIES.filter((c) => c.group === group).map((c) => c.slug);
export const categoriesInSection = (section: WardrobeSection) => CATEGORIES.filter((c) => c.section === section).map((c) => c.slug);

/** Categories whose items must carry a size (clothing and shoes). */
export const sizeRequired = (slug?: string | null) => (categoryBySlug(slug)?.sizeSystems.length ?? 0) > 0;

export const SIZES = {
  ALPHA: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  SHOE_EU: Array.from({ length: 12 }, (_, i) => String(35 + i)),
  JEANS_W: Array.from({ length: 13 }, (_, i) => `W${26 + i}`),
};

export const CONDITIONS = [
  { value: 'NEW_WITH_TAGS', label: 'Новое с биркой', hint: 'Не носилась' },
  { value: 'LIKE_NEW', label: 'Как новое', hint: 'Носилась 1–3 раза, без следов' },
  { value: 'GOOD', label: 'Хорошее', hint: 'Есть лёгкие следы носки' },
  { value: 'VISIBLE_WEAR', label: 'Заметные следы носки', hint: 'Потёртости, катышки, выцветание' },
];

export const COLORS = [
  { value: 'black', label: 'Чёрный', hex: '#1d1d1f' },
  { value: 'white', label: 'Белый', hex: '#f7f7f5' },
  { value: 'gray', label: 'Серый', hex: '#9a9a9a' },
  { value: 'beige', label: 'Бежевый', hex: '#d9c7a7' },
  { value: 'brown', label: 'Коричневый', hex: '#7a5135' },
  { value: 'red', label: 'Красный', hex: '#c8352e' },
  { value: 'pink', label: 'Розовый', hex: '#e8a3b8' },
  { value: 'orange', label: 'Оранжевый', hex: '#e9822f' },
  { value: 'yellow', label: 'Жёлтый', hex: '#efcd3d' },
  { value: 'green', label: 'Зелёный', hex: '#4c8a52' },
  { value: 'blue', label: 'Синий', hex: '#2f5fa8' },
  { value: 'lightblue', label: 'Голубой', hex: '#8fbbe3' },
  { value: 'purple', label: 'Фиолетовый', hex: '#7d55a8' },
  { value: 'multi', label: 'Разноцветный', hex: 'conic-gradient(#c8352e, #efcd3d, #4c8a52, #2f5fa8, #c8352e)' },
];
export const COLOR_VALUES = COLORS.map((c) => c.value);

export const MATERIALS = ['Хлопок', 'Лён', 'Шерсть', 'Кашемир', 'Шёлк', 'Деним', 'Кожа', 'Экокожа', 'Замша', 'Полиэстер', 'Нейлон', 'Вискоза', 'Трикотаж', 'Другое'];

export const STYLE_TAGS = ['Casual', 'Vintage', 'Sport', 'Streetwear', 'Classic', 'Business', 'Boho', 'Minimal', 'Y2K', 'Outdoor'];

export const CITIES = ['Минск', 'Брест', 'Витебск', 'Гомель', 'Гродно', 'Могилёв', 'Бобруйск', 'Барановичи', 'Борисов', 'Пинск'];

export const TOP_BRANDS = ['Nike', 'Adidas', 'Zara', "Levi's", 'H&M', 'Mango', 'Massimo Dutti', 'COS', 'Uniqlo', 'The North Face', 'New Balance', 'Carhartt'];
