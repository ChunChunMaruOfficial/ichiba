import type { Routes } from './ctx.js';
import { LISTING_STATUS } from './home.js';
import { a, ask, btn, byn, clip, dt, go, h, int, menu, pager, screen, str, tabs, toast, type Btn } from './ui.js';

interface Report {
  id: string;
  targetType: 'LISTING' | 'USER' | 'APPEAL' | 'REVIEW';
  targetId: string;
  reason: string;
  comment: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  reporter: string | null;
  source: string;
  details: { votes?: Array<{ provider?: string; reason?: string }>; reasons?: string[] } | null;
  reportsOnTarget: number;
  listing: { id: string; slug: string; title: string; price: number; status: string; blockedReason: string | null; seller: { username: string } } | null;
  user: { id: string; username: string; blockedAt: string | null; createdAt: string } | null;
  review: { rating: number; text: string | null; reply: string | null; hidden: boolean; author: string; seller: string } | null;
}

const TABS = [
  ['OPEN', 'Открытые'],
  ['RESOLVED', 'Решённые'],
  ['REJECTED', 'Отклонённые'],
] as const;
const TYPE: Record<string, string> = { LISTING: '📦 Вещь', USER: '👤 Пользователь', APPEAL: '🙋 Обжалование блокировки', REVIEW: '⭐ Отзыв' };
const ACTION: Record<string, string> = { block: 'Заблокировать', unblock: 'Разблокировать', dismiss: 'Отклонить жалобу', block_user: 'Заблокировать пользователя' };

function card(r: Report) {
  const lines = [`${TYPE[r.targetType] ?? r.targetType} · ${dt(r.createdAt)}`, '', `<b>${h(r.reason)}</b>`];
  if (r.comment) lines.push(`«${h(clip(r.comment, 600))}»`);
  lines.push(r.source === 'ai' ? '🤖 Автомодерация' : `От: ${r.reporter ? `@${h(r.reporter)}` : 'гость'}`);
  if (r.reportsOnTarget > 1) lines.push(`⚠️ Жалоб на это: <b>${r.reportsOnTarget}</b>`);
  const reasons = r.details?.votes?.map((v) => v.reason).filter(Boolean) ?? r.details?.reasons ?? [];
  if (reasons.length) lines.push(`<i>${h(clip(reasons.join(' · '), 400))}</i>`);
  if (r.listing) {
    const l = r.listing;
    lines.push('', `${a(clip(l.title, 80), `/item/${l.id}-${l.slug}`)} · ${byn(l.price)}`, `@${h(l.seller.username)} · ${h(LISTING_STATUS[l.status] ?? l.status)}`);
    if (l.blockedReason) lines.push(`Причина блокировки: ${h(l.blockedReason)}`);
  }
  if (r.user) lines.push('', `${a(`@${r.user.username}`, `/u/${r.user.username}`)} · с ${dt(r.user.createdAt)}${r.user.blockedAt ? ' · 🚫 заблокирован' : ''}`);
  if (r.review) {
    const v = r.review;
    lines.push('', `${'★'.repeat(v.rating)}${'☆'.repeat(5 - v.rating)} от @${h(v.author)} для @${h(v.seller)}${v.hidden ? ' · скрыт' : ''}`);
    if (v.text) lines.push(`«${h(clip(v.text, 500))}»`);
  }
  if (r.status !== 'OPEN') lines.push('', `Решение: ${h(r.resolution ?? '—')}`);
  return lines.join('\n');
}

function actions(r: Report): Array<[string, string]> {
  if (r.status !== 'OPEN') return [];
  if (r.targetType === 'APPEAL') return [['✅ Разблокировать вещь', 'unblock'], ['✖️ Оставить блокировку', 'dismiss']];
  if (r.targetType === 'USER') return [['🚫 Заблокировать пользователя', 'block_user'], ['✖️ Отклонить жалобу', 'dismiss']];
  if (r.targetType === 'REVIEW') return [['🙈 Скрыть отзыв', 'block'], ['🚫 Заблокировать автора', 'block_user'], ['✖️ Отклонить', 'dismiss']];
  const blocked = r.listing?.status === 'BLOCKED';
  return [blocked ? ['✅ Разблокировать вещь', 'unblock'] : ['🚫 Заблокировать вещь', 'block'], ['👤 Заблокировать продавца', 'block_user'], ['✖️ Отклонить жалобу', 'dismiss']];
}

export const reportRoutes: Routes = {
  async reports({ api, p }) {
    const tab = TABS.some(([t]) => t === p.tab) ? str(p.tab) : 'OPEN';
    const { items } = await api<{ items: Report[] }>('GET', `/admin/reports?status=${tab}`);
    const i = Math.min(int(p.i), Math.max(0, items.length - 1));
    const rows: Btn[][] = [...tabs(TABS, tab, 'reports')];
    if (!items.length) return screen(`🛡 <b>Модерация</b>\n\n${tab === 'OPEN' ? 'Открытых жалоб нет ✨' : 'Пусто'}`, [...rows, [menu()]]);
    const r = items[i];
    for (const [label, action] of actions(r)) rows.push([btn(label, 'reports.act', { id: r.id, action, tab, i })]);
    rows.push(pager('reports', { tab }, 'i', i, items.length));
    rows.push([btn('🔄', 'reports', { tab, i }), menu()]);
    return screen(`🛡 <b>Модерация</b> · ${i + 1} из ${items.length}\n\n${card(r)}`, rows);
  },

  async 'reports.act'({ p }) {
    const action = str(p.action);
    const text = `${h(ACTION[action] ?? action)}\n\nНапишите причину или комментарий — он попадёт в журнал модерации${action === 'block' || action === 'block_user' ? ' и (для вещи) его увидит продавец' : ''}.`;
    return ask(text, go('reports.do', p), go('reports', { tab: p.tab, i: p.i }), { skip: action === 'dismiss' || action === 'unblock' ? 'Без комментария' : 'Причина из жалобы' });
  },

  async 'reports.do'({ api, p }) {
    await api('POST', `/admin/reports/${str(p.id)}/resolve`, { action: str(p.action), reason: str(p.input) || null });
    return toast('✅ Готово', go('reports', { tab: p.tab, i: p.i }));
  },
};
