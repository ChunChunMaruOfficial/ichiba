// Catalog reference data (frames 07 SEARCH, 09 WARDROBE, 21 DATA MODEL).
// Served to the web app via GET /meta so both sides share one source.

export type WardrobeSection = 'top' | 'bottom' | 'shoes' | 'accessories';
export type ChipGroup = 'clothing' | 'shoes' | 'accessories' | 'bags';
type SizeSystemKey = 'ALPHA' | 'SHOE_EU' | 'JEANS_W' | 'OTHER';
export type GenderKey = 'FEMALE' | 'MALE';

export interface Category {
  slug: string;
  label: string;
  section: WardrobeSection;
  group: ChipGroup;
  sizeSystems: SizeSystemKey[];
  /** Audiences the category is shown to in the catalogue menu; all when omitted. */
  genders?: GenderKey[];
  subcategories: Array<{ slug: string; label: string }>;
}

const sub = (pairs: string[][]) => pairs.map(([slug, label]) => ({ slug, label }));

export const CATEGORIES: Category[] = [
  {
    slug: 'outerwear', label: 'Верхняя одежда', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['jacket', 'Куртка'], ['leather-jacket', 'Кожаная куртка'], ['denim-jacket', 'Джинсовка'], ['bomber', 'Бомбер'], ['windbreaker', 'Ветровка'], ['parka', 'Парка'], ['coat', 'Пальто'], ['puffer', 'Пуховик'], ['trench', 'Тренч'], ['raincoat', 'Плащ'], ['fur', 'Шуба'], ['sheepskin', 'Дублёнка'], ['vest', 'Жилет']]),
  },
  {
    slug: 'tshirts', label: 'Футболки', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['tshirt', 'Футболка'], ['longsleeve', 'Лонгслив'], ['top', 'Топ'], ['tank', 'Майка'], ['polo', 'Поло']]),
  },
  {
    slug: 'shirts', label: 'Рубашки', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['shirt', 'Рубашка'], ['blouse', 'Блузка'], ['overshirt', 'Овершот'], ['tunic', 'Туника']]),
  },
  {
    slug: 'knitwear', label: 'Свитера и худи', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['sweater', 'Свитер'], ['turtleneck', 'Водолазка'], ['hoodie', 'Худи'], ['zip-hoodie', 'Зип-худи'], ['sweatshirt', 'Свитшот'], ['cardigan', 'Кардиган']]),
  },
  {
    slug: 'trousers', label: 'Брюки', section: 'bottom', group: 'clothing', sizeSystems: ['ALPHA', 'JEANS_W'],
    subcategories: sub([['trousers', 'Брюки'], ['chinos', 'Чиносы'], ['cargo', 'Карго'], ['joggers', 'Джоггеры'], ['sweatpants', 'Спортивные штаны'], ['leggings', 'Леггинсы']]),
  },
  {
    slug: 'jeans', label: 'Джинсы', section: 'bottom', group: 'clothing', sizeSystems: ['JEANS_W', 'ALPHA'],
    subcategories: sub([['straight', 'Прямые'], ['slim', 'Слим'], ['skinny', 'Скинни'], ['wide', 'Широкие'], ['mom', 'Мом'], ['baggy', 'Багги'], ['flare', 'Клёш']]),
  },
  {
    slug: 'shorts', label: 'Шорты', section: 'bottom', group: 'clothing', sizeSystems: ['ALPHA', 'JEANS_W'],
    subcategories: sub([['shorts', 'Шорты'], ['denim-shorts', 'Джинсовые шорты'], ['sport-shorts', 'Спортивные шорты'], ['bermuda', 'Бермуды']]),
  },
  {
    slug: 'skirts', label: 'Юбки', section: 'bottom', group: 'clothing', sizeSystems: ['ALPHA'], genders: ['FEMALE'],
    subcategories: sub([['mini', 'Мини'], ['midi', 'Миди'], ['maxi', 'Макси'], ['pleated', 'Плиссе'], ['pencil', 'Карандаш'], ['denim-skirt', 'Джинсовая юбка']]),
  },
  {
    slug: 'dresses', label: 'Платья', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'], genders: ['FEMALE'],
    subcategories: sub([['dress', 'Платье'], ['evening-dress', 'Вечернее платье'], ['shirt-dress', 'Платье-рубашка'], ['knit-dress', 'Трикотажное платье'], ['sundress', 'Сарафан'], ['jumpsuit', 'Комбинезон']]),
  },
  {
    slug: 'suits', label: 'Костюмы', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['suit', 'Костюм'], ['pantsuit', 'Брючный костюм'], ['blazer', 'Пиджак'], ['tracksuit', 'Спортивный костюм']]),
  },
  {
    slug: 'swimwear', label: 'Купальники и домашнее', section: 'top', group: 'clothing', sizeSystems: ['ALPHA'],
    subcategories: sub([['swimsuit', 'Купальник'], ['swim-trunks', 'Плавки'], ['pajamas', 'Пижама'], ['robe', 'Халат'], ['homewear', 'Домашний костюм']]),
  },
  {
    slug: 'shoes', label: 'Обувь', section: 'shoes', group: 'shoes', sizeSystems: ['SHOE_EU'],
    subcategories: sub([['sneakers', 'Кроссовки'], ['keds', 'Кеды'], ['boots', 'Ботинки'], ['chelsea', 'Челси'], ['high-boots', 'Сапоги'], ['ankle-boots', 'Ботильоны'], ['uggs', 'Угги'], ['shoes', 'Туфли'], ['loafers', 'Лоферы'], ['ballet-flats', 'Балетки'], ['mules', 'Мюли'], ['sandals', 'Сандалии'], ['slides', 'Шлёпанцы']]),
  },
  {
    slug: 'bags', label: 'Сумки', section: 'accessories', group: 'bags', sizeSystems: [],
    subcategories: sub([['handbag', 'Сумка'], ['backpack', 'Рюкзак'], ['tote', 'Шоппер'], ['crossbody', 'Кросс-боди'], ['clutch', 'Клатч'], ['belt-bag', 'Поясная сумка'], ['travel-bag', 'Дорожная сумка'], ['wallet', 'Кошелёк']]),
  },
  {
    slug: 'accessories', label: 'Аксессуары', section: 'accessories', group: 'accessories', sizeSystems: [],
    subcategories: sub([['hat', 'Головной убор'], ['cap', 'Кепка'], ['beanie', 'Шапка'], ['scarf', 'Шарф'], ['gloves', 'Перчатки'], ['belt', 'Ремень'], ['tie', 'Галстук'], ['jewelry', 'Украшения'], ['watch', 'Часы'], ['glasses', 'Очки'], ['hair', 'Для волос'], ['other', 'Другое']]),
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

/** "Для кого": not chosen means the item fits anyone. */
export const GENDERS: Array<{ value: GenderKey; label: string; menu: string }> = [
  { value: 'FEMALE', label: 'Женское', menu: 'Женщинам' },
  { value: 'MALE', label: 'Мужское', menu: 'Мужчинам' },
];

export const CONDITIONS = [
  { value: 'NEW_WITH_TAGS', label: 'Новое', hint: 'Не носилась — с биркой или без' },
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

