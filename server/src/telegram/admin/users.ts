import { qs } from './api.js';
import type { Routes } from './ctx.js';
import { LISTING_STATUS } from './home.js';
import { a, ask, btn, byn, clip, day, dt, go, h, int, menu, pager, screen, site, str, tabs, toast, type Btn } from './ui.js';

interface Row {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: string;
  blockedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  listings: number;
  via: string[];
}
interface Detail {
  user: Record<string, unknown> & { id: string; username: string; role: string; hasPassword: boolean };
  stats: { listings: Record<string, number>; asBuyer: number; asSeller: number; reportsAgainst: number };
  recentListings: Array<{ id: string; title: string; status: string; price: number }>;
  actions: Array<{ action: string; reason: string | null; at: string }>;
}

const TABS = [
  ['all', 'Все'],
  ['blocked', 'Заблок.'],
  ['admins', 'Админы'],
  ['hidden', 'Скрытые'],
  ['deleted', 'Удалённые'],
] as const;
const PER_PAGE = 10;
const API_PAGE = 50;
const ACTION: Record<string, string> = {
  block: '🚫 блокировка',
  unblock: '✅ разблокировка',
  edit: '✏️ правка',
  password_reset: '🔑 новый пароль',
  hide_listings: '🙈 скрыт',
  show_listings: '👁 показан',
  delete: '🗑 удалён',
  brand_approve: '🏮 бренд одобрен',
  brand_reject: 'бренд отклонён',
  brand_revoke: 'бренд отозван',
  catalog_approve: 'каталог одобрен',
  catalog_reject: 'каталог отклонён',
  catalog_revoke: 'каталог отозван',
  tg_admin_unlock: '🔓 вход в бот',
  tg_admin_unlock_failed: '⚠️ неверный пароль в боте',
};

const flags = (u: { role: string; blockedAt: unknown; deletedAt: unknown }) => `${u.role === 'ADMIN' ? '👑' : ''}${u.blockedAt ? '🚫' : ''}${u.deletedAt ? '🗑' : ''}`;

export const userRoutes: Routes = {
  async users({ api, p }) {
    const tab = TABS.some(([t]) => t === p.tab) ? str(p.tab) : 'all';
    const q = str(p.q);
    const page = int(p.page);
    const apiPage = Math.floor((page * PER_PAGE) / API_PAGE) + 1;
    const res = await api<{ total: number; items: Row[] }>('GET', `/admin/users${qs({ q, filter: tab, page: apiPage })}`);
    const offset = (page * PER_PAGE) % API_PAGE;
    const pages = Math.max(1, Math.ceil(res.total / PER_PAGE));
    const rows: Btn[][] = [...tabs(TABS, tab, 'users', { q })];
    for (const u of res.items.slice(offset, offset + PER_PAGE)) rows.push([btn(`${flags(u)} @${clip(u.username, 20)} · ${u.listings} вещ. · ${u.email ? clip(u.email, 20) : (u.phone ?? (u.via.join('+') || '—'))}`, 'user', { id: u.id, tab, q, page })]);
    rows.push(pager('users', { tab, q }, 'page', Math.min(page, pages - 1), pages));
    rows.push([btn(q ? `🔎 «${clip(q, 16)}» ✕` : '🔎 Поиск', q ? 'users' : 'users.find', { tab, q: '' }), menu()]);
    return screen(`👥 <b>Пользователи</b>${q ? ` · «${h(q)}»` : ''}\n\nНайдено: <b>${res.total}</b>`, rows);
  },
  async 'users.find'({ p }) {
    return ask('🔎 Ник, почта, телефон или id:', go('users.q', { tab: p.tab }), go('users', { tab: p.tab }));
  },
  async 'users.q'({ p }) {
    return toast('', go('users', { tab: p.tab, q: str(p.input).trim().slice(0, 100) }));
  },

  async user({ api, p, admin }) {
    const id = str(p.id);
    const d = await api<Detail>('GET', `/admin/users/${id}`);
    const u = d.user;
    const s = (k: string) => (u[k] == null || u[k] === '' ? null : String(u[k]));
    const listed = Object.entries(d.stats.listings).map(([k, n]) => `${h(LISTING_STATUS[k] ?? k)} ${n}`).join(' · ');
    const lines = [
      `👤 <b>${a(`@${u.username}`, `/u/${u.username}`)}</b> ${flags({ role: u.role, blockedAt: u.blockedAt, deletedAt: u.deletedAt })}`,
      '',
      `Почта: ${h(s('email') ?? '—')}${u.emailVerifiedAt ? ' ✓' : ''}`,
      `Телефон: ${h(s('phone') ?? '—')}`,
      `Город: ${h(s('city') ?? '—')}`,
      s('bio') ? `О себе: ${h(clip(s('bio'), 200))}` : null,
      `Вход: ${[u.hasPassword && 'пароль', u.googleSub && 'Google', u.telegramId && 'Telegram', u.appleSub && 'Apple'].filter(Boolean).join(', ') || '—'}${u.tgUsername ? ` · TG @${h(u.tgUsername)}` : ''}`,
      `Зарегистрирован: ${day(u.createdAt)}`,
      u.brandVerifiedAt ? `🏮 Бренд «${h(s('brandName') ?? u.username)}» с ${day(u.brandVerifiedAt)}` : null,
      u.catalogApprovedAt ? `📗 В основном каталоге с ${day(u.catalogApprovedAt)}` : null,
      u.blockedAt ? `🚫 Заблокирован ${dt(u.blockedAt)}` : null,
      u.listingsHiddenAt ? `🙈 Аккаунт скрыт ${dt(u.listingsHiddenAt)}` : null,
      u.deletedAt ? `🗑 Удалён ${dt(u.deletedAt)}` : null,
      '',
      `Вещи: ${listed || 'нет'}`,
      `Покупок: ${d.stats.asBuyer} · продаж: ${d.stats.asSeller} · жалоб на него: ${d.stats.reportsAgainst}`,
    ];
    if (d.recentListings.length) lines.push('', '<b>Последние вещи</b>', ...d.recentListings.slice(0, 6).map((l) => `• ${a(clip(l.title, 50), `/item/${l.id}`)} — ${byn(l.price)} · ${h(LISTING_STATUS[l.status] ?? l.status)}`));
    if (d.actions.length) lines.push('', '<b>Действия админов</b>', ...d.actions.slice(0, 6).map((x) => `${dt(x.at)} · ${h(ACTION[x.action] ?? x.action)}${x.reason ? ` — ${h(clip(x.reason, 80))}` : ''}`));

    const self = id === admin.id;
    const back = { tab: p.tab, q: p.q, page: p.page };
    const P = { id, ...back };
    const rows: Btn[][] = [];
    if (!u.deletedAt) {
      // An admin's password is never reset from the panel (the API refuses too).
      rows.push([btn('✏️ Изменить', 'user.edit', P), ...(u.role !== 'ADMIN' ? [btn('🔑 Новый пароль', 'user.pass', P)] : [])]);
      if (!self) rows.push([u.blockedAt ? btn('✅ Разблокировать', 'user.unblock', P) : btn('🚫 Заблокировать', 'user.block', P), u.listingsHiddenAt ? btn('👁 Показать аккаунт', 'user.show', P) : btn('🙈 Скрыть аккаунт', 'user.hide', P)]);
      const revoke: Btn[] = [];
      if (u.brandVerifiedAt) revoke.push(btn('Отозвать «Бренд»', 'user.revoke', { ...P, kind: 'BRAND' }));
      if (u.catalogApprovedAt) revoke.push(btn('Убрать из каталога', 'user.revoke', { ...P, kind: 'CATALOG' }));
      rows.push(revoke);
    }
    rows.push([btn('📜 Журнал продавца', 'log', { q: u.username }), btn('🗄 Строка в базе', 'db.row', { table: 'User', key: { id } })]);
    if (!u.deletedAt && !self) rows.push([btn('🗑 Удалить аккаунт', 'user.del', P)]);
    rows.push(site('Профиль на сайте', `/u/${u.username}`));
    rows.push([btn('← К списку', 'users', back), menu()]);
    // Absent fields (null) drop out; the blank lines between blocks stay.
    return screen(lines.filter((l) => l !== null).join('\n'), rows);
  },
};
