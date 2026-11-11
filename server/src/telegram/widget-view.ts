/**
 * What each screen of the shop menu shows, as the blocks the widget draws (widget-src.ts MAIN_BASE describes them).
 * widget.ts gathers the data (who, what, how many); this turns it into a screen: texts, buttons, the commands they
 * send. Pure, so every screen is easy to test. The widget only ever sends back the commands written here, and the
 * bot checks each one again (widget.ts parseCommand + the services).
 */
import { siteUrl } from './cards.js';

type Data = Record<string, unknown> & { s?: string };
type Block = unknown[];
export interface View {
  [k: string]: unknown;
  s?: string;
  H: [string, string?, string?];
  B: Block[];
  t?: string;
}

const STATUS: Record<string, string> = { P: 'В продаже', R: 'Идёт сделка', H: 'Снята с продажи', D: 'Черновик', S: 'Продана', B: 'Снята модератором' };
/** Same order as TG_CATEGORIES (texts.ts). */
const CATEGORIES = ['Сделки', 'Предложения цены', 'Аукционы', 'Сообщения', 'Интерес к вещам', 'Вечерняя сводка', 'Избранное и подписки', 'Аккаунт'];
const EMPTY_LIST: Record<string, string> = { a: 'Вещей в продаже нет', h: 'Снятых вещей нет', d: 'Черновиков нет', s: 'Проданных пока нет' };

const byn = (n: unknown) => (typeof n === 'number' ? `${n.toLocaleString('ru-RU')} BYN` : 'договорная');
const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The screen for a state built by widget.ts. */
export function toView(d: Data): View {
  const u = d.u ? `@${str(d.u)}` : undefined;
  const view = (title: string, back: string | undefined, B: Block[]): View => ({ s: d.s, H: back ? [title, u, back] : [title, u], B, ...(d.t ? { t: str(d.t) } : {}) });
  switch (d.s) {
    case 'h':
      return view('Ichiba', undefined, home(d));
    case 'l':
      return view('Вещи', 'h', list(d));
    case 'i':
      return view('Вещь', `l:${str(d.f) || 'a'}:0`, item(d));
    case 'd':
      return view('Ждут ответа', 'h', deals(d));
    case 'b':
      return view('Покупки', 'h', buys(d));
    case 't':
      return view('Статистика', 'h', stats(d));
    case 'n':
      return view('Уведомления', 'h', nots(d));
    case 'x':
      return { s: 'x', H: ['Ваши магазины'], B: arr<string>(d.a).map((a, k) => ['r', `@${a}`, `xa:${k}`]) };
    default:
      return { H: ['Ichiba'], B: [['c', ['m', str(d.e) || 'Магазин ichiba']], ['m', 'Открыть', 'h']] };
  }
}

function home(d: Data): Block[] {
  const n = arr<number>(d.n);
  const B: Block[] = [['v', 'heart', 'Подбор вещей', 'листайте и лайкайте', 'V']];
  if (n.some((x) => x > 0)) B.push(['g', [[n[0], 'В продаже', 'l:a:0'], [n[1], 'Сняты', 'l:h:0'], [n[2], 'Черновики', 'l:d:0'], [n[3], 'Проданы', 'l:s:0']]]);
  const tiles: unknown[] = [
    ...(d.ad ? [['key', 'Админка', 'A']] : []),
    ['box', 'Вещи', 'l:a:0'],
    ['bag', 'Сделки', 'd', num(d.w) || undefined],
    ['cart', 'Покупки', 'b'],
    ['chart', 'Статистика', 't'],
    ['bell', 'Уведомления', 'n'],
    ...(d.k ? [['box', 'Другой магазин', 'x']] : []),
  ];
  const site = siteUrl('/');
  const help = siteUrl('/how-it-works');
  if (site) tiles.push(['globe', 'Сайт ichiba', site]);
  if (help) tiles.push(['help', 'Помощь', help]);
  B.push(['g', tiles]);
  return B;
}

function list(d: Data): Block[] {
  const f = str(d.f) || 'a';
  const B: Block[] = [['ch', [['В продаже', 'l:a:0', f === 'a'], ['Снятые', 'l:h:0', f === 'h'], ['Черновики', 'l:d:0', f === 'd'], ['Проданные', 'l:s:0', f === 's']]]];
  const items = arr<[string, number | null, string]>(d.i);
  if (!items.length) {
    const sell = siteUrl('/sell');
    B.push(['e', 'box', EMPTY_LIST[f] ?? EMPTY_LIST.a, 'Выставьте вещь на сайте — она появится здесь', sell ? 'Выставить вещь' : '', sell ?? '']);
    return B;
  }
  items.forEach(([title, price, st], k) => B.push(['r', title, `o:${k}`, undefined, `${byn(price)}${st === 'R' ? ' · сделка' : ''}`]));
  const p = num(d.p);
  const P = num(d.P);
  if (P > 1) B.push(['pg', p + 1, P, p > 0 ? `l:${f}:${p - 1}` : '', p < P - 1 ? `l:${f}:${p + 1}` : '']);
  return B;
}

function item(d: Data): Block[] {
  const st = str(d.st);
  const live = st === 'P' || st === 'R';
  const editable = /^[PHD]$/.test(st) && !d.au;
  const card: unknown[] = ['c', ['b', str(d.T)], ['pl', STATUS[st] ?? st, st]];
  if (live) card.push(['m', `${num(d.v)} просмотров · ${num(d.fv)} в избранном${d.of ? ' · торг' : ''}`]);
  if (!editable) card.push(['p', byn(d.c), d.o ? byn(d.o) : '']);
  const B: Block[] = [card];
  if (editable) B.push(['st', typeof d.c === 'number' ? d.c : 0, 'Больше чем вдвое дешевле — проверьте']);
  const sizes = arr<string>(d.z);
  // Sizes in stock: tap the one sold elsewhere, then confirm.
  if (sizes.length > 1) B.push(['ch', sizes.map((s, k) => [s, `Z:${k}`, 0, `Убрать ${s}?`, 'x'])]);
  const a: unknown[] = [];
  if (st === 'P') {
    a.push(['Снять', 'H', 'hide']);
    if (d.bu === 0) a.push(['Поднять', 'B', 'up']);
    if (d.fx) a.push([d.of ? 'Торг: вкл' : 'Торг: выкл', 'O', 'tag', '', d.of ? 'ok' : '']);
  }
  if (st === 'H' && !d.ha) a.push(['Вернуть в продажу', 'U', 'eye', '', 'ok']);
  if (st === 'D') a.push(['Опубликовать', 'U', 'up', '', 'ok']);
  if (st === 'P' || (st === 'H' && !d.ha)) a.push(['Продано', 'S', 'check', 'Точно продано? Да']);
  if (a.length) B.push(['k', a]);
  return B;
}

function deals(d: Data): Block[] {
  const rows = arr<[string, string, string, number]>(d.i);
  if (!rows.length) return [['e', 'bag', 'Ничего не ждёт ответа', 'Запросы на покупку и предложения цены появятся здесь и придут уведомлением', 'Мои вещи', 'l:a:0']];
  // One line each, like every other list: what and how much, who, and ✓ / ✕ right in the row.
  const B: Block[] = rows.map(([kind, buyer, title, amount], k) => [
    'a',
    kind === 'r' ? 'bag' : 'tag',
    `${byn(amount)} · @${buyer}`,
    `${kind === 'r' ? 'Хотят купить' : 'Предлагают цену'} · ${title}`,
    `da:${k}`,
    `dx:${k}`,
  ]);
  if (num(d.m)) B.push(['p', `Ещё ${num(d.m)} ждут — ответьте на эти`]);
  return B;
}

function buys(d: Data): Block[] {
  const rows = arr<[string, string, number, string, number]>(d.i);
  if (!rows.length) return [['e', 'cart', 'Активных покупок нет', 'Найдите вещь в подборе — листайте и лайкайте', 'Подбор вещей', 'V']];
  // A counter-offer from the seller is answered right in its row; the rest only say where they stand.
  const B: Block[] = rows.map(([kind, title, amount, text, k]) =>
    kind === 'c' ? ['a', 'tag', `${byn(amount)} · ${title}`, text, `ba:${k}`, `bx:${k}`] : ['a', 'cart', `${byn(amount)} · ${title}`, text],
  );
  if (num(d.m)) B.push(['p', `Ещё ${num(d.m)} — на сайте`]);
  return B;
}

function stats(d: Data): Block[] {
  return [
    ['bars', arr<number>(d.d), 'Просмотры за 7 дней'],
    ['g', [[num(d.v), 'Просмотры', ''], [num(d.f), 'В избранном', ''], [num(d.c), 'В корзине', ''], [num(d.m), 'Чаты', ''], [num(d.o), 'Предложения', ''], [num(d.r), 'Запросы', '']]],
  ];
}

function nots(d: Data): Block[] {
  const q = arr<number>(d.q);
  return [...CATEGORIES.map((label, k) => ['s', label, q[k] ? 1 : 0, `nt:${k}`]), ['k', [['Отключить Telegram', 'K', 'x', 'Точно отключить?']]]];
}
