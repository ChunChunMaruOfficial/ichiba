import { qs } from './api.js';
import type { Routes } from './ctx.js';
import { ACTIONS, logLine, type LogRow } from './activity-labels.js';
import { ask, btn, clip, day, go, h, int, menu, pager, screen, str, toast, type Btn } from './ui.js';

interface Page {
  total: number;
  pageSize: number;
  summary: { sellers: number; created: number; published: number; sold: number; deals: number };
  items: Array<LogRow & { id: string }>;
}

const MARKETS = [
  ['all', 'Все разделы'],
  ['brands', 'Бренды и каталог'],
  ['resale', 'Вторичка'],
] as const;
const PERIODS = [
  ['all', 'Всё время', 0],
  ['today', 'Сегодня', 1],
  ['week', '7 дней', 7],
  ['month', '30 дней', 30],
] as const;
const PER_PAGE = 12;
const API_PAGE = 50;
const minskDay = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Minsk' }).format(d);
const next = <T extends readonly (readonly [string, ...unknown[]])[]>(list: T, cur: unknown) => list[(list.findIndex(([id]) => id === cur) + 1) % list.length][0];

/** The admin «Журнал»: every seller's actions, with the same filters as the site. */
export const logRoutes: Routes = {
  async log({ api, p }) {
    const market = MARKETS.some(([m]) => m === p.market) ? str(p.market) : 'all';
    const period = PERIODS.find(([id]) => id === p.period) ?? PERIODS[0];
    const action = str(p.action);
    const q = str(p.q);
    const listing = str(p.listing);
    const page = int(p.page);
    const from = period[2] ? minskDay(new Date(Date.now() - (period[2] - 1) * 86_400_000)) : '';
    const res = await api<Page>('GET', `/admin/activity${qs({ market, action, q, from, listing, page: Math.floor((page * PER_PAGE) / API_PAGE) + 1 })}`);
    const offset = (page * PER_PAGE) % API_PAGE;
    const rows = res.items.slice(offset, offset + PER_PAGE);
    const pages = Math.max(1, Math.ceil(res.total / PER_PAGE));
    const F = { market, period: period[0], action, q, listing };

    // Rows grouped by day, newest first.
    const body: string[] = [];
    let lastDay = '';
    for (const r of rows) {
      const d = day(r.at);
      if (d !== lastDay) body.push(`\n<b>${d}</b>`);
      lastDay = d;
      body.push(logLine(r));
    }
    const s = res.summary;
    const filters = [MARKETS.find(([m]) => m === market)![1], period[1], action && (action === 'deal' ? 'Сделки' : (ACTIONS[action] ?? action)), q && `@${q}`, listing && 'одна вещь'].filter(Boolean).join(' · ');
    const text = [
      '📜 <b>Журнал</b>',
      `<i>${h(filters)}</i>`,
      '',
      `Записей: <b>${res.total}</b> · продавцов ${s.sellers} · создано ${s.created} · выставлено ${s.published} · продано ${s.sold} · шагов сделок ${s.deals}`,
      body.length ? body.join('\n') : '\nНичего не нашлось',
    ].join('\n');

    const kb: Btn[][] = [
      [btn(`🗂 ${MARKETS.find(([m]) => m === market)![1]}`, 'log', { ...F, market: next(MARKETS, market), page: 0 }), btn(`📅 ${period[1]}`, 'log', { ...F, period: next(PERIODS, period[0]), page: 0 })],
      [btn(action ? `🏷 ${clip(action === 'deal' ? 'Сделки' : (ACTIONS[action] ?? action), 18)} ✕` : '🏷 Тип действия', action ? 'log' : 'log.actions', { ...F, action: '', page: 0 }), btn(q ? `👤 @${clip(q, 14)} ✕` : '👤 Продавец', q ? 'log' : 'log.find', { ...F, q: '', page: 0 })],
      ...(listing ? [[btn('📦 Все вещи ✕', 'log', { ...F, listing: '', page: 0 })]] : []),
      pager('log', F, 'page', Math.min(page, pages - 1), pages),
      [btn('🔄', 'log', { ...F, page }), btn('🔔 Уведомления', 'notify'), menu()],
    ];
    return screen(text, kb);
  },

  async 'log.actions'({ p }) {
    const codes = [...Object.keys(ACTIONS), 'deal'];
    const rows: Btn[][] = [];
    for (let i = 0; i < codes.length; i += 2) rows.push(codes.slice(i, i + 2).map((c) => btn(c === 'deal' ? 'Сделки' : ACTIONS[c], 'log', { ...p, action: c, page: 0 })));
    rows.push([btn('← Назад', 'log', p)]);
    return screen('🏷 <b>Какие действия показать?</b>', rows);
  },
  async 'log.find'({ p }) {
    return ask('👤 Ник продавца (можно часть):', go('log.q', p), go('log', p));
  },
  async 'log.q'({ p }) {
    return toast('', go('log', { ...p, input: undefined, q: str(p.input).trim().replace(/^@/, '').slice(0, 40), page: 0 }));
  },
};
