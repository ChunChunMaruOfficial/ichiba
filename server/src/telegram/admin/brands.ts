import type { Routes } from './ctx.js';
import { a, ask, btn, clip, day, dt, go, h, int, menu, pager, screen, str, tabs, toast, type Btn } from './ui.js';

interface Application {
  id: string;
  kind: 'BRAND' | 'CATALOG';
  brandName: string;
  legalForm: string;
  legalName: string | null;
  unp: string | null;
  contactName: string;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  links: string[];
  description: string;
  status: string;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: { id: string; username: string; email: string | null; createdAt: string; brandVerifiedAt: string | null; catalogApprovedAt: string | null; _count: { listings: number } };
}

const TABS = [
  ['PENDING', 'Ждут'],
  ['APPROVED', 'Одобрены'],
  ['REJECTED', 'Отклонены'],
  ['all', 'Все'],
] as const;
const LEGAL: Record<string, string> = { IP: 'ИП', LLC: 'Организация', SELF_EMPLOYED: 'Самозанятый', PERSON: 'Физлицо' };
const STATUS: Record<string, string> = { PENDING: '⏳ ждёт решения', APPROVED: '✅ одобрена', REJECTED: '✖️ отклонена' };
const safeLink = (l: string) => (/^https?:\/\//i.test(l) ? `<a href="${h(l)}">${h(clip(l.replace(/^https?:\/\//i, ''), 50))}</a>` : h(clip(l, 50)));

function card(x: Application) {
  return [
    `${x.kind === 'BRAND' ? '🏮 Статус «Бренд»' : '📗 Основной каталог'} · ${STATUS[x.status] ?? h(x.status)}`,
    '',
    `<b>${h(x.brandName)}</b> · ${h(LEGAL[x.legalForm] ?? x.legalForm)}${x.legalName ? ` · ${h(x.legalName)}` : ''}${x.unp ? ` · УНП <code>${h(x.unp)}</code>` : ''}`,
    `Контакт: ${h(x.contactName)}${x.email ? ` · ${h(x.email)}` : ''}${x.phone ? ` · ${h(x.phone)}` : ''}${x.telegram ? ` · TG ${h(x.telegram)}` : ''}`,
    x.links.length ? `Ссылки: ${x.links.map(safeLink).join(' · ')}` : '',
    '',
    h(clip(x.description, 1500)),
    '',
    `Аккаунт ${a(`@${x.user.username}`, `/u/${x.user.username}`)} с ${day(x.user.createdAt)} · в продаже ${x.user._count.listings}${x.user.brandVerifiedAt ? ' · 🏮 бренд' : ''}${x.user.catalogApprovedAt ? ' · 📗 каталог' : ''}`,
    `Подана ${dt(x.createdAt)}${x.reviewedAt ? ` · рассмотрена ${dt(x.reviewedAt)}` : ''}`,
    x.adminNote ? `Комментарий: ${h(x.adminNote)}` : '',
  ]
    .filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '')
    .join('\n');
}

export const brandRoutes: Routes = {
  async brands({ api, p }) {
    const tab = TABS.some(([t]) => t === p.tab) ? str(p.tab) : 'PENDING';
    const { items } = await api<{ items: Application[] }>('GET', `/admin/brand-applications?status=${tab}`);
    const i = Math.min(int(p.i), Math.max(0, items.length - 1));
    const rows: Btn[][] = [...tabs(TABS, tab, 'brands')];
    if (!items.length) return screen(`🏮 <b>Бренды</b>\n\n${tab === 'PENDING' ? 'Новых анкет нет ✨' : 'Пусто'}`, [...rows, [menu()]]);
    const x = items[i];
    const P = { id: x.id, tab, i, kind: x.kind, userId: x.user.id };
    if (x.status === 'PENDING') {
      rows.push([btn('✅ Одобрить', 'brands.approve', P), btn('✖️ Отклонить', 'brands.reject', P)]);
      if (x.kind === 'BRAND') rows.push([btn('✏️ Одобрить с другим названием', 'brands.rename', P)]);
    } else if (x.status === 'APPROVED' && (x.kind === 'BRAND' ? x.user.brandVerifiedAt : x.user.catalogApprovedAt)) {
      rows.push([btn('↩️ Отозвать статус', 'brands.revoke', P)]);
    }
    rows.push([btn('👤 Аккаунт', 'user', { id: x.user.id })]);
    rows.push(pager('brands', { tab }, 'i', i, items.length));
    rows.push([btn('🔄', 'brands', { tab, i }), menu()]);
    return screen(`🏮 <b>Бренды</b> · ${i + 1} из ${items.length}\n\n${card(x)}`, rows);
  },

  async 'brands.approve'({ p }) {
    return ask('✅ Одобрить анкету. Комментарий для продавца (необязательно):', go('brands.approvedo', p), go('brands', { tab: p.tab, i: p.i }), { skip: 'Без комментария' });
  },
  async 'brands.rename'({ p }) {
    return ask('✏️ Под каким названием одобрить бренд (до 60 символов)?', go('brands.renamedo', p), go('brands', { tab: p.tab, i: p.i }));
  },
  async 'brands.renamedo'({ api, p }) {
    await api('POST', `/admin/brand-applications/${str(p.id)}/approve`, { note: null, brandName: str(p.input).trim() });
    return toast('✅ Одобрено, продавцу ушло письмо', go('brands', { tab: p.tab, i: p.i }));
  },
  async 'brands.approvedo'({ api, p }) {
    await api('POST', `/admin/brand-applications/${str(p.id)}/approve`, { note: str(p.input) || null });
    return toast('✅ Одобрено, продавцу ушло письмо', go('brands', { tab: p.tab, i: p.i }));
  },
  async 'brands.reject'({ p }) {
    return ask('✖️ Причина отказа — её увидит продавец:', go('brands.rejectdo', p), go('brands', { tab: p.tab, i: p.i }));
  },
  async 'brands.rejectdo'({ api, p }) {
    await api('POST', `/admin/brand-applications/${str(p.id)}/reject`, { note: str(p.input) });
    return toast('✖️ Отклонено, продавцу ушло письмо', go('brands', { tab: p.tab, i: p.i }));
  },
  async 'brands.revoke'({ p }) {
    return ask('↩️ Забрать статус. Причина для журнала:', go('brands.revokedo', p), go('brands', { tab: p.tab, i: p.i }), { skip: 'Без причины' });
  },
  async 'brands.revokedo'({ api, p }) {
    await api('POST', `/admin/brand-applications/users/${str(p.userId)}/revoke`, { note: str(p.input) || null, kind: p.kind === 'CATALOG' ? 'CATALOG' : 'BRAND' });
    return toast('↩️ Статус снят', go('brands', { tab: p.tab, i: p.i }));
  },
};
