/**
 * The assistant with the real models, on the isolated test database (never the working one): how it understands
 * live wording. Run: npx tsx _assistant-live.ts   (needs `prisma dev --name ichiba-test --db-port 51300` and AI keys
 * in .env). Prints each phrase, what the chat answered and what changed.
 */
import 'dotenv/config';
import { resetAndMigrate, useTestDatabaseForApp } from './test/int/helpers/testdb.js';

useTestDatabaseForApp();
const { PrismaService } = await import('./src/prisma/prisma.service.js');
const { ListingsService } = await import('./src/listings/listings.service.js');
const { AiEnsemble } = await import('./src/ai/ensemble/ensemble.js');
const { AssistantService } = await import('./src/assistant/assistant.service.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const prisma = new PrismaService();
await resetAndMigrate();
await prisma.$connect();
const quiet: Any = { notify: async () => {}, notifyMany: async () => {}, record: async () => {}, track: () => {}, send: async () => {}, dhash: async () => null };
const moderator: Any = { check: async () => ({ decision: 'pass', status: 'passed', reasons: [], fields: {} }), record: async () => {}, contentHash: () => 'h' };
const stats: Any = { track: () => {}, overview: async () => ({ days: 7, totals: { views: 240, favorites: 18, requests: 3, sales: 2, revenue: 310 }, previous: { views: 180, favorites: 11, requests: 1, sales: 1, revenue: 90 }, series: [], listings: [] }) };
const listings = new ListingsService(prisma, quiet, quiet, moderator, stats, quiet);
const ai = new AiEnsemble(prisma);
const users: Any = { updateMe: async (id: string, dto: Any) => prisma.user.update({ where: { id }, data: { ...(dto.city !== undefined ? { city: dto.city } : {}), ...(dto.uiPrefs ? { uiPrefs: dto.uiPrefs } : {}) } }) };
const assistant = new AssistantService(prisma, ai, listings, {} as Any, {} as Any, {} as Any, stats, users, quiet);

const u = await prisma.user.create({ data: { username: 'live_seller', city: 'Минск' } });
const DAY = 24 * 3600_000;
const items: Array<[string, string, string, number, number]> = [
  ['Куртка зимняя The North Face', 'outerwear', 'puffer', 240, 3],
  ['Пальто шерстяное', 'outerwear', 'coat', 180, 40],
  ['Джинсы Levis 501', 'jeans', 'straight', 90, 12],
  ['Джинсы широкие', 'jeans', 'wide', 70, 0],
  ['Футболка белая', 'tshirts', 'tshirt', 25, 55],
  ['Худи Carhartt', 'knitwear', 'hoodie', 110, 7],
];
for (const [title, category, subcategory, price, viewsCount] of items) {
  await prisma.listing.create({
    data: { sellerId: u.id, status: 'PUBLISHED', title, category, subcategory, sizeValue: 'M', condition: 'GOOD', price, viewsCount, defectsPresent: false, deliveryOptions: ['IN_PERSON'], publishedAt: new Date(Date.now() - 5 * DAY), liftedAt: new Date(Date.now() - 5 * DAY) },
  });
}
const state = async () => (await prisma.listing.findMany({ where: { sellerId: u.id }, orderBy: { createdAt: 'asc' } })).map((l) => `${l.title.split(' ')[0]}:${l.price}${l.status === 'PUBLISHED' ? '' : `(${l.status})`}${l.bumpsCount ? '↑' : ''}${l.acceptsOffers ? '' : '·без торга'}`).join(' ');

const PHRASES: Array<[string, ('undo' | 'ok' | 'no')?]> = [
  ['подними пару моих позиций', 'undo'],
  ['снизь цену всем позициям на 5%', 'undo'],
  ['скинь 10 рублей с джинсов'],
  ['нет, отмени это'],
  ['меню'],
  ['скрой все зимние вещи', 'undo'],
  ['выключи торг на худи'],
  ['что у меня хуже всего смотрят?'],
  ['как дела с продажами за неделю?'],
  ['отметь футболку проданной', 'no'],
  ['удали мой аккаунт'],
  ['как вернуть вещь, если не подошла?'],
  ['какая завтра погода в Минске?'],
  ['напиши сочинение про осень'],
  ['поменяй город на Гродно и сделай подробные карточки'],
];
console.log('START  ', await state());
for (const [phrase, then] of PHRASES) {
  const started = Date.now();
  const r = await assistant.send(u.id, phrase);
  const bot = r.messages.filter((m) => m.fromBot);
  console.log(`\n> ${phrase}   (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const m of bot) console.log(`  ${m.body.replace(/\n/g, '\n  ')}\n  [${(m.buttons ?? []).flat().map((b) => b.label).join(' | ')}]`);
  console.log('  STATE', await state());
  const id = bot.flatMap((m) => (m.buttons ?? []).flat()).find((b) => then && b.id.startsWith(`${then}:`))?.id;
  if (id) {
    const p = await assistant.press(u.id, id);
    console.log(`  → нажал «${then}»: ${p.messages.map((m) => m.body.replace(/\n/g, ' ')).join(' / ')}`);
    console.log('  STATE', await state());
  }
}
const runs = await prisma.aiRun.findMany({ where: { feature: 'assistant' }, select: { latencyMs: true, calls: true } });
console.log(`\nmodel runs: ${runs.length}, providers: ${[...new Set(runs.flatMap((r) => (r.calls as Any[]).filter((c) => c.ok).map((c) => `${c.provider}/${c.model}`)))].join(', ')}`);
await prisma.$disconnect();
process.exit(0);
