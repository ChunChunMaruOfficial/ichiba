import { qs } from './api.js';
import type { Ctx, Routes } from './ctx.js';
import { LISTING_STATUS } from './home.js';
import { a, ask, btn, byn, clip, dt, go, h, int, menu, pager, screen, site, str, tabs, toast, type Btn } from './ui.js';

interface Item {
  id: string;
  slug: string;
  title: string;
  price: number;
  status: string;
  size: string | null;
  brand: string | null;
  category: string | null;
  publishedAt: string | null;
  seller: { id: string; username: string; brand: string | null };
  blockedReason: string | null;
  market: 'brands' | 'resale';
  marketByAdmin: boolean;
}

const TABS = [
  ['BLOCKED', 'Заблок.'],
  ['PUBLISHED', 'В продаже'],
  ['HIDDEN', 'Скрытые'],
  ['RESERVED', 'Резерв'],
  ['SOLD', 'Проданы'],
  ['DRAFT', 'Черновики'],
] as const;
const PER_PAGE = 8;
const MARKET: Record<string, string> = { brands: 'Бренды и каталог', resale: 'Вторичка' };

const list = (api: Ctx['api'], tab: string, q: string) => api<{ items: Item[] }>('GET', `/admin/listings${qs({ status: tab, q })}`);
const tabOf = (v: unknown) => (TABS.some(([t]) => t === v) ? String(v) : 'BLOCKED');

export const listingRoutes: Routes = {
  async listings({ api, p }) {
    const tab = tabOf(p.tab);
    const q = str(p.q);
    const { items } = await list(api, tab, q);
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    const page = Math.min(int(p.page), pages - 1);
    const rows: Btn[][] = [...tabs(TABS, tab, 'listings', { q })];
    for (const l of items.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) rows.push([btn(`${clip(l.title, 34)} · ${l.price} BYN · @${clip(l.seller.username, 14)}`, 'listing', { id: l.id, tab, q, page })]);
    rows.push(pager('listings', { tab, q }, 'page', page, pages));
    rows.push([btn(q ? `🔎 «${clip(q, 16)}» ✕` : '🔎 Поиск', q ? 'listings' : 'listings.find', { tab, q: '' }), menu()]);
    const head = `📦 <b>Объявления</b> · ${h(LISTING_STATUS[tab])}${q ? ` · «${h(q)}»` : ''}\n\n${items.length ? `Найдено: <b>${items.length}</b>${items.length >= 100 ? ' (показаны последние 100)' : ''}` : 'Ничего нет'}`;
    return screen(head, rows);
  },

  async 'listings.find'({ p }) {
    return ask('🔎 Название вещи или ник продавца:', go('listings.q', { tab: p.tab }), go('listings', { tab: p.tab }));
  },
  async 'listings.q'({ p }) {
    return toast('', go('listings', { tab: p.tab, q: str(p.input).trim().slice(0, 100) }));
  },

  async listing({ api, p }) {
    const tab = tabOf(p.tab);
    const { items } = await list(api, tab, str(p.q));
    const l = items.find((x) => x.id === p.id);
    const backTo = { tab, q: p.q, page: p.page };
    if (!l) return toast('Вещь ушла из этого списка', go('listings', backTo));
    const text = [
      `📦 <b>${a(clip(l.title, 120), `/item/${l.id}-${l.slug}`)}</b>`,
      '',
      `${byn(l.price)}${l.size ? ` · ${h(l.size)}` : ''}${l.brand ? ` · ${h(l.brand)}` : ''}`,
      `Продавец: @${h(l.seller.username)}${l.seller.brand ? ` (бренд «${h(l.seller.brand)}»)` : ''}`,
      `Статус: <b>${h(LISTING_STATUS[l.status] ?? l.status)}</b>${l.publishedAt ? ` · опубликована ${dt(l.publishedAt)}` : ''}`,
      `Раздел: ${h(MARKET[l.market])}${l.marketByAdmin ? ' · <i>выбран админом</i>' : ''}`,
      l.blockedReason ? `\n🚫 Причина блокировки: ${h(l.blockedReason)}` : '',
    ].join('\n');
    const id = l.id;
    const rows: Btn[][] = [
      l.status === 'BLOCKED' ? [btn('✅ Разблокировать', 'listing.unblock', { id, ...backTo })] : l.status === 'RESERVED' ? [] : [btn('🚫 Заблокировать', 'listing.block', { id, ...backTo })],
      [l.market === 'brands' ? btn('↘️ Перенести во «Вторичку»', 'listing.market', { id, market: 'resale', ...backTo }) : btn('↗️ Перенести в каталог', 'listing.market', { id, market: 'brands', ...backTo })],
      site('Открыть на сайте', `/item/${l.id}-${l.slug}`),
      [btn('👤 Продавец', 'user', { id: l.seller.id }), btn('📜 История вещи', 'log', { listing: l.id })],
      [btn('← К списку', 'listings', backTo), menu()],
    ];
    return screen(text, rows);
  },

  async 'listing.block'({ p }) {
    return ask('🚫 Причина блокировки — её увидит продавец (от 3 символов):', go('listing.blockdo', p), go('listing', p));
  },
  async 'listing.blockdo'({ api, p }) {
    await api('POST', `/admin/listings/${str(p.id)}/block`, { reason: str(p.input) });
    return toast('🚫 Вещь заблокирована, продавец уведомлён', go('listings', { tab: p.tab, q: p.q, page: p.page }));
  },
  async 'listing.unblock'({ p }) {
    return screen('Разблокировать вещь? Она снова появится в продаже, продавец получит уведомление.', [[btn('✅ Да, разблокировать', 'listing.unblockdo', p), btn('Отмена', 'listing', p)]]);
  },
  async 'listing.unblockdo'({ api, p }) {
    await api('POST', `/admin/listings/${str(p.id)}/unblock`);
    return toast('✅ Вещь снова в продаже', go('listings', { tab: p.tab, q: p.q, page: p.page }));
  },
  async 'listing.market'({ api, p }) {
    await api('POST', `/admin/listings/${str(p.id)}/market`, { market: str(p.market) });
    return toast(p.market === 'brands' ? '↗️ Перенесена в каталог' : '↘️ Перенесена во «Вторичку»', go('listing', p));
  },
};
