/**
 * Telegram shops whose channels are mirrored as seller accounts (the owners agreed). Each channel's history up to
 * `curatedUpTo` was split into items by hand: one post may hold several items (a set, two colours), and one item
 * may be spread over several posts (a drop, then photos on a model). Newer posts are parsed by the AI ensemble.
 *
 * Photos are [postId, index in that post's album]; the first photo's post is the item's home post: when it is
 * deleted from the channel, the listing is removed too. Items never share a photo — the duplicate check would
 * take them for one item. Posts are never quoted with contacts — buyers write here.
 */

export interface CuratedItem {
  photos: Array<[number, number]>;
  title: string;
  category: string;
  subcategory: string;
  brand?: string;
  color?: string;
  /** Sizes on offer (one listing per size, linked); none → «Уточняйте» for clothes and shoes. */
  sizes?: string[];
  /** BYN; none → «Цена договорная». */
  price?: number;
  description?: string;
  gender?: 'MALE' | 'FEMALE';
  material?: string;
}

export interface TgSourceConfig {
  channel: string;
  /** Shown on the profile when the channel has no description. */
  bio: string;
  /** Appended to every listing's description. */
  footer: string;
  /** Brand of the shop's own items (the AI parser fills it for new posts when nothing else is named). */
  ownBrand?: string;
  curatedUpTo: number;
  items: CuratedItem[];
}

const MIRAR_FOOTER = 'MIRARWEAR — свой бренд, ограниченный пошив. Наличие размеров и сроки уточняйте в чате.';
const MIRAR_SIZES = 'Размеры по росту: S — до 175 см, M — до 184 см, L — до 193 см.';
const TEE_CHART = 'Замеры (A — длина, B — ширина, C — рукав), см: XS 57/49/34 · S 59/50/35 · M 60/52/37 · L 62/54/39 · XL 65/56/41.';

const mirar: TgSourceConfig = {
  channel: 'mirarwearfck',
  bio: 'MIRARWEAR — «Оказавшись во тьме — не дай ей завладеть тобой». Свой бренд: ручная работа, плотный хлопок, ограниченный пошив.',
  footer: MIRAR_FOOTER,
  ownBrand: 'MIRARWEAR',
  curatedUpTo: 897,
  items: [
    { photos: [[21, 0], [21, 1], [21, 2], [21, 3]], title: 'Джинсы карго MIRARWEAR CARGO V3', category: 'trousers', subcategory: 'cargo', material: 'Деним', description: 'Джинс 100% хлопок, плотность 520 г. Широкий крой, большие накладные карманы, вышивка на 15 тысяч стежков.' },
    { photos: [[25, 0], [25, 1], [25, 2], [25, 3], [25, 4], [25, 5]], title: 'Зип-худи MIRARWEAR «ECLIPSE»', category: 'knitwear', subcategory: 'zip-hoodie', material: 'Хлопок', description: 'Очень плотный футер, 100% хлопок 480 г. Кроп-фит, низ, капюшон и рукава на завязках, вышивка на 15 тысяч стежков, металлическая фурнитура.' },
    { photos: [[56, 0], [56, 3], [56, 2]], title: 'Зип-худи MIRARWEAR «SAVAGE BLADE»', category: 'knitwear', subcategory: 'zip-hoodie', material: 'Хлопок', description: 'Арафатка на кнопках, швы наружу (distress), 100% хлопок 420 г, объёмный puff-принт, металлическая фурнитура. Серый и белый цвет. В пару — штаны «SAVAGE BLADE».' },
    { photos: [[56, 1], [56, 4], [56, 5]], title: 'Спортивные штаны MIRARWEAR «SAVAGE BLADE»', category: 'trousers', subcategory: 'sweatpants', material: 'Хлопок', description: 'Швы наружу (distress), 100% хлопок 420 г, длинные шнурки, вышивка. Серый и белый цвет. В пару — зип-худи «SAVAGE BLADE».' },
    { photos: [[94, 0], [97, 0], [97, 1], [97, 2]], title: 'Футболка MIRARWEAR «LIPS» oversize', category: 'tshirts', subcategory: 'tshirt', price: 70, material: 'Хлопок', description: 'Оверсайз-футболка с принтом губ, 100% хлопок 250 г. Чёрная и белая.' },
    { photos: [[94, 1], [97, 6], [97, 7]], title: 'Футболка MIRARWEAR «GOD IS WITH US!»', category: 'tshirts', subcategory: 'tshirt', price: 60, material: 'Хлопок', description: 'Футболка регулярного кроя, 100% хлопок 250 г. Чёрная и белая.' },
    { photos: [[94, 2], [97, 3], [97, 4], [97, 5]], title: 'Майка MIRARWEAR «GOD IS WITH US!»', category: 'tshirts', subcategory: 'tank', price: 55, sizes: ['S'], material: 'Хлопок', description: 'Футболка без рукавов, 100% хлопок 250 г. Последний размер — S (рост 160–175 см).' },
    { photos: [[115, 0], [115, 1], [115, 2], [115, 3], [115, 4]], title: 'Футболка MIRARWEAR «PHARMACIST»', category: 'tshirts', subcategory: 'tshirt', price: 65, material: 'Хлопок', description: '100% хлопок 250 г.' },
    { photos: [[135, 0], [135, 1]], title: 'Кепка-тракер MIRARWEAR', category: 'accessories', subcategory: 'cap', price: 50, description: 'Сияет: вышивка, глиттер и стразы.' },
    { photos: [[139, 0], [139, 1], [139, 2], [139, 3], [139, 4]], title: 'Джинсовые шорты MIRARWEAR «CAMOUFLAGE»', category: 'shorts', subcategory: 'denim-shorts', material: 'Деним', description: 'Джинс 100% хлопок, клёпки на карманах для прочности, два боковых кармана на липучках.' },
    { photos: [[186, 0]], title: 'Футболка MIRARWEAR «KILLER SERVICE»', category: 'tshirts', subcategory: 'tshirt', price: 60, material: 'Хлопок', description: 'Остались последние две штуки.' },
    { photos: [[215, 0], [215, 1], [215, 2], [215, 3], [215, 4], [215, 5]], title: 'Сумка на плечо MIRARWEAR «ECHO OF SILENCE»', category: 'bags', subcategory: 'handbag', price: 130, description: 'Ручная работа, цепь для регулировки длины, прочный материал, металлическая фурнитура. Очень вместительная.' },
    { photos: [[227, 0], [227, 1], [227, 2], [227, 3], [423, 0], [423, 1]], title: 'Джинсы MIRARWEAR «WHITE BEAST»', category: 'jeans', subcategory: 'wide', color: 'white', sizes: ['S', 'M', 'L'], material: 'Деним', description: `Плотный джинс 100% хлопок, вместительные основные и боковые карманы, вечная вышивка. ${MIRAR_SIZES}` },
    { photos: [[231, 0], [231, 1], [231, 2], [231, 3]], title: 'Джинсы MIRARWEAR «BASIC»', category: 'jeans', subcategory: 'wide', sizes: ['S', 'M', 'L'], material: 'Деним', description: `Плотный джинс 100% хлопок, вечная вышивка, передняя часть из трёх элементов. ${MIRAR_SIZES}` },
    { photos: [[295, 0], [295, 1], [295, 2], [295, 3], [295, 4], [397, 0], [397, 1], [397, 2]], title: 'Худи MIRARWEAR «ШРАМ»', category: 'knitwear', subcategory: 'hoodie', sizes: ['S', 'M', 'L'], description: 'Вышивка, металлическая фурнитура, плотный материал, лёгкий кроп-фит, длинные рукава. Размеры по росту: S — 158–176 см, M — 177–185 см, L — 186–193 см.' },
    { photos: [[301, 2], [301, 0]], title: 'Шапка MIRARWEAR «BUR» с шипами по шву', category: 'accessories', subcategory: 'beanie', color: 'black', description: 'One size. 90% хлопок, 10% полиэстер. Шипы вдоль шва.' },
    { photos: [[301, 1], [301, 3]], title: 'Шапка MIRARWEAR «BUR» с шипами', category: 'accessories', subcategory: 'beanie', color: 'black', description: 'One size. 90% хлопок, 10% полиэстер. Шипы по всей шапке.' },
    { photos: [[308, 0], [308, 1]], title: 'Спортивные штаны MIRARWEAR белые', category: 'trousers', subcategory: 'sweatpants', color: 'white', sizes: ['S', 'M', 'L'], description: 'Вышивка, утяжки по низу, качественный футер. Размеры по росту: S — 158–175 см, M — 176–184 см, L — 185–193 см.' },
    { photos: [[308, 2], [308, 3]], title: 'Спортивные штаны MIRARWEAR серые (варёные)', category: 'trousers', subcategory: 'sweatpants', color: 'gray', sizes: ['S', 'M', 'L'], description: 'Варёный серый цвет, вышивка, утяжки по низу, качественный футер. Размеры по росту: S — 158–175 см, M — 176–184 см, L — 185–193 см.' },
    { photos: [[325, 0], [325, 1]], title: 'Футболка ТРИСОТНИ x MIRARWEAR «nice to meet you»', category: 'tshirts', subcategory: 'tshirt', description: 'Футер 2-х нитка, 95% хлопок, 5% эластан, 240 г/м², ткань компакт пенье, стразы. Ограниченное количество, под заказ.' },
    { photos: [[780, 0], [780, 1], [780, 2], [454, 0], [454, 1], [465, 0]], title: 'Лонгслив MIRARWEAR с корпусом iPhone', category: 'tshirts', subcategory: 'longsleeve', color: 'white', description: 'Индивидуальный номер, ручная работа, дистресс на выбор, на груди — оригинальный корпус iPhone. Машинная стирка.' },
    { photos: [[482, 0], [482, 1], [482, 2], [482, 3]], title: 'Зип-худи MIRARWEAR «ПУСТЫННЫЙ КЛИНОК»', category: 'knitwear', subcategory: 'zip-hoodie', material: 'Хлопок', description: '100% хлопок 470 г, платок-арафатка на кнопках в комплекте, шелкография с puff-эффектом, бегунок молнии в виде клинка.' },
    { photos: [[561, 1], [565, 1], [565, 2], [565, 0]], title: 'Футболка MIRARWEAR «TWITTER»', category: 'tshirts', subcategory: 'tshirt', sizes: ['XS', 'S', 'M', 'L', 'XL'], material: 'Хлопок', description: `Regular-fit, 100% хлопок, качественный принт. Чёрная и белая. ${TEE_CHART}` },
    { photos: [[561, 2], [565, 4], [565, 5]], title: 'Футболка MIRARWEAR «PILLS»', category: 'tshirts', subcategory: 'tshirt', sizes: ['XS', 'S', 'M', 'L', 'XL'], material: 'Хлопок', description: `Regular-fit, 100% хлопок, качественный принт. Чёрная и белая. ${TEE_CHART}` },
    { photos: [[561, 3], [565, 3]], title: 'Футболка MIRARWEAR «KISS MY ASS»', category: 'tshirts', subcategory: 'tshirt', sizes: ['XS', 'S', 'M', 'L', 'XL'], material: 'Хлопок', description: `Regular-fit, 100% хлопок, качественный принт. Чёрная и белая. ${TEE_CHART}` },
    { photos: [[583, 0], [583, 1], [583, 2], [583, 3], [583, 4], [583, 5]], title: 'Майка MIRARWEAR «GLOCK»', category: 'tshirts', subcategory: 'tank', material: 'Хлопок', description: '100% хлопок, принт и стразы, дистресс по горловине.' },
    { photos: [[589, 0], [589, 1], [589, 2], [589, 3]], title: 'Футболка MIRARWEAR «GLOCK»', category: 'tshirts', subcategory: 'tshirt', material: 'Хлопок', description: '100% хлопок, regular fit, принт и стразы, дистресс по горловине.' },
    { photos: [[602, 0], [602, 1], [602, 2], [602, 3], [602, 4], [611, 0], [611, 1], [611, 2], [611, 3]], title: 'Шорты MIRARWEAR «CAMOUFLAGE» со светящейся вышивкой', category: 'shorts', subcategory: 'shorts', material: 'Хлопок', description: 'Светящаяся вышивка (накапливает свет), 100% хлопок, длина ниже колена.' },
    { photos: [[640, 0], [640, 1], [640, 2], [640, 3], [640, 4], [645, 0], [645, 1]], title: 'Шорты MIRARWEAR «BASIC»', category: 'shorts', subcategory: 'shorts', material: 'Хлопок', description: 'Светящаяся вышивка (накапливает свет), 100% хлопок, длина ниже колена.' },
    { photos: [[651, 0], [651, 1], [651, 2], [651, 3], [651, 4]], title: 'Шорты MIRARWEAR «CAMO-RUIN»', category: 'shorts', subcategory: 'shorts', material: 'Хлопок', description: 'Ручная работа, светящаяся вышивка (накапливает свет), 100% хлопок, длина ниже колена.' },
    { photos: [[679, 0], [679, 1], [679, 2], [679, 3], [679, 4], [679, 5], [679, 6], [679, 7]], title: 'Шорты MIRARWEAR «GLAMOUR»', category: 'shorts', subcategory: 'shorts', material: 'Хлопок', description: 'Светящаяся вышивка (накапливает свет), 100% хлопок, яркая расцветка, длина ниже колена.' },
    { photos: [[699, 0], [699, 1], [699, 2], [699, 3], [699, 4], [766, 0], [766, 1], [766, 2], [766, 3], [766, 4]], title: 'Сумка MIRARWEAR «MRR BAG»', category: 'bags', subcategory: 'handbag', description: 'Ручная работа, очень вместительная, прочный материал, металлическая фурнитура, внутри два кармана. Ограниченный тираж.' },
    { photos: [[759, 0], [759, 1], [759, 2], [736, 0], [736, 1]], title: 'Розовые камуфляжные штаны MIRARWEAR', category: 'trousers', subcategory: 'trousers', color: 'pink', sizes: ['M', 'L'], description: 'Широкие штаны в розовом камуфляже. Осталась пара штук, рестока не будет.' },
    { photos: [[817, 0], [817, 1]], title: 'Чёрные джинсы MIRARWEAR', category: 'jeans', subcategory: 'wide', color: 'black', material: 'Деним', description: 'Обычные чёрные джинсы, пошиты в ограниченном количестве.' },
    { photos: [[822, 0], [822, 1], [822, 2], [822, 3], [822, 4], [831, 0], [831, 1], [831, 2], [831, 3], [831, 4]], title: 'Худи MIRARWEAR «DR*GS»', category: 'knitwear', subcategory: 'hoodie', description: 'Принты на груди, спине и рукавах, металлические заклёпки, наружные швы, «напоминание» на рукаве. Ограниченный пошив.' },
    { photos: [[827, 0], [827, 1], [827, 2], [827, 3], [836, 0], [836, 1], [836, 2], [836, 3], [836, 4], [836, 5]], title: 'Худи MIRARWEAR «NOT FOR €VERY1»', category: 'knitwear', subcategory: 'hoodie', material: 'Хлопок', description: '100% хлопок 450 г, люверсы с кольцами в капюшоне и манжетах, зеркальный принт, металлические заклёпки, наружные швы. Ограниченный пошив.' },
    { photos: [[869, 0], [869, 2], [869, 3], [869, 4], [891, 0], [891, 1], [891, 2]], title: 'Лонгслив MIRARWEAR «УКУС» белый', category: 'tshirts', subcategory: 'longsleeve', color: 'white', material: 'Хлопок', description: 'Ручная работа, 100% плотный хлопок, двойной низ, принты на локтях. Унисекс, очень ограниченное количество.' },
    { photos: [[869, 1], [869, 5], [869, 6], [869, 7], [863, 0], [863, 1], [891, 3], [891, 4], [891, 5]], title: 'Лонгслив MIRARWEAR «УКУС» чёрный', category: 'tshirts', subcategory: 'longsleeve', color: 'black', material: 'Хлопок', description: 'Ручная работа, 100% плотный хлопок, двойной низ, принты на локтях. Унисекс, очень ограниченное количество.' },
  ],
};

/** ne net store: one post — one item, one photo; everything is ordered from China. */
const nn = (post: number, title: string, category: string, subcategory: string, brand?: string, extra: Partial<CuratedItem> = {}): CuratedItem => ({
  photos: [[post, 0]],
  title,
  category,
  subcategory,
  brand,
  ...extra,
});

const nenet: TgSourceConfig = {
  channel: 'nenetstore',
  bio: 'ne net store — помощь в поиске вещей в Китае, под заказ.',
  footer: 'Под заказ из Китая, доставка в среднем 27–30 дней. Размеры и сроки уточняйте в чате.',
  curatedUpTo: 144,
  items: [
    nn(47, 'Зип-худи Balenciaga Polo', 'knitwear', 'zip-hoodie', 'Balenciaga'),
    nn(48, 'Зип-худи Project G/R', 'knitwear', 'zip-hoodie', 'Project G/R'),
    nn(52, 'Олимпийка Balenciaga x Adidas', 'knitwear', 'zip-hoodie', 'Balenciaga', { color: 'black' }),
    nn(53, 'Ботинки Balenciaga Bulldozer', 'shoes', 'boots', 'Balenciaga'),
    nn(54, 'Плиссированная мини-юбка', 'skirts', 'mini', undefined, { color: 'black', gender: 'FEMALE' }),
    nn(56, 'Сумка с бантом и кружевом', 'bags', 'handbag', undefined, { color: 'black' }),
    nn(57, 'Кепка Alice Hollywood с крестом', 'accessories', 'cap', 'Alice Hollywood', { color: 'black' }),
    nn(59, 'Сумка с брелоком Hello Kitty', 'bags', 'handbag', undefined, { color: 'black' }),
    { photos: [[60, 0], [60, 1], [60, 2]], title: 'Брелоки на сумку и ключи', category: 'accessories', subcategory: 'other', price: 24, description: 'Цена за брелок, без учёта доставки.' },
    nn(63, 'Меховая куртка с клетчатым капюшоном', 'outerwear', 'jacket', undefined, { color: 'black' }),
    nn(64, 'Камуфляжные джинсы', 'jeans', 'straight', undefined, { color: 'gray' }),
    nn(65, 'Лонгслив в полоску', 'tshirts', 'longsleeve', undefined, { color: 'gray' }),
    nn(67, 'Худи Vetements Hardcore с цветным принтом', 'knitwear', 'hoodie', 'Vetements', { color: 'black' }),
    nn(68, 'Ботинки Demonia', 'shoes', 'boots', 'Demonia'),
    nn(70, 'Куртка с меховым капюшоном', 'outerwear', 'jacket', undefined, { color: 'black' }),
    nn(71, 'Ботинки на платформе', 'shoes', 'boots', undefined, { color: 'black' }),
    nn(72, 'Джинсы No Faith Studios', 'jeans', 'wide', 'No Faith Studios'),
    nn(73, 'Кепка Alice Hollywood с красным логотипом', 'accessories', 'cap', 'Alice Hollywood', { color: 'black' }),
    nn(74, 'Штаны в стиле Rick Owens Bolan Banana', 'trousers', 'trousers'),
    nn(75, 'Кеды Rick Owens Abstract Low', 'shoes', 'keds', 'Rick Owens'),
    nn(78, 'Сумка с ремнём и заклёпками', 'bags', 'handbag', undefined, { color: 'black' }),
    nn(79, 'Расклешённые джинсы со шнуровкой', 'jeans', 'flare', undefined, { color: 'black' }),
    nn(80, 'Худи Vetements Hardcore', 'knitwear', 'hoodie', 'Vetements', { color: 'black' }),
    nn(81, 'Объёмная куртка с капюшоном', 'outerwear', 'jacket', undefined, { color: 'black' }),
    nn(82, 'Кепка Praying', 'accessories', 'cap', 'Praying'),
    nn(85, 'Худи Project G/R Headliner', 'knitwear', 'hoodie', 'Project G/R'),
    nn(86, 'Худи Praying', 'knitwear', 'hoodie', 'Praying'),
    nn(87, 'Зип-худи Project G/R Certified Freak', 'knitwear', 'zip-hoodie', 'Project G/R'),
    nn(88, 'Футболка Alice Hollywood', 'tshirts', 'tshirt', 'Alice Hollywood'),
    nn(89, 'Худи Vetements Eye of Horus', 'knitwear', 'hoodie', 'Vetements'),
    nn(90, 'Зип-худи Vetements Sexual Fantasies', 'knitwear', 'zip-hoodie', 'Vetements'),
    nn(92, 'Зип-худи Praying', 'knitwear', 'zip-hoodie', 'Praying'),
    nn(93, 'Кеды Isabel Marant', 'shoes', 'keds', 'Isabel Marant'),
    nn(94, 'Ботинки Rick Owens Hiking Boots', 'shoes', 'boots', 'Rick Owens'),
    nn(95, 'Бомбер Vetements Total Darkness', 'outerwear', 'bomber', 'Vetements'),
    nn(96, 'Куртка Balenciaga Paris All In', 'outerwear', 'jacket', 'Balenciaga'),
    nn(97, 'Меховая зип-худи с крестом', 'knitwear', 'zip-hoodie', undefined, { color: 'black' }),
    nn(98, 'Винтажная куртка Project G/R с меховым капюшоном', 'outerwear', 'jacket', 'Project G/R'),
    nn(99, 'Зип-худи ERD', 'knitwear', 'zip-hoodie', 'Enfants Riches Déprimés'),
    nn(100, 'Худи Hysteric Glamour Skull', 'knitwear', 'hoodie', 'Hysteric Glamour'),
    nn(102, 'Зип-худи Vetements Fan', 'knitwear', 'zip-hoodie', 'Vetements'),
    nn(103, 'Бомбер Balenciaga Destroyed', 'outerwear', 'bomber', 'Balenciaga'),
    nn(104, 'Лонгслив Chrome Hearts', 'tshirts', 'longsleeve', 'Chrome Hearts'),
    { photos: [[106, 0], [107, 0], [107, 1]], title: 'Худи Vetements Restricted', category: 'knitwear', subcategory: 'hoodie', brand: 'Vetements', color: 'black' },
    nn(109, 'Худи ERD', 'knitwear', 'hoodie', 'Enfants Riches Déprimés'),
    nn(110, 'Зип-худи Project G/R SCP', 'knitwear', 'zip-hoodie', 'Project G/R'),
    nn(111, 'Лонгслив Project G/R 3 Layered', 'tshirts', 'longsleeve', 'Project G/R'),
    nn(112, 'Зип-худи Vetements Polizei', 'knitwear', 'zip-hoodie', 'Vetements'),
    nn(117, 'Зип-худи Vetements Eleven Inch Gun Club', 'knitwear', 'zip-hoodie', 'Vetements'),
    nn(118, 'Бомбер Project G/R Reworked', 'outerwear', 'bomber', 'Project G/R'),
    nn(119, 'Зип-худи Adidas x Balenciaga', 'knitwear', 'zip-hoodie', 'Balenciaga', { color: 'black' }),
    nn(120, 'Худи Vetements Metal Patched', 'knitwear', 'hoodie', 'Vetements'),
    nn(121, 'Бомбер Vetements Police', 'outerwear', 'bomber', 'Vetements'),
    nn(122, 'Зип-худи Vetements Deconstructed', 'knitwear', 'zip-hoodie', 'Vetements'),
    nn(124, 'Худи Balenciaga Be Different', 'knitwear', 'hoodie', 'Balenciaga'),
    nn(125, 'Брюки карго Balenciaga Flared Cargo', 'trousers', 'cargo', 'Balenciaga'),
    nn(127, 'Джинсы Vetements Distressed', 'jeans', 'straight', 'Vetements'),
    nn(129, 'Брюки Vetements Three Layered Camo', 'trousers', 'trousers', 'Vetements'),
    nn(130, 'Футболка Vetements «Fuck»', 'tshirts', 'tshirt', 'Vetements'),
    nn(132, 'Зип-худи Balenciaga Mud Gaffer', 'knitwear', 'zip-hoodie', 'Balenciaga'),
    nn(136, 'Широкие джинсы Firefighter Buckle', 'jeans', 'wide', undefined, { color: 'blue' }),
    nn(137, 'Спортивные штаны Project G/R 3 Layered', 'trousers', 'sweatpants', 'Project G/R'),
    nn(138, 'Джинсы-клёш Balenciaga 25SS', 'jeans', 'flare', 'Balenciaga'),
    nn(142, 'Зип-худи Cinzia Araia Double Zip', 'knitwear', 'zip-hoodie', 'Cinzia Araia'),
    nn(143, 'Лонгслив No Faith Studios Double Layered Button', 'tshirts', 'longsleeve', 'No Faith Studios'),
    nn(144, 'Джинсы Balenciaga Mud Show Distressed', 'jeans', 'straight', 'Balenciaga'),
  ],
};

export const TG_SOURCES: TgSourceConfig[] = [mirar, nenet];
