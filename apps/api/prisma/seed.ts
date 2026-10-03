/**
 * Dev seed (frame 31 SEED INVENTORY): 12 wardrobes, ~180 items with generated flat-lay photos, plus
 * deals in every status, offers, chats, collections, follows, reports and an admin.
 *
 *   npm run seed            — seeds an empty database
 *   npm run seed -- --reset — wipes all data and photos first
 *
 * All seed accounts use the password `password123` (local development only).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import sharp from 'sharp';
import { PrismaClient, type Condition, type DeliveryMethod, type RequestStatus, type SizeSystem } from '../src/generated/prisma/client.js';
import { COLORS } from '../src/catalog/catalog.js';
import { createStorage, MEDIA_DIR } from '../src/media/storage.js';
import { type Pattern, photoSvg, type Scene, type Shape } from './seed-art.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const storage = createStorage();
const SEED_PASSWORD = 'password123';
const DAY = 24 * 3600 * 1000;
const now = Date.now();

// Deterministic pseudo-random so every reseed looks the same.
let rngState = 42;
const rnd = () => ((rngState = (rngState * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

type G = 'm' | 'f' | 'n' | 'pl';
const ADJ: Record<string, Record<G, string>> = {
  black: { m: 'Чёрный', f: 'Чёрная', n: 'Чёрное', pl: 'Чёрные' },
  white: { m: 'Белый', f: 'Белая', n: 'Белое', pl: 'Белые' },
  gray: { m: 'Серый', f: 'Серая', n: 'Серое', pl: 'Серые' },
  beige: { m: 'Бежевый', f: 'Бежевая', n: 'Бежевое', pl: 'Бежевые' },
  brown: { m: 'Коричневый', f: 'Коричневая', n: 'Коричневое', pl: 'Коричневые' },
  red: { m: 'Красный', f: 'Красная', n: 'Красное', pl: 'Красные' },
  pink: { m: 'Розовый', f: 'Розовая', n: 'Розовое', pl: 'Розовые' },
  orange: { m: 'Оранжевый', f: 'Оранжевая', n: 'Оранжевое', pl: 'Оранжевые' },
  yellow: { m: 'Жёлтый', f: 'Жёлтая', n: 'Жёлтое', pl: 'Жёлтые' },
  green: { m: 'Зелёный', f: 'Зелёная', n: 'Зелёное', pl: 'Зелёные' },
  blue: { m: 'Синий', f: 'Синяя', n: 'Синее', pl: 'Синие' },
  lightblue: { m: 'Голубой', f: 'Голубая', n: 'Голубое', pl: 'Голубые' },
  purple: { m: 'Фиолетовый', f: 'Фиолетовая', n: 'Фиолетовое', pl: 'Фиолетовые' },
};

interface Template {
  category: string;
  subcategory: string;
  label: string;
  g: G;
  shape: Shape;
  sizes?: [SizeSystem, string[]];
  price: [number, number];
  colors: string[];
  brands: string[];
  materials?: string[];
  patterns?: Pattern[];
  gender?: Array<'MALE' | 'FEMALE' | 'UNISEX'>;
  tags: string[];
  weight: number;
}

const ALPHA = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SHOES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];
const JEANS = ['W26', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33', 'W34', 'W36'];

const TEMPLATES: Template[] = [
  { category: 'outerwear', subcategory: 'jacket', label: 'куртка', g: 'f', shape: 'jacket', sizes: ['ALPHA', ALPHA], price: [60, 220], colors: ['black', 'green', 'blue', 'beige', 'brown'], brands: ['Carhartt', 'Zara', 'The North Face', 'Levi\'s', ''], gender: ['MALE', 'UNISEX'], tags: ['Streetwear', 'Casual', 'Outdoor'], weight: 3 },
  { category: 'outerwear', subcategory: 'leather-jacket', label: 'кожаная куртка', g: 'f', shape: 'jacket', sizes: ['ALPHA', ALPHA], price: [90, 260], colors: ['black', 'brown'], brands: ['Zara', 'Mango', 'Massimo Dutti', ''], materials: ['Кожа', 'Экокожа'], gender: ['FEMALE', 'MALE'], tags: ['Casual', 'Classic'], weight: 2 },
  { category: 'outerwear', subcategory: 'coat', label: 'пальто', g: 'n', shape: 'coat', sizes: ['ALPHA', ALPHA], price: [110, 320], colors: ['beige', 'gray', 'black', 'brown'], brands: ['COS', 'Massimo Dutti', 'Mango', ''], materials: ['Шерсть'], gender: ['FEMALE', 'MALE'], tags: ['Classic', 'Minimal'], weight: 2 },
  { category: 'outerwear', subcategory: 'puffer', label: 'пуховик', g: 'm', shape: 'puffer', sizes: ['ALPHA', ALPHA], price: [90, 280], colors: ['black', 'red', 'blue', 'beige', 'green'], brands: ['The North Face', 'Uniqlo', 'Adidas', ''], patterns: ['solid'], gender: ['UNISEX'], tags: ['Outdoor', 'Sport'], weight: 2 },
  { category: 'outerwear', subcategory: 'trench', label: 'тренч', g: 'm', shape: 'coat', sizes: ['ALPHA', ALPHA], price: [90, 240], colors: ['beige', 'black'], brands: ['Massimo Dutti', 'Zara', ''], gender: ['FEMALE'], tags: ['Classic'], weight: 1 },
  { category: 'outerwear', subcategory: 'vest', label: 'жилет', g: 'm', shape: 'vest', sizes: ['ALPHA', ALPHA], price: [30, 90], colors: ['black', 'green', 'beige'], brands: ['Uniqlo', 'Carhartt', ''], patterns: ['quilt', 'solid'], gender: ['UNISEX'], tags: ['Outdoor'], weight: 1 },
  { category: 'tshirts', subcategory: 'tshirt', label: 'футболка', g: 'f', shape: 'tshirt', sizes: ['ALPHA', ALPHA], price: [10, 45], colors: ['white', 'black', 'gray', 'pink', 'yellow', 'green', 'blue'], brands: ['Nike', 'COS', 'H&M', 'Uniqlo', 'Adidas', ''], materials: ['Хлопок'], patterns: ['solid', 'solid', 'stripes'], gender: ['UNISEX'], tags: ['Casual', 'Minimal', 'Sport'], weight: 5 },
  { category: 'tshirts', subcategory: 'longsleeve', label: 'лонгслив', g: 'm', shape: 'longsleeve', sizes: ['ALPHA', ALPHA], price: [15, 50], colors: ['white', 'black', 'gray', 'beige'], brands: ['Uniqlo', 'COS', ''], patterns: ['solid', 'stripes'], gender: ['UNISEX'], tags: ['Casual', 'Minimal'], weight: 2 },
  { category: 'tshirts', subcategory: 'tank', label: 'майка', g: 'f', shape: 'tank', sizes: ['ALPHA', ALPHA], price: [8, 25], colors: ['white', 'black', 'pink'], brands: ['H&M', 'Zara', ''], gender: ['FEMALE'], tags: ['Casual', 'Y2K'], weight: 1 },
  { category: 'shirts', subcategory: 'shirt', label: 'рубашка', g: 'f', shape: 'shirt', sizes: ['ALPHA', ALPHA], price: [25, 80], colors: ['lightblue', 'white', 'red', 'green', 'beige'], brands: ['Massimo Dutti', 'Uniqlo', 'Levi\'s', ''], materials: ['Хлопок', 'Лён'], patterns: ['solid', 'check', 'stripes'], gender: ['MALE'], tags: ['Business', 'Casual', 'Vintage'], weight: 3 },
  { category: 'shirts', subcategory: 'blouse', label: 'блузка', g: 'f', shape: 'shirt', sizes: ['ALPHA', ALPHA], price: [20, 70], colors: ['white', 'pink', 'beige', 'lightblue'], brands: ['Mango', 'Zara', 'COS', ''], materials: ['Вискоза', 'Шёлк'], gender: ['FEMALE'], tags: ['Classic', 'Boho'], weight: 2 },
  { category: 'knitwear', subcategory: 'sweater', label: 'свитер', g: 'm', shape: 'sweater', sizes: ['ALPHA', ALPHA], price: [30, 120], colors: ['beige', 'gray', 'brown', 'green', 'white'], brands: ['COS', 'Massimo Dutti', 'Uniqlo', ''], materials: ['Шерсть', 'Кашемир', 'Трикотаж'], patterns: ['knit'], gender: ['UNISEX'], tags: ['Minimal', 'Classic'], weight: 3 },
  { category: 'knitwear', subcategory: 'hoodie', label: 'худи', g: 'n', shape: 'hoodie', sizes: ['ALPHA', ALPHA], price: [35, 110], colors: ['gray', 'black', 'purple', 'green', 'beige'], brands: ['Nike', 'Adidas', 'Carhartt', ''], gender: ['UNISEX'], tags: ['Streetwear', 'Sport'], weight: 3 },
  { category: 'knitwear', subcategory: 'sweatshirt', label: 'свитшот', g: 'm', shape: 'sweater', sizes: ['ALPHA', ALPHA], price: [25, 80], colors: ['gray', 'orange', 'blue', 'white'], brands: ['Nike', 'H&M', ''], gender: ['UNISEX'], tags: ['Casual', 'Y2K'], weight: 2 },
  { category: 'knitwear', subcategory: 'cardigan', label: 'кардиган', g: 'm', shape: 'shirt', sizes: ['ALPHA', ALPHA], price: [30, 90], colors: ['beige', 'gray', 'pink'], brands: ['Mango', 'COS', ''], patterns: ['knit'], gender: ['FEMALE'], tags: ['Boho', 'Vintage'], weight: 1 },
  { category: 'jeans', subcategory: 'straight', label: 'прямые джинсы', g: 'pl', shape: 'jeans', sizes: ['JEANS_W', JEANS], price: [40, 120], colors: ['blue', 'lightblue', 'black'], brands: ['Levi\'s', 'Zara', 'Uniqlo', ''], materials: ['Деним'], patterns: ['denim'], gender: ['MALE', 'FEMALE'], tags: ['Casual', 'Vintage'], weight: 3 },
  { category: 'jeans', subcategory: 'wide', label: 'широкие джинсы', g: 'pl', shape: 'jeans', sizes: ['JEANS_W', JEANS], price: [35, 100], colors: ['lightblue', 'blue'], brands: ['Zara', 'H&M', 'Levi\'s', ''], materials: ['Деним'], patterns: ['denim'], gender: ['FEMALE'], tags: ['Y2K', 'Streetwear'], weight: 2 },
  { category: 'jeans', subcategory: 'skinny', label: 'джинсы скинни', g: 'pl', shape: 'jeans', sizes: ['JEANS_W', JEANS], price: [25, 80], colors: ['black', 'blue'], brands: ['Levi\'s', 'Mango', ''], materials: ['Деним'], patterns: ['denim'], gender: ['FEMALE'], tags: ['Casual'], weight: 1 },
  { category: 'trousers', subcategory: 'trousers', label: 'брюки', g: 'pl', shape: 'trousers', sizes: ['ALPHA', ALPHA], price: [30, 110], colors: ['gray', 'black', 'beige', 'brown'], brands: ['COS', 'Massimo Dutti', 'Zara', ''], materials: ['Шерсть', 'Вискоза'], gender: ['FEMALE', 'MALE'], tags: ['Business', 'Minimal'], weight: 2 },
  { category: 'trousers', subcategory: 'cargo', label: 'брюки карго', g: 'pl', shape: 'trousers', sizes: ['ALPHA', ALPHA], price: [30, 90], colors: ['beige', 'green', 'black'], brands: ['Carhartt', 'H&M', ''], gender: ['UNISEX'], tags: ['Streetwear'], weight: 2 },
  { category: 'trousers', subcategory: 'joggers', label: 'джоггеры', g: 'pl', shape: 'trousers', sizes: ['ALPHA', ALPHA], price: [20, 70], colors: ['gray', 'black', 'green'], brands: ['Nike', 'Adidas', ''], gender: ['UNISEX'], tags: ['Sport'], weight: 1 },
  { category: 'shorts', subcategory: 'shorts', label: 'шорты', g: 'pl', shape: 'shorts', sizes: ['ALPHA', ALPHA], price: [12, 45], colors: ['beige', 'black', 'blue', 'green'], brands: ['Nike', 'Uniqlo', 'H&M', ''], gender: ['UNISEX'], tags: ['Casual', 'Sport'], weight: 1 },
  { category: 'skirts', subcategory: 'midi', label: 'юбка миди', g: 'f', shape: 'skirt', sizes: ['ALPHA', ALPHA], price: [20, 80], colors: ['black', 'beige', 'green', 'brown'], brands: ['Mango', 'COS', 'Zara', ''], patterns: ['solid', 'check'], gender: ['FEMALE'], tags: ['Classic', 'Boho'], weight: 2 },
  { category: 'skirts', subcategory: 'mini', label: 'юбка мини', g: 'f', shape: 'skirt', sizes: ['ALPHA', ALPHA], price: [15, 50], colors: ['red', 'black', 'pink', 'blue'], brands: ['Zara', 'H&M', ''], patterns: ['solid', 'denim'], gender: ['FEMALE'], tags: ['Y2K'], weight: 1 },
  { category: 'dresses', subcategory: 'dress', label: 'платье', g: 'n', shape: 'dress', sizes: ['ALPHA', ALPHA], price: [25, 140], colors: ['black', 'green', 'lightblue', 'red', 'beige', 'pink'], brands: ['Zara', 'Mango', 'COS', 'H&M', ''], materials: ['Вискоза', 'Хлопок', 'Лён'], patterns: ['solid', 'solid', 'stripes'], gender: ['FEMALE'], tags: ['Boho', 'Classic', 'Minimal'], weight: 4 },
  { category: 'dresses', subcategory: 'jumpsuit', label: 'комбинезон', g: 'm', shape: 'jumpsuit', sizes: ['ALPHA', ALPHA], price: [30, 90], colors: ['black', 'blue', 'beige'], brands: ['Mango', 'Levi\'s', ''], patterns: ['solid', 'denim'], gender: ['FEMALE'], tags: ['Casual'], weight: 1 },
  { category: 'suits', subcategory: 'blazer', label: 'пиджак', g: 'm', shape: 'blazer', sizes: ['ALPHA', ALPHA], price: [50, 180], colors: ['black', 'gray', 'beige', 'blue'], brands: ['Massimo Dutti', 'Zara', 'COS', ''], materials: ['Шерсть'], patterns: ['solid', 'check'], gender: ['MALE', 'FEMALE'], tags: ['Business', 'Classic'], weight: 2 },
  { category: 'shoes', subcategory: 'sneakers', label: 'кроссовки', g: 'pl', shape: 'sneaker', sizes: ['SHOE_EU', SHOES], price: [50, 190], colors: ['white', 'black', 'gray', 'beige', 'blue'], brands: ['Nike', 'Adidas', 'New Balance', ''], gender: ['UNISEX'], tags: ['Streetwear', 'Sport', 'Casual'], weight: 5 },
  { category: 'shoes', subcategory: 'boots', label: 'ботинки', g: 'pl', shape: 'boot', sizes: ['SHOE_EU', SHOES], price: [60, 200], colors: ['brown', 'black', 'beige'], brands: ['Timberland', 'Dr. Martens', ''], materials: ['Кожа', 'Замша'], gender: ['UNISEX'], tags: ['Outdoor', 'Classic'], weight: 3 },
  { category: 'shoes', subcategory: 'loafers', label: 'лоферы', g: 'pl', shape: 'loafer', sizes: ['SHOE_EU', SHOES], price: [40, 140], colors: ['black', 'brown'], brands: ['Massimo Dutti', 'Zara', ''], materials: ['Кожа'], gender: ['UNISEX'], tags: ['Classic', 'Business'], weight: 1 },
  { category: 'shoes', subcategory: 'sandals', label: 'сандалии', g: 'pl', shape: 'sandal', sizes: ['SHOE_EU', SHOES], price: [20, 70], colors: ['black', 'brown', 'beige'], brands: ['Birkenstock', ''], gender: ['UNISEX'], tags: ['Casual'], weight: 1 },
  { category: 'bags', subcategory: 'handbag', label: 'сумка', g: 'f', shape: 'bag', price: [30, 160], colors: ['black', 'brown', 'beige', 'red'], brands: ['Mango', 'Zara', 'Coach', ''], materials: ['Кожа', 'Экокожа'], gender: ['FEMALE'], tags: ['Classic'], weight: 3 },
  { category: 'bags', subcategory: 'backpack', label: 'рюкзак', g: 'm', shape: 'backpack', price: [25, 110], colors: ['black', 'blue', 'green', 'gray'], brands: ['The North Face', 'Herschel', 'Nike', ''], gender: ['UNISEX'], tags: ['Outdoor', 'Casual'], weight: 2 },
  { category: 'bags', subcategory: 'tote', label: 'шоппер', g: 'm', shape: 'tote', price: [8, 40], colors: ['beige', 'white', 'black'], brands: ['COS', ''], materials: ['Хлопок'], gender: ['UNISEX'], tags: ['Minimal'], weight: 1 },
  { category: 'accessories', subcategory: 'hat', label: 'кепка', g: 'f', shape: 'cap', price: [8, 40], colors: ['black', 'beige', 'blue', 'red', 'green'], brands: ['Carhartt', 'Nike', 'New Era', ''], gender: ['UNISEX'], tags: ['Streetwear'], weight: 2 },
  { category: 'accessories', subcategory: 'scarf', label: 'шарф', g: 'm', shape: 'scarf', price: [10, 60], colors: ['gray', 'beige', 'red', 'brown'], brands: ['COS', ''], materials: ['Шерсть', 'Кашемир'], patterns: ['knit', 'check', 'solid'], gender: ['UNISEX'], tags: ['Classic'], weight: 1 },
  { category: 'accessories', subcategory: 'belt', label: 'ремень', g: 'm', shape: 'belt', price: [10, 50], colors: ['black', 'brown'], brands: ['Levi\'s', ''], materials: ['Кожа'], gender: ['UNISEX'], tags: ['Classic'], weight: 1 },
];

const SELLERS = [
  { username: 'alex', city: 'Минск', bio: 'Разбираю шкаф: в основном streetwear и обувь 42–43.', style: ['Streetwear', 'Sport'] },
  { username: 'kate', city: 'Минск', bio: 'Платья, юбки и всё, что надела пару раз.', style: ['Boho', 'Classic'] },
  { username: 'mike', city: 'Гродно', bio: '', style: ['Casual', 'Outdoor'] },
  { username: 'vintage_by', city: 'Минск', bio: 'Винтаж и секонд из Европы. Отвечаю быстро.', style: ['Vintage'] },
  { username: 'olga_mnsk', city: 'Минск', bio: 'Классика и офис. Всё в отличном состоянии.', style: ['Business', 'Classic', 'Minimal'] },
  { username: 'den', city: 'Брест', bio: 'Спорт и outdoor.', style: ['Sport', 'Outdoor'] },
  { username: 'marina_k', city: 'Гомель', bio: 'Мама двоих — разгружаю гардероб без жалости.', style: ['Casual', 'Boho'] },
  { username: 'stylist_anna', city: 'Минск', bio: 'Стилист. Кураторский гардероб: базовые вещи хорошего качества.', style: ['Minimal', 'Classic'] },
  { username: 'sneakerhead', city: 'Минск', bio: 'Кроссовки 41–44. Оригиналы, есть чеки на многие пары.', style: ['Streetwear', 'Sport'] },
  { username: 'lena_v', city: 'Витебск', bio: 'Y2K, яркие цвета и немного винтажа.', style: ['Y2K', 'Vintage'] },
  { username: 'pavel', city: 'Могилёв', bio: '', style: ['Business', 'Casual'] },
  { username: 'secondhand_hub', city: 'Минск', bio: 'Комиссионка онлайн. Принимаем вещи на продажу.', style: ['Vintage', 'Casual', 'Classic'] },
];

const BUYERS = ['buyer', 'nastya', 'igor', 'sveta'];
const DELIVERY_SETS: DeliveryMethod[][] = [['IN_PERSON'], ['IN_PERSON', 'DELIVERY'], ['IN_PERSON', 'PICKUP', 'DELIVERY'], ['DELIVERY'], ['IN_PERSON', 'PICKUP']];
const SCENES: Scene[] = ['bed', 'bed', 'floor', 'wall', 'wall', 'blanket', 'studio'];
const DEFECTS = ['Небольшая затяжка на рукаве', 'Потёртости на манжетах', 'Катышки на боках', 'Маленькое пятнышко внизу, почти незаметно', 'Заломы на носке', 'Потёртости на подошве', 'Не хватает одной пуговицы'];
const CONDITION_TEXT: Record<Condition, string> = {
  NEW_WITH_TAGS: 'Новая, с биркой — не подошёл размер.',
  LIKE_NEW: 'Носилась пару раз, без следов.',
  GOOD: 'В хорошем состоянии, есть лёгкие следы носки.',
  VISIBLE_WEAR: 'Есть заметные следы носки, цена с учётом этого.',
};
const FIT_TEXT = ['Сидит свободно.', 'Посадка по размеру.', 'Маломерит на полразмера.', 'Оверсайз, подойдёт и на размер больше.', 'Ткань приятная, не колется.', 'Отдам быстро, если заберёте на этой неделе.'];

const TOTAL_ITEMS = 180;

async function reset() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  if (process.env.MEDIA_DRIVER !== 's3') await rm(MEDIA_DIR, { recursive: true, force: true });
  console.log('Database and local photos wiped.');
}

async function makePhoto(ownerId: string, shape: Shape, colorHex: string, scene: Scene, pattern: Pattern, seed: number) {
  const square = ['sneaker', 'boot', 'loafer', 'sandal', 'bag', 'cap', 'belt', 'tote'].includes(shape);
  const [w, h] = square ? [1200, 1200] : seed % 5 === 0 ? [1200, 1500] : [1200, 1600];
  const png = await sharp(Buffer.from(photoSvg({ shape, color: colorHex, scene, pattern, w, h, seed }))).png().toBuffer();
  const key = `${ownerId}/${randomUUID()}`;
  for (const variant of [320, 640, 1280]) {
    await storage.put(`${key}_${variant}.webp`, await sharp(png).resize({ width: variant }).webp({ quality: 80 }).toBuffer(), 'image/webp');
  }
  return { key, width: w, height: h };
}

function weightedTemplate(style: string[]) {
  const pool = TEMPLATES.flatMap((t) => Array(t.weight * (t.tags.some((tag) => style.includes(tag)) ? 3 : 1)).fill(t) as Template[]);
  return pick(pool);
}

async function main() {
  if (process.argv.includes('--reset')) await reset();
  const existing = await prisma.listing.count();
  if (existing > 0) {
    console.log(`Seed skipped: database already has ${existing} listings. Run with --reset to start over.`);
    return;
  }
  await storage.init();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ---------- users ----------
  const sellers = [];
  for (const [i, s] of SELLERS.entries()) {
    sellers.push({
      ...(await prisma.user.create({
        data: {
          username: s.username,
          email: `${s.username}@ichiba.test`,
          emailVerifiedAt: new Date(),
          phone: `+3752900000${String(i).padStart(2, '0')}`,
          phoneVerifiedAt: new Date(),
          passwordHash,
          city: s.city,
          bio: s.bio || null,
          onboardedAt: new Date(),
          createdAt: new Date(now - (300 - i * 20) * DAY),
        },
      })),
      style: s.style,
    });
  }
  const buyers = [];
  for (const [i, b] of BUYERS.entries()) {
    buyers.push(
      await prisma.user.create({
        data: { username: b, email: `${b}@ichiba.test`, emailVerifiedAt: new Date(), phone: `+3753300000${i}`, phoneVerifiedAt: new Date(), passwordHash, city: 'Минск', onboardedAt: new Date(), createdAt: new Date(now - (60 - i * 10) * DAY) },
      }),
    );
  }
  await prisma.user.create({ data: { username: 'admin', email: 'admin@ichiba.test', emailVerifiedAt: new Date(), passwordHash, role: 'ADMIN', onboardedAt: new Date() } });
  const buyer = buyers[0];

  // ---------- listings ----------
  const listings: Awaited<ReturnType<typeof prisma.listing.create>>[] = [];
  for (let i = 0; i < TOTAL_ITEMS; i++) {
    const seller = sellers[i % sellers.length];
    const t = weightedTemplate(seller.style);
    const colorKey = pick(t.colors);
    const hex = COLORS.find((c) => c.value === colorKey)!.hex;
    const brand = pick(t.brands);
    const pattern = pick(t.patterns ?? ['solid']);
    const condition = pick<Condition>(['NEW_WITH_TAGS', 'LIKE_NEW', 'LIKE_NEW', 'GOOD', 'GOOD', 'GOOD', 'VISIBLE_WEAR']);
    const hasDefect = condition === 'VISIBLE_WEAR' || (condition === 'GOOD' && rnd() < 0.25);
    const defect = hasDefect ? pick(DEFECTS) : null;
    const size = t.sizes ? pick(t.sizes[1]) : null;
    const patternWord = pattern === 'stripes' ? ' в полоску' : pattern === 'check' ? ' в клетку' : '';
    const title = `${ADJ[colorKey][t.g]} ${t.label}${patternWord}${brand ? ` ${brand}` : ''}`.slice(0, 80);
    const basePrice = between(t.price[0], t.price[1]);
    const price = Math.max(5, Math.round((basePrice * (condition === 'NEW_WITH_TAGS' ? 1.15 : condition === 'VISIBLE_WEAR' ? 0.6 : 1)) / 5) * 5);
    const scene = pick(SCENES);
    const photoCount = 1 + Math.floor(rnd() * 3);
    const photos = [];
    for (let p = 0; p < photoCount; p++) photos.push(await makePhoto(seller.id, t.shape, hex, p === 0 ? scene : pick(SCENES), pattern, i * 7 + p));

    // Most items fresh-ish; a few today so "Новинки · сегодня" is non-empty.
    const ageDays = i % 9 === 0 ? rnd() * 0.5 : rnd() * 40;
    const publishedAt = new Date(now - ageDays * DAY);
    const discounted = rnd() < 0.12;
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        status: 'PUBLISHED',
        title,
        category: t.category,
        subcategory: t.subcategory,
        sizeSystem: t.sizes?.[0] ?? null,
        sizeValue: size,
        condition,
        price,
        previousPrice: discounted ? price + between(2, 6) * 5 : null,
        defectsPresent: hasDefect,
        defectsDescription: defect,
        brand: brand || null,
        color: colorKey,
        material: t.materials ? pick(t.materials) : null,
        measurements: t.sizes?.[0] === 'ALPHA' && rnd() < 0.5 ? { chest: between(48, 62), length: between(62, 78), shoulders: between(40, 52) } : undefined,
        description: [`${title}${size ? `, размер ${size}` : ''}.`, CONDITION_TEXT[condition], defect ? `${defect}.` : '', pick(FIT_TEXT)].filter(Boolean).join(' '),
        city: seller.city,
        deliveryOptions: pick(DELIVERY_SETS),
        acceptsOffers: rnd() < 0.8,
        minOfferPrice: rnd() < 0.3 ? Math.round(price * 0.7) : null,
        gender: t.gender ? pick(t.gender) : null,
        styleTags: [pick(t.tags)],
        viewsCount: between(3, 320),
        publishedAt,
        createdAt: publishedAt,
        photos: {
          create: photos.map((ph, order) => ({ ownerId: seller.id, key: ph.key, width: ph.width, height: ph.height, order, isCover: order === 0, isDefect: hasDefect && order === photoCount - 1 && order > 0 })),
        },
      },
    });
    listings.push(listing);
    if (i % 10 === 0) process.stdout.write(`${i}…`);
  }
  console.log();

  // ---------- statuses: sold, hidden, drafts ----------
  const bySeller = (username: string) => listings.filter((l) => l.sellerId === sellers.find((s) => s.username === username)!.id);
  for (const l of listings.filter((_, i) => i % 11 === 5).slice(0, 14)) {
    await prisma.listing.update({ where: { id: l.id }, data: { status: 'SOLD', soldAt: new Date(now - between(1, 20) * DAY) } });
  }
  await prisma.listing.update({ where: { id: bySeller('alex')[1].id }, data: { status: 'HIDDEN' } });
  await prisma.listing.update({ where: { id: bySeller('alex')[2].id }, data: { status: 'DRAFT', publishedAt: null } });
  await prisma.listing.update({ where: { id: bySeller('kate')[2].id }, data: { status: 'BLOCKED', blockedReason: 'Похоже на копию бренда — пришлите фото бирки' } });
  const fresh = await prisma.listing.findMany({ where: { id: { in: listings.map((l) => l.id) } } });
  const available = fresh.filter((l) => l.status === 'PUBLISHED');

  // ---------- favorites, follows, signals ----------
  for (const u of buyers) {
    const favs = available.filter(() => rnd() < 0.08);
    for (const l of favs) {
      if (l.sellerId === u.id) continue;
      await prisma.favorite.create({ data: { userId: u.id, listingId: l.id, source: pick(['feed', 'product', 'swipe']) } });
      await prisma.signal.create({ data: { userId: u.id, listingId: l.id, type: 'favorite', weight: 5 } });
    }
    for (const l of available.filter(() => rnd() < 0.12)) await prisma.signal.create({ data: { userId: u.id, listingId: l.id, type: 'view', weight: 1, createdAt: new Date(now - rnd() * 6 * DAY) } });
    for (const s of sellers.filter(() => rnd() < 0.35)) await prisma.follow.create({ data: { followerId: u.id, sellerId: s.id } }).catch(() => {});
  }
  // Sellers follow each other a bit too, so wardrobes have follower counts.
  for (const a of sellers) for (const b of sellers) if (a.id !== b.id && rnd() < 0.2) await prisma.follow.create({ data: { followerId: a.id, sellerId: b.id } }).catch(() => {});
  const favCounts = await prisma.favorite.groupBy({ by: ['listingId'], _count: true });
  for (const f of favCounts) await prisma.listing.update({ where: { id: f.listingId }, data: { favoritesCount: f._count } });

  // ---------- collections ----------
  const buyerFavs = await prisma.favorite.findMany({ where: { userId: buyer.id }, select: { listingId: true } });
  for (const [name, share] of [['Осень', 0.5], ['На работу', 0.3]] as const) {
    const c = await prisma.collection.create({ data: { userId: buyer.id, name } });
    for (const f of buyerFavs.filter(() => rnd() < share)) await prisma.collectionItem.create({ data: { collectionId: c.id, listingId: f.listingId } });
  }

  // ---------- cart ----------
  const alexItems = available.filter((l) => l.sellerId === sellers[0].id).slice(3, 5);
  const kateItem = available.find((l) => l.sellerId === sellers[1].id && !alexItems.includes(l));
  for (const l of [...alexItems, ...(kateItem ? [kateItem] : [])]) await prisma.cartItem.create({ data: { userId: buyer.id, listingId: l.id } });

  // ---------- deals in every status ----------
  const used = new Set([...alexItems.map((l) => l.id), kateItem?.id]);
  const nextItem = (sellerIdx: number) => {
    const l = available.find((x) => x.sellerId === sellers[sellerIdx].id && !used.has(x.id));
    if (l) used.add(l.id);
    return l;
  };
  const dealSpecs: Array<{ seller: number; buyer: number; status: RequestStatus; daysAgo: number; method?: DeliveryMethod }> = [
    { seller: 0, buyer: 0, status: 'PENDING_SELLER', daysAgo: 0.2 },
    { seller: 0, buyer: 1, status: 'PENDING_SELLER', daysAgo: 1.1 },
    { seller: 0, buyer: 2, status: 'WAITING_HANDOVER', daysAgo: 2 },
    { seller: 1, buyer: 0, status: 'WAITING_HANDOVER', daysAgo: 1, method: 'IN_PERSON' },
    { seller: 2, buyer: 0, status: 'IN_TRANSIT', daysAgo: 3, method: 'DELIVERY' },
    { seller: 3, buyer: 0, status: 'COMPLETED', daysAgo: 9 },
    { seller: 4, buyer: 0, status: 'COMPLETED', daysAgo: 15 },
    { seller: 5, buyer: 0, status: 'DECLINED', daysAgo: 6 },
    { seller: 0, buyer: 3, status: 'COMPLETED', daysAgo: 4 },
    { seller: 6, buyer: 1, status: 'COMPLETED', daysAgo: 2 },
    { seller: 8, buyer: 2, status: 'COMPLETED', daysAgo: 5 },
  ];
  const flow: Record<string, RequestStatus[]> = {
    PENDING_SELLER: ['CREATED', 'PENDING_SELLER'],
    WAITING_HANDOVER: ['CREATED', 'PENDING_SELLER', 'ACCEPTED', 'WAITING_HANDOVER'],
    IN_TRANSIT: ['CREATED', 'PENDING_SELLER', 'ACCEPTED', 'WAITING_HANDOVER', 'IN_TRANSIT'],
    COMPLETED: ['CREATED', 'PENDING_SELLER', 'ACCEPTED', 'WAITING_HANDOVER', 'HANDED_OVER', 'RECEIVED', 'COMPLETED'],
    DECLINED: ['CREATED', 'PENDING_SELLER', 'DECLINED'],
  };
  for (const d of dealSpecs) {
    const l = nextItem(d.seller);
    if (!l || !l.price) continue;
    const u = buyers[d.buyer];
    const created = now - d.daysAgo * DAY;
    const method = d.method ?? (l.deliveryOptions.includes('IN_PERSON') ? 'IN_PERSON' : l.deliveryOptions[0]);
    const r = await prisma.buyRequest.create({
      data: {
        buyerId: u.id,
        sellerId: l.sellerId,
        priceTotal: l.price,
        deliveryMethod: method,
        deliveryPoint: method === 'DELIVERY' ? 'Минск, постамат на ул. Притыцкого, 29' : null,
        trackingNumber: d.status === 'IN_TRANSIT' ? 'BY123456789' : null,
        buyerComment: rnd() < 0.5 ? 'Могу забрать сегодня после 18:00' : null,
        status: d.status,
        reason: d.status === 'DECLINED' ? 'Уже продано' : null,
        expiresAt: d.status === 'PENDING_SELLER' ? new Date(created + 48 * 3600 * 1000) : null,
        handedOverAt: ['IN_TRANSIT', 'COMPLETED'].includes(d.status) ? new Date(created + 0.5 * DAY) : null,
        completedAt: d.status === 'COMPLETED' ? new Date(created + DAY) : null,
        createdAt: new Date(created),
        items: { create: [{ listingId: l.id, price: l.price }] },
        events: { create: flow[d.status].map((s, k) => ({ status: s, at: new Date(created + k * 3 * 3600 * 1000), byUserId: ['CREATED', 'PENDING_SELLER', 'RECEIVED'].includes(s) ? u.id : l.sellerId })) },
      },
    });
    if (['WAITING_HANDOVER', 'IN_TRANSIT'].includes(d.status)) await prisma.listing.update({ where: { id: l.id }, data: { status: 'RESERVED' } });
    if (d.status === 'COMPLETED') await prisma.listing.update({ where: { id: l.id }, data: { status: 'SOLD', soldAt: new Date(created + DAY) } });
    if (d.status === 'PENDING_SELLER') await prisma.notification.create({ data: { userId: l.sellerId, type: 'request_new', payload: { requestId: r.id, title: l.title, price: l.price, buyer: u.username } } });

    // A chat for some deals.
    if (['WAITING_HANDOVER', 'PENDING_SELLER', 'IN_TRANSIT'].includes(d.status)) {
      const t = await prisma.thread.create({ data: { listingId: l.id, buyerId: u.id, sellerId: l.sellerId, requestId: r.id, lastMessageAt: new Date(created + 2 * 3600 * 1000) } });
      const lines: Array<[string, string]> = [
        [u.id, 'Здравствуйте! Вещь ещё актуальна?'],
        [l.sellerId, 'Да, актуальна. Могу передать у метро.'],
        [u.id, 'Отлично, какая станция удобна?'],
      ];
      for (const [k, [sender, body]] of lines.entries()) await prisma.message.create({ data: { threadId: t.id, senderId: sender, body, createdAt: new Date(created + (k + 1) * 40 * 60 * 1000) } });
    }
  }

  // ---------- offers ----------
  const offerItem = nextItem(0);
  if (offerItem?.price) {
    await prisma.offer.create({ data: { listingId: offerItem.id, buyerId: buyers[1].id, sellerId: offerItem.sellerId, round: 1, amount: Math.round(offerItem.price * 0.8), from: 'BUYER', expiresAt: new Date(now + 46 * 3600 * 1000) } });
    await prisma.listing.update({ where: { id: offerItem.id }, data: { acceptsOffers: true, minOfferPrice: null } });
    await prisma.notification.create({ data: { userId: offerItem.sellerId, type: 'offer_new', payload: { listingId: offerItem.id, title: offerItem.title, amount: Math.round(offerItem.price * 0.8), price: offerItem.price, buyer: buyers[1].username } } });
  }
  const counterItem = nextItem(1);
  if (counterItem?.price) {
    const first = Math.round(counterItem.price * 0.7);
    await prisma.offer.create({ data: { listingId: counterItem.id, buyerId: buyer.id, sellerId: counterItem.sellerId, round: 1, amount: first, from: 'BUYER', status: 'COUNTERED', expiresAt: new Date(now + 20 * 3600 * 1000), createdAt: new Date(now - 5 * 3600 * 1000) } });
    await prisma.offer.create({ data: { listingId: counterItem.id, buyerId: buyer.id, sellerId: counterItem.sellerId, round: 2, amount: Math.round(counterItem.price * 0.88), from: 'SELLER', expiresAt: new Date(now + 44 * 3600 * 1000) } });
    await prisma.listing.update({ where: { id: counterItem.id }, data: { acceptsOffers: true } });
    await prisma.notification.create({ data: { userId: buyer.id, type: 'offer_countered', payload: { listingId: counterItem.id, title: counterItem.title, amount: Math.round(counterItem.price * 0.88), by: 'kate' } } });
  }

  // ---------- notifications for the demo buyer ----------
  const dropped = available.find((l) => l.previousPrice);
  if (dropped) await prisma.notification.create({ data: { userId: buyer.id, type: 'price_drop', payload: { listingId: dropped.id, title: dropped.title, oldPrice: dropped.previousPrice, newPrice: dropped.price } } });

  // ---------- reports for the moderation queue ----------
  const suspicious = available.slice(20, 23);
  for (const [k, l] of suspicious.entries()) {
    await prisma.report.create({ data: { reporterId: buyers[k % buyers.length].id, targetType: 'LISTING', targetId: l.id, reason: pick(['Подделка или копия бренда', 'Фото не соответствует вещи', 'Мошенничество']), comment: k === 0 ? 'Логотип выглядит странно' : null } });
  }
  await prisma.report.create({ data: { reporterId: buyers[2].id, targetType: 'USER', targetId: sellers[10].id, reason: 'Не выходит на связь после сделки' } });
  await prisma.report.create({ data: { reporterId: sellers[1].id, targetType: 'APPEAL', targetId: bySeller('kate')[2].id, reason: 'Обжалование блокировки', comment: 'Это оригинал, бирка на третьем фото' } });

  const count = await prisma.listing.count();
  console.log(`Seeded ${sellers.length + buyers.length + 1} users and ${count} listings. Password for all seed accounts: ${SEED_PASSWORD}`);
  await prisma.$disconnect();
  // Demo auctions on top (decision D16).
  await import('./seed-auctions.js');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
