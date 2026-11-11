import type { Routes } from './ctx.js';
import { DEAL_STATUS } from './home.js';
import { a, ask, btn, byn, clip, dt, go, h, int, menu, pager, screen, site, str, tabs, toast, type Btn } from './ui.js';

interface Dispute {
  id: string;
  number: number;
  status: string;
  priceTotal: number;
  deliveryMethod: string | null;
  trackingNumber: string | null;
  createdAt: string;
  buyer: { username: string };
  seller: { username: string };
  items: Array<{ id: string; slug: string; title: string; dealPrice: number; size?: string | null; sewnTo?: unknown }>;
  dispute: { at: string; reason: string | null; by: 'buyer' | 'seller' } | null;
  decisions: Array<{ action: string; reason: string | null; at: string }>;
}

const TABS = [
  ['open', 'Открытые'],
  ['resolved', 'Решённые'],
] as const;
const DECISION: Record<string, string> = { complete: '✅ Сделка завершена', cancel: '↩️ Сделка отменена', keep: '📝 Оставлен открытым' };
const ACTION: Record<string, string> = {
  complete: 'Завершить сделку — как будто покупатель подтвердил получение. Уникальные вещи станут проданными.',
  cancel: 'Отменить сделку. Вещь вернётся в продажу, если она не уезжала к покупателю (иначе — будет скрыта).',
  keep: 'Оставить спор открытым — запись попадёт в историю сделки.',
};

function card(d: Dispute) {
  const lines = [
    `Сделка <b>№ ${d.number}</b> · ${h(DEAL_STATUS[d.status] ?? d.status)} · ${byn(d.priceTotal)}`,
    `Покупатель @${h(d.buyer.username)} · продавец @${h(d.seller.username)}`,
    `Создана ${dt(d.createdAt)}${d.deliveryMethod ? ` · ${h(d.deliveryMethod)}` : ''}${d.trackingNumber ? ` · трек <code>${h(d.trackingNumber)}</code>` : ''}`,
    '',
    ...d.items.map((i) => `• ${a(clip(i.title, 70), `/item/${i.id}-${i.slug}`)} — ${byn(i.dealPrice)}${i.size ? `, ${h(i.size)}` : ''}${i.sewnTo ? ', по меркам' : ''}`),
  ];
  if (d.dispute) lines.push('', `⚠️ <b>${d.dispute.by === 'buyer' ? 'Покупатель' : 'Продавец'}</b> открыл спор ${dt(d.dispute.at)}`, d.dispute.reason ? `«${h(clip(d.dispute.reason, 800))}»` : '');
  if (d.decisions.length) lines.push('', '<b>Решения</b>', ...d.decisions.map((x) => `${DECISION[x.action] ?? h(x.action)} · ${dt(x.at)}${x.reason ? `\n<i>${h(clip(x.reason, 300))}</i>` : ''}`));
  lines.push('', '<i>Ichiba не двигает деньги: возврат, если нужен, — между сторонами.</i>');
  return lines.join('\n');
}

export const disputeRoutes: Routes = {
  async disputes({ api, p }) {
    const tab = p.tab === 'resolved' ? 'resolved' : 'open';
    const { items } = await api<{ items: Dispute[] }>('GET', `/admin/disputes?status=${tab}`);
    const i = Math.min(int(p.i), Math.max(0, items.length - 1));
    const rows: Btn[][] = [...tabs(TABS, tab, 'disputes')];
    if (!items.length) return screen(`⚖️ <b>Споры</b>\n\n${tab === 'open' ? 'Открытых споров нет ✨' : 'Пусто'}`, [...rows, [menu()]]);
    const d = items[i];
    if (d.status === 'DISPUTED') {
      rows.push([btn('✅ Завершить сделку', 'disputes.act', { id: d.id, action: 'complete', tab, i }), btn('↩️ Отменить сделку', 'disputes.act', { id: d.id, action: 'cancel', tab, i })]);
      rows.push([btn('📝 Оставить открытым', 'disputes.act', { id: d.id, action: 'keep', tab, i })]);
    }
    rows.push(site('Открыть сделку на сайте', `/deals/${d.id}`));
    rows.push(pager('disputes', { tab }, 'i', i, items.length));
    rows.push([btn('🔄', 'disputes', { tab, i }), menu()]);
    return screen(`⚖️ <b>Споры</b> · ${i + 1} из ${items.length}\n\n${card(d)}`, rows);
  },

  async 'disputes.act'({ p }) {
    return ask(`${h(ACTION[str(p.action)] ?? '')}\n\nОпишите решение — его увидят обе стороны (от 3 символов).`, go('disputes.do', p), go('disputes', { tab: p.tab, i: p.i }));
  },

  async 'disputes.do'({ api, p }) {
    await api('POST', `/admin/disputes/${str(p.id)}/resolve`, { action: str(p.action), reason: str(p.input) });
    return toast('✅ Решение записано', go('disputes', { tab: p.tab, i: p.i }));
  },
};
